import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NebiusClient } from '../src/nebius.ts';
import { loadRules, searchRules, setRules } from '../src/rules.ts';

const db = {
  model: 'test-embed',
  chunks: [
    { rule: '126', title: 'Stopping distances', text: 'Allow at least a two-second gap.', v: [1, 0, 0] },
    { rule: '170', title: 'Road junctions', text: 'Take extra care at junctions.', v: [0, 1, 0] },
    { rule: '185', title: 'Roundabouts', text: 'Give priority to traffic from the right.', v: [0, 0, 1] },
    { rule: '240', title: 'Parking', text: 'You MUST NOT stop or park on zig-zag lines.', v: [0.7, 0.7, 0] },
  ],
};

function fake(vec: number[], rerank?: NebiusClient['rerank']) {
  const embed = vi.fn(async (_model: string, input: string[]) => ({ data: input.map((_, index) => ({ embedding: vec, index })) }));
  const rr = vi.fn(rerank ?? (async () => ({ results: [] })));
  return { embed, rerank: rr, client: { chat: vi.fn(), embed, rerank: rr } as unknown as NebiusClient };
}

afterEach(() => setRules());

describe('searchRules', () => {
  it('embeds the query with the db model and returns the top 3 by cosine', async () => {
    setRules(db);
    const { client, embed } = fake([1, 0.2, 0]);
    const hits = await searchRules(client, 'two second rule');
    expect(embed).toHaveBeenCalledWith('test-embed', ['two second rule']);
    expect(hits.map((h) => h.rule)).toEqual(['126', '240', '170']);
    expect(hits[0]).toMatchObject({ title: 'Stopping distances', text: 'Allow at least a two-second gap.' });
    expect(hits[0].score).toBeGreaterThan(hits[1].score);
  });

  it('reorders by rerank when a rerank model is given', async () => {
    setRules(db);
    const { client, rerank } = fake([1, 0.2, 0], async () => ({ results: [{ index: 2, relevance_score: 0.9 }, { index: 0, relevance_score: 0.5 }] }));
    const hits = await searchRules(client, 'junction', 'rr-model');
    expect(rerank).toHaveBeenCalledWith('rr-model', 'junction', expect.arrayContaining(['Rule 170: Take extra care at junctions.']), 3);
    expect(hits.map((h) => [h.rule, h.score])).toEqual([['170', 0.9], ['126', 0.5]]);
  });

  it('falls back to cosine order when rerank fails', async () => {
    setRules(db);
    const { client } = fake([0, 0, 1], async () => {
      throw new Error('rerank down');
    });
    const hits = await searchRules(client, 'roundabout priority', 'rr-model');
    expect(hits[0].rule).toBe('185');
  });

  it('returns nothing for a blank query or a missing db, without calling Nebius', async () => {
    setRules(db);
    const a = fake([1, 0, 0]);
    expect(await searchRules(a.client, '   ')).toEqual([]);
    setRules(null);
    expect(await searchRules(a.client, 'anything')).toEqual([]);
    expect(a.embed).not.toHaveBeenCalled();
  });

  it('loadRules returns null for a missing file', () => {
    expect(loadRules(new URL('file:///nonexistent/highway-code.json'))).toBeNull();
  });
});
