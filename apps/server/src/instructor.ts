// Sam the instructor and the examiner debrief, on Nebius Token Factory.
import type { Debrief, DebriefRequest, FaultRecord, InstructorRequest, RuleHit, Severity } from '@lplate/shared';
import type { NebiusClient } from './nebius.ts';

export const SAM_SYSTEM = `You are Sam, a calm, encouraging UK driving instructor sitting in the passenger seat of a learner's car in London.
Speak in UK terms (mph, "end of the road", "mirrors, signal, manoeuvre", "pull up on the left").
Say ONE short instruction or comment at a time: at most 2 sentences, plain spoken English, no lists, no emojis, no stage directions.
Never lecture during a manoeuvre. Directions are urgent and come first: relay them clearly with the distance.
Never invent directions: only relay what the [SIM] notes say. Do not mention [SIM] notes or that you are an AI.
If the learner asks something you don't know, say so briefly. Never use anyone's name for the learner.`;

export const MAX_TURNS = 12;

export function buildInstructorMessages(req: InstructorRequest, rules: RuleHit[] = []) {
  const s = req.status;
  const statusLine = `Car now: ${Math.round(s.speedMph)} mph${s.limitMph ? ` in a ${s.limitMph} mph limit` : ''} on ${s.road || 'an unnamed road'}; indicator ${s.indicator}; handbrake ${s.handbrake ? 'on' : 'off'}; next: ${s.nextInstruction ? `${s.nextInstruction} (${s.distanceToNext ?? '?'})` : 'none'}; faults so far: ${s.faultsSoFar}.`;
  const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
    { role: 'system', content: `${SAM_SYSTEM}\n\n${statusLine}` },
  ];
  if (rules.length) {
    messages[0].content += `\n\nRelevant Highway Code rules you may cite by number:\n${rules.map((r) => `Rule ${r.rule}: ${r.text.slice(0, 300)}`).join('\n')}`;
  }
  const turns = req.turns.slice(-MAX_TURNS);
  for (const t of turns) messages.push({ role: t.role === 'instructor' ? 'assistant' : 'user', content: t.text });
  const sim = req.sim.filter(Boolean).slice(-6);
  if (sim.length) messages.push({ role: 'user', content: sim.map((l) => (l.startsWith('[SIM]') ? l : `[SIM] ${l}`)).join('\n') });
  if (messages.length === 1) messages.push({ role: 'user', content: '[SIM] (nothing new)' });
  // Merge consecutive same-role messages (some chat templates require alternation).
  const merged: typeof messages = [];
  for (const m of messages) {
    const last = merged[merged.length - 1];
    if (last && last.role === m.role && m.role !== 'system') last.content += `\n${m.content}`;
    else merged.push({ ...m });
  }
  return merged;
}

/** Strip thinking tags and stage directions, cap at two sentences. */
export function cleanSpoken(text: string): string {
  let t = text.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/\*[^*]+\*/g, '').replace(/\[SIM\][^\n]*/g, '').trim();
  t = t.replace(/^["']|["']$/g, '').replace(/\s+/g, ' ');
  const sentences = t.match(/[^.!?]+[.!?]+/g);
  if (sentences && sentences.length > 2) t = sentences.slice(0, 2).join('').trim();
  return t;
}

/** 1 request per second per session. */
export class RateLimiter {
  last = new Map<string, number>();
  intervalMs: number;
  now: () => number;
  constructor(intervalMs = 1000, now: () => number = Date.now) {
    this.intervalMs = intervalMs;
    this.now = now;
  }
  allow(key: string): boolean {
    const t = this.now();
    const prev = this.last.get(key) ?? -Infinity;
    if (t - prev < this.intervalMs) return false;
    this.last.set(key, t);
    if (this.last.size > 5000) this.last.clear();
    return true;
  }
}

// ---------------- Debrief ----------------

export const DEBRIEF_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['result', 'summary', 'faults', 'focusNext'],
  properties: {
    result: { type: 'string', enum: ['pass', 'fail'] },
    summary: { type: 'string' },
    faults: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['category', 'severity', 'count', 'advice'],
        properties: {
          category: { type: 'string' },
          severity: { type: 'string', enum: ['driving', 'serious', 'dangerous'] },
          count: { type: 'integer', minimum: 1 },
          advice: { type: 'string' },
        },
      },
    },
    focusNext: { type: 'array', items: { type: 'string' }, maxItems: 4 },
  },
} as const;

export const EXAMINER_SYSTEM = `You are a DVSA driving examiner writing the debrief for a practice driving test in London, marked on the DL25 sheet.
Classify each fault group as "driving" (minor), "serious" (potentially dangerous) or "dangerous" (actual danger to the learner, public or property).
Hitting a vehicle, building or tree is dangerous. Going through a red light is serious. A single kerb touch or missed signal is usually a driving fault; repeated or risky ones can be serious.
DVSA rule: the result is "fail" if there is any serious or dangerous fault, or more than 15 driving faults; otherwise "pass".
Write a short, kind, specific summary (2-3 sentences, UK English) that is consistent with your result, and one practical piece of advice per fault group.
Only cite a Highway Code rule number if that rule is quoted in the input; never cite rule numbers from memory.
focusNext: up to 3 short things to practise next. Respond with JSON only.`;

const SEVERITIES: Severity[] = ['driving', 'serious', 'dangerous'];

/** Strict validation of a model debrief. Throws on any problem. */
export function validateDebrief(x: any): Omit<Debrief, 'source'> {
  if (!x || typeof x !== 'object') throw new Error('not an object');
  if (x.result !== 'pass' && x.result !== 'fail') throw new Error('bad result');
  if (typeof x.summary !== 'string' || !x.summary.trim()) throw new Error('bad summary');
  if (!Array.isArray(x.faults)) throw new Error('bad faults');
  const faults = x.faults.map((f: any) => {
    if (!f || typeof f.category !== 'string' || !SEVERITIES.includes(f.severity) || typeof f.advice !== 'string') {
      throw new Error('bad fault entry');
    }
    const count = Math.max(1, Math.round(Number(f.count) || 1));
    return { category: f.category, severity: f.severity as Severity, count, advice: f.advice };
  });
  if (!Array.isArray(x.focusNext) || !x.focusNext.every((s: unknown) => typeof s === 'string')) throw new Error('bad focusNext');
  return { result: x.result, summary: x.summary.trim(), faults, focusNext: x.focusNext.slice(0, 4) };
}

/** DVSA rule: fail on any serious/dangerous fault, or more than 15 driving faults. */
export function dvsaResult(faults: { severity: Severity; count: number }[]): 'pass' | 'fail' {
  if (faults.some((f) => f.severity !== 'driving')) return 'fail';
  const driving = faults.reduce((n, f) => n + f.count, 0);
  return driving > 15 ? 'fail' : 'pass';
}

const DEFAULT_SEVERITY: Record<string, Severity> = {
  collision: 'dangerous',
  redLight: 'serious',
};
const ADVICE: Record<string, string> = {
  kerb: 'Slow down before the junction and look well into the new road so you steer a smooth line, clear of the kerb.',
  centreLine: 'Keep to the middle of your lane; pick a reference point and look further ahead.',
  signal: 'Use mirrors, signal, manoeuvre: indicate in good time before every turn and roundabout exit.',
  speeding: 'Check the speedometer regularly and watch for limit signs; in most of London the limit is 20 mph.',
  redLight: 'Approach lights at a speed you can stop from, and stop at amber unless stopping would be unsafe.',
  collision: 'Keep a safe gap from parked cars and traffic, and slow right down when space is tight.',
};

/** Rule-based debrief from the fault log (used offline or when the model fails). */
export function ruleBasedDebrief(req: DebriefRequest): Debrief {
  const groups = new Map<string, { category: string; severity: Severity; count: number; advice: string }>();
  for (const f of req.faults as FaultRecord[]) {
    const g = groups.get(f.category);
    if (g) g.count++;
    else groups.set(f.category, { category: f.category, severity: DEFAULT_SEVERITY[f.kind] ?? 'driving', count: 1, advice: ADVICE[f.kind] ?? 'Practise this with your instructor.' });
  }
  const faults = [...groups.values()];
  const result = dvsaResult(faults);
  const total = faults.reduce((n, f) => n + f.count, 0);
  const summary =
    total === 0
      ? `A clean drive on ${req.route}: no faults recorded. Well done.`
      : `${total} fault${total === 1 ? '' : 's'} recorded on ${req.route}. ${result === 'pass' ? 'That would be a pass, but keep working on them.' : 'That would be a fail on a real test.'}`;
  return {
    result,
    summary,
    faults,
    focusNext: faults.slice(0, 3).map((f) => f.category),
    source: 'offline',
  };
}

/** The examiner's user message: route, stats, fault log, and any quoted Highway Code rules. */
export function debriefUserPrompt(req: DebriefRequest, rules: RuleHit[] = []): string {
  const faultLines = req.faults.map((f) => `- ${f.category}: ${f.text} (${f.road || 'unknown road'}, ${Math.round(f.time)} s in)`).join('\n') || '- none';
  return `Route: ${req.route}
Distance: ${(req.stats.distance / 1609).toFixed(1)} miles, duration ${Math.round(req.stats.duration / 60)} min, max speed over limit: ${req.stats.maxSpeedOverLimit.toFixed(0)} mph.
Fault log:
${faultLines}${rules.length ? `\nHighway Code rules:\n${rules.map((r) => `Rule ${r.rule}: ${r.text.slice(0, 240)}`).join('\n')}` : ''}`;
}

export async function nebiusDebrief(client: NebiusClient, model: string, req: DebriefRequest, rules: RuleHit[] = []): Promise<Debrief> {
  const user = debriefUserPrompt(req, rules);
  const res = await client.chat({
    model,
    temperature: 0.2,
    max_tokens: 900,
    messages: [
      { role: 'system', content: EXAMINER_SYSTEM },
      { role: 'user', content: user },
    ],
    response_format: { type: 'json_schema', json_schema: { name: 'debrief', schema: DEBRIEF_SCHEMA, strict: true } },
  });
  const content = res.choices?.[0]?.message?.content ?? '';
  const json = JSON.parse(content.replace(/^```(?:json)?|```$/g, '').trim());
  const d = validateDebrief(json);
  // The DVSA rule is not negotiable: recompute the result from the severities.
  const result = dvsaResult(d.faults);
  const quoted = new Set(rules.map((r) => r.rule));
  const strip = (s: string) => s.replace(/\s*\((?:see )?(?:Highway Code )?Rule (\d+)\)/gi, (m, n) => (quoted.has(n) ? m : ''));
  let summary = strip(d.summary);
  if (result !== d.result) {
    summary += ` Under the DVSA rule (no serious or dangerous faults and no more than 15 driving faults) this drive is a ${result}.`;
  }
  return {
    ...d,
    summary,
    faults: d.faults.map((f) => ({ ...f, advice: strip(f.advice) })),
    result,
    modelResult: d.result,
    source: 'nebius',
    rules: rules.map((r) => ({ rule: r.rule, text: r.text })),
  } as Debrief;
}
