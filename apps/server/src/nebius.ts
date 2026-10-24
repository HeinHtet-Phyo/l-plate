// Minimal Nebius Token Factory client (OpenAI-compatible): timeouts, retries on 429/5xx, clear 401/402 errors.

export const NEBIUS_BASE = 'https://api.tokenfactory.nebius.com/v1';

export class NebiusError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface NebiusClientOptions {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  retries?: number;
  backoffMs?: number;
  /** Sent as `reasoning_effort` on every chat call that doesn't set one ('none' stops reasoning models thinking). */
  reasoningEffort?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function createNebius(opts: NebiusClientOptions) {
  const base = (opts.baseUrl ?? NEBIUS_BASE).replace(/\/$/, '');
  const f = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 20_000;
  const retries = opts.retries ?? 3;
  const backoff = opts.backoffMs ?? 500;

  async function post<T>(path: string, body: unknown): Promise<T> {
    let lastErr: Error | null = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      let res: Response;
      try {
        res = await f(`${base}${path}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${opts.apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (e) {
        lastErr = new NebiusError(0, `Nebius request failed: ${(e as Error).message}`);
        if (attempt < retries) await sleep(backoff * 2 ** attempt);
        continue;
      }
      if (res.ok) return (await res.json()) as T;
      // Gateways answer with HTML error pages; keep only the text.
      const detail = (await res.text().catch(() => '')).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
      if (res.status === 401) throw new NebiusError(401, 'Nebius rejected the API key (401). Check NEBIUS_API_KEY.');
      if (res.status === 402) throw new NebiusError(402, 'Nebius account is out of credit (402). Top up in Token Factory.');
      lastErr = new NebiusError(res.status, `Nebius HTTP ${res.status}: ${detail}`);
      if (res.status === 429 || res.status >= 500) {
        if (attempt < retries) await sleep(backoff * 2 ** attempt);
        continue;
      }
      throw lastErr;
    }
    throw lastErr ?? new NebiusError(0, 'Nebius request failed');
  }

  return {
    chat(body: Record<string, unknown>) {
      if (opts.reasoningEffort && !('reasoning_effort' in body)) body = { ...body, reasoning_effort: opts.reasoningEffort };
      return post<{ choices: { message: { content: string | null; reasoning_content?: string } }[]; usage?: unknown }>(
        '/chat/completions',
        body,
      );
    },
    embed(model: string, input: string[]) {
      return post<{ data: { embedding: number[]; index: number }[] }>('/embeddings', { model, input });
    },
    rerank(model: string, query: string, documents: string[], topN: number) {
      return post<{ results: { index: number; relevance_score: number }[] }>('/rerank', {
        model,
        query,
        documents,
        top_n: topN,
      });
    },
  };
}

export type NebiusClient = ReturnType<typeof createNebius>;
