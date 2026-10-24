// L-Plate server: pairing relay, Nebius instructor/examiner, OSRM rerouting.
import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import { networkInterfaces } from 'node:os';
import type { AppConfig, DebriefRequest, InstructorRequest, Role } from '@lplate/shared';
import { Relay } from './relay.ts';
import { createNebius, NebiusError } from './nebius.ts';
import { RateLimiter, buildInstructorMessages, cleanSpoken, nebiusDebrief, ruleBasedDebrief } from './instructor.ts';
import { routeVia } from './osrm.ts';
import { searchRules } from './rules.ts';

const PORT = Number(process.env.PORT ?? 8080);
const KEY = process.env.NEBIUS_API_KEY?.trim() || '';
const MODEL_INSTRUCTOR = process.env.NEBIUS_MODEL_INSTRUCTOR || 'Qwen/Qwen3-30B-A3B-Instruct-2507';
const MODEL_EXAMINER = process.env.NEBIUS_MODEL_EXAMINER || 'Qwen/Qwen3-235B-A22B-Instruct-2507';
const MODEL_RERANK = process.env.NEBIUS_MODEL_RERANK || '';
// Used when the instructor model is unavailable (Nebius returned 503s for it during the hackathon).
const MODEL_INSTRUCTOR_FALLBACK = process.env.NEBIUS_MODEL_INSTRUCTOR_FALLBACK || 'deepseek-ai/DeepSeek-V4-Flash-0731';

export function buildApp() {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });
  const relay = new Relay();
  const limiter = new RateLimiter(1000);
  const nebius = KEY ? createNebius({ apiKey: KEY }) : null;
  // Directions are time-critical: one quick retry, then the fallback model.
  const nebiusFast = KEY ? createNebius({ apiKey: KEY, retries: 1, backoffMs: 300, timeoutMs: 8000 }) : null;

  app.register(websocket);

  const sweeper = setInterval(() => relay.sweep(), 15_000);
  app.addHook('onClose', async () => clearInterval(sweeper));

  app.get('/api/health', async () => ({ ok: true }));

  app.post('/api/pair', async () => relay.pair());

  app.register(async (scope) => {
    scope.get('/ws', { websocket: true }, (socket, req) => {
      const q = req.query as Record<string, string>;
      const role = q.role as Role;
      if (role !== 'host' && role !== 'controller') {
        socket.send(JSON.stringify({ type: 'error', message: 'bad role' }));
        socket.close(4002, 'bad role');
        return;
      }
      const h = relay.attach(role, q.session ?? '', q.token ?? '', socket);
      if (typeof h === 'string') {
        socket.send(JSON.stringify({ type: 'error', message: h }));
        socket.close(4003, h);
        return;
      }
      socket.on('message', (data: Buffer) => h.onMessage(data.toString()));
      socket.on('close', () => h.onClose());
    });
  });

  app.get('/api/config', async (): Promise<AppConfig> => {
    return { publicUrl: await publicUrl(), lanUrls: lanUrls(), instructor: Boolean(KEY) };
  });

  app.get('/api/route', async (req, reply) => {
    const q = req.query as Record<string, string>;
    const parse = (s: string) => s.split(',').map(Number) as [number, number];
    const from = q.from ? parse(q.from) : null;
    const via = (q.via ?? '').split(';').filter(Boolean).map(parse);
    if (!from || from.some((n) => !Number.isFinite(n)) || !via.length || via.flat().some((n) => !Number.isFinite(n))) {
      return reply.code(400).send({ error: 'from=lat,lng and via=lat,lng;… are required' });
    }
    try {
      return await routeVia([from, ...via], q.heading != null ? Number(q.heading) : undefined);
    } catch (e) {
      return reply.code(502).send({ error: (e as Error).message });
    }
  });

  app.post('/api/instructor', async (req, reply) => {
    const body = req.body as InstructorRequest;
    if (!nebius) return reply.code(503).send({ error: 'No NEBIUS_API_KEY on the server', text: '' });
    if (!body?.sessionId || !Array.isArray(body.turns) || !Array.isArray(body.sim) || !body.status) {
      return reply.code(400).send({ error: 'bad request' });
    }
    if (!limiter.allow(body.sessionId)) return reply.code(429).send({ error: 'slow down', text: '' });
    try {
      const lastLearner = [...body.turns].reverse().find((t) => t.role === 'learner');
      const asksRule = lastLearner && /rule|highway code|allowed|legal|should i|can i/i.test(lastLearner.text);
      const rules = asksRule ? await searchRules(nebius, lastLearner!.text, MODEL_RERANK).catch(() => []) : [];
      const t0 = Date.now();
      const ask = (model: string, client: typeof nebius) =>
        client.chat({ model, messages: buildInstructorMessages(body, rules), max_tokens: 120, temperature: 0.3, reasoning_effort: 'none' });
      let model = MODEL_INSTRUCTOR;
      let res;
      try {
        res = await ask(model, nebiusFast!);
      } catch (e) {
        if (e instanceof NebiusError && (e.status === 401 || e.status === 402)) throw e;
        req.log.warn({ err: (e as Error).message.slice(0, 120) }, 'instructor model failed; trying fallback');
        model = MODEL_INSTRUCTOR_FALLBACK;
        res = await ask(model, nebiusFast!);
      }
      const text = cleanSpoken(res.choices?.[0]?.message?.content ?? '');
      req.log.info({ ms: Date.now() - t0, model }, 'instructor reply');
      return { text, model, ms: Date.now() - t0 };
    } catch (e) {
      req.log.warn({ err: (e as Error).message }, 'instructor failed');
      const status = e instanceof NebiusError && e.status ? e.status : 502;
      return reply.code(status === 401 || status === 402 ? status : 502).send({ error: (e as Error).message, text: '' });
    }
  });

  app.post('/api/debrief', async (req) => {
    const body = req.body as DebriefRequest;
    const safe: DebriefRequest = {
      route: String(body?.route ?? 'the drive').slice(0, 120),
      faults: Array.isArray(body?.faults) ? body.faults.slice(0, 200) : [],
      stats: { ...(body?.stats ?? {}), distance: num(body?.stats?.distance), duration: num(body?.stats?.duration), maxSpeedOverLimit: num(body?.stats?.maxSpeedOverLimit) },
    };
    if (!nebius) return { ...ruleBasedDebrief(safe), error: 'No NEBIUS_API_KEY: offline debrief' };
    try {
      const kinds = [...new Set(safe.faults.map((f) => f.text))].slice(0, 3).join('; ');
      const rules = kinds ? await searchRules(nebius, kinds, MODEL_RERANK).catch(() => []) : [];
      return await nebiusDebrief(nebius, MODEL_EXAMINER, safe, rules);
    } catch (e) {
      req.log.warn({ err: (e as Error).message }, 'debrief fell back to rules');
      return { ...ruleBasedDebrief(safe), error: (e as Error).message };
    }
  });

  app.post('/api/rules/search', async (req, reply) => {
    if (!nebius) return reply.code(503).send({ error: 'No NEBIUS_API_KEY' });
    const q = String((req.body as { query?: string })?.query ?? '').slice(0, 500);
    try {
      return { results: await searchRules(nebius, q, MODEL_RERANK) };
    } catch (e) {
      req.log.warn({ err: (e as Error).message }, 'rules search failed');
      return reply.code(502).send({ error: (e as Error).message, results: [] });
    }
  });

  return app;
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

function lanUrls(): string[] {
  const out: string[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const i of list ?? []) if (i.family === 'IPv4' && !i.internal) out.push(`http://${i.address}:${process.env.WEB_PORT ?? 5173}`);
  }
  return out;
}

async function publicUrl(): Promise<string | null> {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, '');
  try {
    const r = await fetch('http://127.0.0.1:4040/api/tunnels', { signal: AbortSignal.timeout(800) });
    const j = (await r.json()) as { tunnels: { public_url: string }[] };
    return j.tunnels.find((t) => t.public_url.startsWith('https://'))?.public_url ?? null;
  } catch {
    return null;
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop()!)) {
  const app = buildApp();
  app.listen({ port: PORT, host: '0.0.0.0' }).then(() => {
    app.log.info(`L-Plate server on :${PORT} (Nebius ${KEY ? 'on' : 'off'}; instructor ${MODEL_INSTRUCTOR}; examiner ${MODEL_EXAMINER})`);
  });
}
