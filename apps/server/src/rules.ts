// Highway Code lookup: cosine top-20 over committed embeddings, then Nebius /rerank.
import { existsSync, readFileSync } from 'node:fs';
import type { RuleHit } from '@lplate/shared';
import type { NebiusClient } from './nebius.ts';

interface RuleChunk {
  rule: string;
  title: string;
  text: string;
  v: number[];
}

let cache: { model: string; chunks: RuleChunk[] } | null | undefined;

export function loadRules(file = new URL('../data/highway-code.json', import.meta.url)): typeof cache {
  if (cache !== undefined) return cache;
  try {
    cache = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
  } catch {
    cache = null;
  }
  return cache;
}

export function cosine(a: number[], b: number[]): number {
  let d = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    d += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return d / (Math.sqrt(na * nb) || 1);
}

export async function searchRules(client: NebiusClient, query: string, rerankModel?: string): Promise<RuleHit[]> {
  const db = loadRules();
  if (!db || !query.trim()) return [];
  const [q] = (await client.embed(db.model, [query])).data.map((d) => d.embedding);
  const top = db.chunks
    .map((c) => ({ c, s: cosine(q, c.v) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, 20);
  let order = top.map((t, i) => ({ i, score: t.s }));
  if (rerankModel) {
    try {
      const rr = await client.rerank(rerankModel, query, top.map((t) => `Rule ${t.c.rule}: ${t.c.text}`), 3);
      order = rr.results.map((r) => ({ i: r.index, score: r.relevance_score }));
    } catch {
      // Rerank is optional; cosine order is a fine fallback.
    }
  }
  return order.slice(0, 3).map(({ i, score }) => ({ rule: top[i].c.rule, title: top[i].c.title, text: top[i].c.text, score }));
}
