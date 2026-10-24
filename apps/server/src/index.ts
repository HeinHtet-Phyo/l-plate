// L-Plate server: pairing relay, Nebius instructor/examiner, OSRM rerouting.
import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import { networkInterfaces } from 'node:os';
import type { AppConfig, DebriefRequest, InstructorRequest, RefereeRequest, Role, RuleHit } from '@lplate/shared';
import { Relay } from './relay.ts';
import { readFileSync } from 'node:fs';
import { createNebius, NebiusError } from './nebius.ts';
import { RateLimiter, buildInstructorMessages, cleanSpoken, nebiusDebrief, ruleBasedDebrief } from './instructor.ts';
import { routeVia } from './osrm.ts';
import { searchRules } from './rules.ts';
import { referee, refereeModels } from './referee.ts';

const PORT = Number(process.env.PORT ?? 8080);
const KEY = process.env.NEBIUS_API_KEY?.trim() || '';
const MODEL_INSTRUCTOR = process.env.NEBIUS_MODEL_INSTRUCTOR || 'Qwen/Qwen3-30B-A3B-Instruct-2507';
const MODEL_EXAMINER = process.env.NEBIUS_MODEL_EXAMINER || 'Qwen/Qwen3-235B-A22B-Instruct-2507';
const MODEL_RERANK = process.env.NEBIUS_MODEL_RERANK || '';
// Used when the instructor model is unavailable (Nebius returned 503s for it during the hackathon).
const MODEL_INSTRUCTOR_FALLBACK = process.env.NEBIUS_MODEL_INSTRUCTOR_FALLBACK || 'deepseek-ai/DeepSeek-V4-Flash-0731';

// The Highway Code lookup is optional context for the examiner: cap it so a slow or 503-ing
// embeddings call can't hold the debrief up (it once took 18 s), and cache by query.
const ruleCache = new Map<string, RuleHit[]>();
async function quickRules(client: Parameters<typeof searchRules>[0], query: string, ms = 4000): Promise<RuleHit[]> {
  const hit = ruleCache.get(query);
  if (hit) return hit;
  const timeout = new Promise<RuleHit[]>((r) => setTimeout(() => r([]), ms));
  const found = await Promise.race([searchRules(client, query, MODEL_RERANK).catch(() => [] as RuleHit[]), timeout]);
  if (found.length) ruleCache.set(query, found);
  return found;
}

export function buildApp() {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });
  const relay = new Relay();
  const limiter = new RateLimiter(1000);
  const effort = process.env.NEBIUS_REASONING_EFFORT || undefined;
  const nebius = KEY ? createNebius({ apiKey: KEY, reasoningEffort: effort }) : null;
  // Directions are time-critical: one quick retry, then the fallback model.
  const nebiusFast = KEY ? createNebius({ apiKey: KEY, retries: 1, backoffMs: 300, timeoutMs: 8000, reasoningEffort: effort }) : null;
  // Referee: several models at once, so one retry and a hard cap per model.
  const nebiusReferee = KEY ? createNebius({ apiKey: KEY, retries: 1, backoffMs: 500, timeoutMs: 25_000, reasoningEffort: effort }) : null;

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
    const safe = debriefInput(req.body as DebriefRequest);
    if (!nebius) return { ...ruleBasedDebrief(safe), error: 'No NEBIUS_API_KEY: offline debrief' };
    try {
      const kinds = [...new Set(safe.faults.map((f) => f.text))].slice(0, 3).join('; ');
      const rules = kinds ? await quickRules(nebius, kinds) : [];
      return await nebiusDebrief(nebius, MODEL_EXAMINER, safe, rules);
    } catch (e) {
      req.log.warn({ err: (e as Error).message }, 'debrief fell back to rules');
      return { ...ruleBasedDebrief(safe), error: (e as Error).message };
    }
  });

  // Same fault log to several examiner models; raw debriefs scored against the DVSA rule.
  app.post('/api/referee', async (req, reply) => {
    if (!nebiusReferee) return reply.code(503).send({ error: 'No NEBIUS_API_KEY: the referee needs Nebius' });
    const body = req.body as RefereeRequest;
    const safe = debriefInput(body);
    const kinds = [...new Set(safe.faults.map((f) => f.text))].slice(0, 3).join('; ');
    const rules = kinds ? await quickRules(nebiusReferee, kinds) : [];
    const out = await referee(nebiusReferee, refereeModels(body?.models), safe, rules);
    req.log.info({ models: out.entries.map((e) => `${e.model}:${e.ok ? e.score : 'err'}:${e.ms}ms`) }, 'referee');
    return out;
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

/** The debrief input, clamped: shared by /api/debrief and /api/referee. */
function debriefInput(body: DebriefRequest | undefined): DebriefRequest {
  return {
    route: String(body?.route ?? 'the drive').slice(0, 120),
    faults: Array.isArray(body?.faults) ? body.faults.slice(0, 200) : [],
    stats: { ...(body?.stats ?? {}), distance: num(body?.stats?.distance), duration: num(body?.stats?.duration), maxSpeedOverLimit: num(body?.stats?.maxSpeedOverLimit) },
  };
}

/**
 * Phone links on this network. Private IPv4 first; then global IPv6, because on IPv6-only Wi-Fi
 * macOS shows a CLAT address (192.0.0.x) that only exists inside the laptop and a phone can't reach.
 */
function lanUrls(): string[] {
  const proto = process.env.HTTPS === '1' ? 'https' : 'http';
  const port = process.env.WEB_PORT ?? 5173;
  const v4: string[] = [];
  const v6: string[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const i of list ?? []) {
      if (i.internal) continue;
      if (i.family === 'IPv4' && !i.address.startsWith('192.0.0.')) v4.push(`${proto}://${i.address}:${port}`);
      else if (i.family === 'IPv6' && /^[23]/.test(i.address)) v6.push(`${proto}://[${i.address}]:${port}`);
    }
  }
  return [...v4, ...v6];
}

async function publicUrl(): Promise<string | null> {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, '');
  // pnpm tunnel (scripts/tunnel.ts) writes its Pinggy URL here while it runs.
  try {
    const url = readFileSync(new URL('../../../.tunnel-url', import.meta.url), 'utf8').trim();
    if (url) return url;
  } catch {
    /* no pnpm tunnel running */
  }
  // An ngrok tunnel (pnpm tunnel), else a Cloudflare quick tunnel (pnpm tunnel:cf): both give the phone HTTPS.
  try {
    const r = await fetch('http://127.0.0.1:4040/api/tunnels', { signal: AbortSignal.timeout(800) });
    const j = (await r.json()) as { tunnels: { public_url: string }[] };
    const url = j.tunnels.find((t) => t.public_url.startsWith('https://'))?.public_url;
    if (url) return url;
  } catch {
    /* no ngrok */
  }
  try {
    const r = await fetch(`http://127.0.0.1:${process.env.CLOUDFLARED_METRICS_PORT ?? 45678}/quicktunnel`, { signal: AbortSignal.timeout(800) });
    const j = (await r.json()) as { hostname?: string };
    if (j.hostname) return `https://${j.hostname}`;
  } catch {
    /* no cloudflared */
  }
  return null;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop()!)) {
  const app = buildApp();
  app.listen({ port: PORT, host: '0.0.0.0' }).then(() => {
    app.log.info(`L-Plate server on :${PORT} (Nebius ${KEY ? 'on' : 'off'}; instructor ${MODEL_INSTRUCTOR}; examiner ${MODEL_EXAMINER})`);
  });
}
