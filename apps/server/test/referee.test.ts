import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DebriefRequest } from '@lplate/shared';
import { createNebius } from '../src/nebius.ts';
import { DEFAULT_REFEREE_MODELS, citedRules, judge, referee, refereeModels, scoreChecks, setKnownRules } from '../src/referee.ts';

const fault = (kind: string, category: string): DebriefRequest['faults'][number] => ({ kind, category, text: `${kind} fault`, road: 'High Road', time: 60 });
const req = (faults: DebriefRequest['faults']): DebriefRequest => ({ route: 'Goodmayes', faults, stats: { distance: 5600, duration: 720, maxSpeedOverLimit: 8 } });
const debrief = (result: 'pass' | 'fail', faults: { category: string; severity: string; count: number; advice: string }[], summary = 'Fine.') =>
  JSON.stringify({ result, summary, faults, focusNext: [] });

/** A fetch that answers per model from a table: a content string, or an HTTP status. */
function modelFetch(table: Record<string, string | number>) {
  const bodies: any[] = [];
  const f = vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    bodies.push(body);
    const a = table[body.model];
    if (typeof a === 'number') return new Response('<html><body><h1>503 Service Temporarily Unavailable</h1></body></html>', { status: a });
    return new Response(JSON.stringify({ choices: [{ message: { content: a } }], usage: { prompt_tokens: 400, completion_tokens: 120 } }), { status: 200 });
  });
  return { f, bodies, client: createNebius({ apiKey: 'test', fetchImpl: f as unknown as typeof fetch, retries: 0 }) };
}

afterEach(() => setKnownRules(undefined));

describe('refereeModels', () => {
  it('prefers the request, then the env list, then the defaults', () => {
    expect(refereeModels(['a', 'b', 'a', 7])).toEqual(['a', 'b']);
    expect(refereeModels(['a', 'b', 'c', 'd', 'e'])).toHaveLength(4);
    expect(refereeModels(undefined, ' x , y ,')).toEqual(['x', 'y']);
    expect(refereeModels([], '')).toEqual(DEFAULT_REFEREE_MODELS);
  });
});

describe('citedRules', () => {
  it('finds single rules, lists and ranges', () => {
    expect(citedRules('See Rule 126. Also rules 159 and 161, Rules 170-171.')).toEqual(['126', '159', '161', '170', '171']);
    expect(citedRules('No rules here, just 30 mph.')).toEqual([]);
  });
});

describe('judge and scoreChecks', () => {
  it('gives full marks to a correct, consistent debrief with real rules', () => {
    setKnownRules(new Set(['126']));
    const c = judge(
      { result: 'pass', summary: 'Good (Rule 126).', faults: [{ category: 'Signals', severity: 'driving', count: 1, advice: 'Signal.' }], focusNext: [] },
      req([fault('signal', 'Signals')]),
      'pass',
    );
    expect(c).toMatchObject({ verdictMatchesRule: true, selfConsistent: true, faultCountModel: 1, faultCountLog: 1, inventedRules: [], citedRules: ['126'] });
    expect(scoreChecks(c)).toBe(100);
  });

  it('flags a wrong, self-contradicting verdict and an invented rule', () => {
    setKnownRules(new Set(['126']));
    const c = judge(
      { result: 'pass', summary: 'Lovely, see Rule 999.', faults: [{ category: 'Red light', severity: 'serious', count: 1, advice: 'Stop.' }], focusNext: [] },
      req([fault('redLight', 'Red light'), fault('signal', 'Signals')]),
      'fail',
    );
    expect(c).toMatchObject({ verdictMatchesRule: false, selfConsistent: false, inventedRules: ['999'] });
    // Valid JSON 30 + counts off by one 5.
    expect(scoreChecks(c)).toBe(35);
  });
});

describe('referee (mocked fetch)', () => {
  it('runs every model with the examiner prompt and keeps the raw verdicts', async () => {
    setKnownRules(new Set(['126']));
    const { client, bodies } = modelFetch({
      good: debrief('fail', [{ category: 'Red light', severity: 'serious', count: 1, advice: 'Stop at red (Rule 126).' }]),
      wrong: '```json\n' + debrief('pass', [{ category: 'Red light', severity: 'serious', count: 1, advice: 'See Rule 400.' }]) + '\n```',
      down: 503,
      empty: '',
    });
    const out = await referee(client, ['good', 'wrong', 'down', 'empty'], req([fault('redLight', 'Red light')]));
    expect(out.reference).toBe('fail');
    expect(out.entries.map((e) => e.model)).toEqual(['good', 'wrong', 'down', 'empty']);
    expect(bodies.every((b) => b.response_format.json_schema.strict === true && b.messages[0].role === 'system')).toBe(true);

    const [good, wrong, down, empty] = out.entries;
    expect(good).toMatchObject({ ok: true, score: 100, tokens: { prompt: 400, completion: 120 } });
    // The raw verdict survives: the referee does not apply the DVSA override.
    expect(wrong.debrief?.result).toBe('pass');
    expect(wrong.checks).toMatchObject({ verdictMatchesRule: false, selfConsistent: false, inventedRules: ['400'] });
    expect(down).toMatchObject({ ok: false, score: 0, debrief: null });
    expect(down.error).toContain('503');
    expect(down.error).not.toContain('<');
    expect(empty).toMatchObject({ ok: false, score: 0, error: 'Empty reply (no content)' });
  });
});
