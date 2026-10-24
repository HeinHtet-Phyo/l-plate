// Model referee: the same drive log goes to several examiner models in parallel, and each raw
// debrief is scored against the DVSA rule and the real Highway Code. No guards are applied here:
// the point is to show where the models go wrong.
import type { Debrief, DebriefRequest, RefereeChecks, RefereeEntry, RefereeResponse, RuleHit } from '@lplate/shared';
import type { NebiusClient } from './nebius.ts';
import { DEBRIEF_SCHEMA, EXAMINER_SYSTEM, debriefUserPrompt, dvsaResult, ruleBasedDebrief, validateDebrief } from './instructor.ts';
import { loadRules } from './rules.ts';

export const DEFAULT_REFEREE_MODELS = ['deepseek-ai/DeepSeek-V4.1-Flash-1017', 'Qwen/Qwen3-235B-A22B-Instruct-2507', 'moonshotai/Kimi-K3'];
export const MAX_REFEREE_MODELS = 4;

/** Models from the request, else NEBIUS_REFEREE_MODELS, else the defaults. */
export function refereeModels(requested: unknown, env = process.env.NEBIUS_REFEREE_MODELS): string[] {
  const clean = (xs: unknown[]) => [...new Set(xs.filter((m): m is string => typeof m === 'string').map((m) => m.trim().slice(0, 120)).filter(Boolean))].slice(0, MAX_REFEREE_MODELS);
  if (Array.isArray(requested)) {
    const m = clean(requested);
    if (m.length) return m;
  }
  const fromEnv = clean((env ?? '').split(','));
  return fromEnv.length ? fromEnv : DEFAULT_REFEREE_MODELS;
}

/** Rule numbers in "Rule 126", "rules 126 and 127", "Rules 159-161" (ranges give both ends). */
export function citedRules(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/\brules?\s+(\d+[a-z]?(?:\s*(?:,|and|&|or|-|–|to)\s*\d+[a-z]?)*)/gi)) {
    for (const n of m[1].match(/\d+/g) ?? []) out.add(String(Number(n)));
  }
  return [...out].sort((a, b) => Number(a) - Number(b));
}

let known: Set<string> | null | undefined;

/** The Highway Code's rule numbers from data/highway-code.json, or null if it's missing. */
export function knownRules(): Set<string> | null {
  if (known !== undefined) return known;
  const db = loadRules();
  known = db ? new Set(db.chunks.map((c) => c.rule)) : null;
  return known;
}

/** Test hook. */
export function setKnownRules(rules?: Set<string> | null): void {
  known = rules;
}

export function scoreChecks(c: RefereeChecks): number {
  if (!c.validJson) return 0;
  let s = 30;
  if (c.verdictMatchesRule) s += 30;
  if (c.selfConsistent) s += 15;
  const diff = Math.abs(c.faultCountModel - c.faultCountLog);
  s += diff === 0 ? 10 : diff === 1 ? 5 : 0;
  if (!c.inventedRules.length) s += 15;
  return s;
}

/** Score one model's raw debrief against the log and the rule-based reference verdict. */
export function judge(d: Omit<Debrief, 'source'>, req: DebriefRequest, reference: 'pass' | 'fail', rules = knownRules()): RefereeChecks {
  const text = [d.summary, ...d.faults.map((f) => f.advice), ...d.focusNext].join('\n');
  const cited = citedRules(text);
  return {
    validJson: true,
    verdict: d.result,
    verdictMatchesRule: d.result === reference,
    selfConsistent: d.result === dvsaResult(d.faults),
    faultCountModel: d.faults.reduce((n, f) => n + f.count, 0),
    faultCountLog: req.faults.length,
    inventedRules: rules ? cited.filter((r) => !rules.has(r)) : [],
    citedRules: cited,
  };
}

async function runOne(client: NebiusClient, model: string, req: DebriefRequest, rules: RuleHit[], reference: 'pass' | 'fail'): Promise<RefereeEntry> {
  const t0 = Date.now();
  const failed = (error: string, tokens: RefereeEntry['tokens'] = null): RefereeEntry => ({
    model,
    ok: false,
    error: error.slice(0, 200),
    ms: Date.now() - t0,
    tokens,
    debrief: null,
    checks: { validJson: false, verdict: null, verdictMatchesRule: false, selfConsistent: false, faultCountModel: 0, faultCountLog: req.faults.length, inventedRules: [], citedRules: [] },
    score: 0,
  });
  let res;
  try {
    res = await client.chat({
      model,
      temperature: 0.2,
      max_tokens: 900,
      messages: [
        { role: 'system', content: EXAMINER_SYSTEM },
        { role: 'user', content: debriefUserPrompt(req, rules) },
      ],
      response_format: { type: 'json_schema', json_schema: { name: 'debrief', schema: DEBRIEF_SCHEMA, strict: true } },
    });
  } catch (e) {
    return failed((e as Error).message);
  }
  const ms = Date.now() - t0;
  const u = res.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined;
  const tokens = u ? { prompt: u.prompt_tokens ?? 0, completion: u.completion_tokens ?? 0 } : null;
  const content = res.choices?.[0]?.message?.content ?? '';
  let d: Omit<Debrief, 'source'>;
  try {
    d = validateDebrief(JSON.parse(content.replace(/^\s*```(?:json)?|```\s*$/g, '').trim()));
  } catch (e) {
    const entry = failed(content.trim() ? `Invalid JSON: ${(e as Error).message}` : 'Empty reply (no content)', tokens);
    return { ...entry, ms };
  }
  const checks = judge(d, req, reference);
  return { model, ok: true, ms, tokens, debrief: d, checks, score: scoreChecks(checks) };
}

/** Run every model in parallel; one slow or failing model never blocks the others. */
export async function referee(client: NebiusClient, models: string[], req: DebriefRequest, rules: RuleHit[] = []): Promise<RefereeResponse> {
  const reference = ruleBasedDebrief(req).result;
  const entries = await Promise.all(models.map((m) => runOne(client, m, req, rules, reference)));
  return { reference, faultCount: req.faults.length, entries };
}
