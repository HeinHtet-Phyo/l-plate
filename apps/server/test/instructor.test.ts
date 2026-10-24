import { describe, expect, it, vi } from 'vitest';
import type { DebriefRequest, InstructorRequest } from '@lplate/shared';
import { createNebius } from '../src/nebius.ts';
import {
  MAX_TURNS,
  RateLimiter,
  buildInstructorMessages,
  cleanSpoken,
  dvsaResult,
  nebiusDebrief,
  ruleBasedDebrief,
  validateDebrief,
} from '../src/instructor.ts';

const status: InstructorRequest['status'] = {
  speedMph: 21.4,
  limitMph: 20,
  road: 'Goodmayes Road',
  indicator: 'off',
  handbrake: false,
  nextInstruction: 'Turn left onto High Road',
  distanceToNext: '200 yards',
  faultsSoFar: 1,
};

/** A fetch that returns the given chat content once, recording request bodies. */
function chatFetch(content: string | (() => Response)) {
  const bodies: any[] = [];
  const f = vi.fn(async (_url: string, init: RequestInit) => {
    bodies.push(JSON.parse(String(init.body)));
    if (typeof content === 'function') return content();
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
  });
  return { f, bodies, client: createNebius({ apiKey: 'test', fetchImpl: f as unknown as typeof fetch, retries: 0 }) };
}

const req = (faults: DebriefRequest['faults']): DebriefRequest => ({
  route: 'Goodmayes',
  faults,
  stats: { distance: 5600, duration: 1500, maxSpeedOverLimit: 4 },
});
const fault = (kind: string, category: string) => ({ kind, category, text: `${category} fault`, road: 'High Road', time: 60 });

describe('buildInstructorMessages', () => {
  it('puts the car status in the system prompt and SIM notes last', () => {
    const m = buildInstructorMessages({ sessionId: 's', turns: [], sim: ['Turn left ahead'], status });
    expect(m[0].role).toBe('system');
    expect(m[0].content).toContain('21 mph in a 20 mph limit on Goodmayes Road');
    expect(m[0].content).toContain('Turn left onto High Road (200 yards)');
    expect(m.at(-1)).toEqual({ role: 'user', content: '[SIM] Turn left ahead' });
  });

  it('adds a placeholder when there is nothing to say', () => {
    const m = buildInstructorMessages({ sessionId: 's', turns: [], sim: [], status });
    expect(m).toHaveLength(2);
    expect(m[1].content).toBe('[SIM] (nothing new)');
  });

  it('caps history, merges consecutive roles, and lists quoted rules', () => {
    const turns = Array.from({ length: 30 }, (_, i) => ({ role: i % 3 ? 'learner' : 'instructor', text: `t${i}` }) as const);
    const m = buildInstructorMessages({ sessionId: 's', turns: [...turns], sim: ['x'], status }, [
      { rule: '170', title: 'Junctions', text: 'Take extra care at junctions.', score: 1 },
    ]);
    const text = m.map((x) => x.content).join('\n');
    expect(text).not.toContain('t0\n');
    expect(text).toContain(`t${30 - MAX_TURNS}`);
    for (let i = 1; i < m.length; i++) expect(m[i].role).not.toBe(m[i - 1].role);
    expect(m[0].content).toContain('Rule 170: Take extra care');
  });
});

describe('cleanSpoken', () => {
  it('strips thinking, stage directions and SIM echoes', () => {
    expect(cleanSpoken('<think>hmm</think>*smiles* Turn left here. [SIM] leaked')).toBe('Turn left here.');
  });
  it('keeps at most two sentences and strips wrapping quotes', () => {
    expect(cleanSpoken('"One. Two! Three? Four."')).toBe('One. Two!');
  });
});

describe('RateLimiter', () => {
  it('allows one request per interval per key', () => {
    let t = 0;
    const r = new RateLimiter(1000, () => t);
    expect(r.allow('a')).toBe(true);
    expect(r.allow('a')).toBe(false);
    expect(r.allow('b')).toBe(true);
    t = 1000;
    expect(r.allow('a')).toBe(true);
  });
});

describe('validateDebrief / dvsaResult', () => {
  const good = { result: 'pass', summary: ' Nice. ', faults: [{ category: 'Signals', severity: 'driving', count: 2.4, advice: 'a' }], focusNext: ['x'] };

  it('accepts and normalises a valid debrief', () => {
    expect(validateDebrief(good)).toEqual({ ...good, summary: 'Nice.', faults: [{ ...good.faults[0], count: 2 }] });
  });

  it.each([
    ['null', null],
    ['bad result', { ...good, result: 'maybe' }],
    ['empty summary', { ...good, summary: '  ' }],
    ['bad severity', { ...good, faults: [{ ...good.faults[0], severity: 'minor' }] }],
    ['bad focusNext', { ...good, focusNext: [1] }],
  ])('rejects %s', (_n, x) => {
    expect(() => validateDebrief(x)).toThrow();
  });

  it('applies the DVSA rule', () => {
    expect(dvsaResult([])).toBe('pass');
    expect(dvsaResult([{ severity: 'driving', count: 15 }])).toBe('pass');
    expect(dvsaResult([{ severity: 'driving', count: 10 }, { severity: 'driving', count: 6 }])).toBe('fail');
    expect(dvsaResult([{ severity: 'serious', count: 1 }])).toBe('fail');
  });
});

describe('ruleBasedDebrief', () => {
  it('passes a clean drive', () => {
    const d = ruleBasedDebrief(req([]));
    expect(d).toMatchObject({ result: 'pass', faults: [], source: 'offline' });
    expect(d.summary).toContain('clean drive');
  });

  it('groups faults and fails on a collision', () => {
    const d = ruleBasedDebrief(req([fault('kerb', 'Steering'), fault('kerb', 'Steering'), fault('collision', 'Control')]));
    expect(d.result).toBe('fail');
    expect(d.faults).toEqual([
      expect.objectContaining({ category: 'Steering', severity: 'driving', count: 2 }),
      expect.objectContaining({ category: 'Control', severity: 'dangerous', count: 1 }),
    ]);
  });
});

describe('nebiusDebrief (mocked fetch)', () => {
  it('sends a strict JSON schema and returns the model debrief', async () => {
    const { client, bodies } = chatFetch(
      JSON.stringify({ result: 'pass', summary: 'Good drive.', faults: [{ category: 'Signals', severity: 'driving', count: 1, advice: 'Signal earlier.' }], focusNext: [] }),
    );
    const d = await nebiusDebrief(client, 'm', req([fault('signal', 'Signals')]));
    expect(bodies[0].response_format.type).toBe('json_schema');
    expect(bodies[0].response_format.json_schema.strict).toBe(true);
    expect(d).toMatchObject({ result: 'pass', source: 'nebius' });
    expect(d.modelResult).toBe('pass');
  });

  it('overrides a model that contradicts the DVSA rule', async () => {
    const { client } = chatFetch(
      '```json\n' +
        JSON.stringify({ result: 'pass', summary: 'Lovely.', faults: [{ category: 'Junctions', severity: 'serious', count: 1, advice: 'Look.' }], focusNext: [] }) +
        '\n```',
    );
    const d = await nebiusDebrief(client, 'm', req([fault('redLight', 'Junctions')]));
    expect(d.result).toBe('fail');
    expect(d.modelResult).toBe('pass');
    expect(d.summary).toContain('this drive is a fail');
  });

  it('strips Highway Code rule numbers that were not quoted', async () => {
    const { client } = chatFetch(
      JSON.stringify({
        result: 'pass',
        summary: 'Mostly fine (Rule 999).',
        faults: [{ category: 'Junctions', severity: 'driving', count: 1, advice: 'Look both ways (see Rule 170).' }],
        focusNext: [],
      }),
    );
    const d = await nebiusDebrief(client, 'm', req([fault('kerb', 'Junctions')]), [{ rule: '170', title: 'J', text: 'Junctions', score: 1 }]);
    expect(d.summary).toBe('Mostly fine.');
    expect(d.faults[0].advice).toBe('Look both ways (see Rule 170).');
  });

  it('throws on bad JSON so the caller can fall back', async () => {
    const { client } = chatFetch('Sure! Here is your debrief: pass');
    await expect(nebiusDebrief(client, 'm', req([]))).rejects.toThrow();
    const { client: c2 } = chatFetch(JSON.stringify({ result: 'pass' }));
    await expect(nebiusDebrief(c2, 'm', req([]))).rejects.toThrow();
  });
});
