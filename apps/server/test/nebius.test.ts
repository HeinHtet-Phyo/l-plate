import { describe, expect, it, vi } from 'vitest';
import { createNebius, NebiusError } from '../src/nebius.ts';
import { cosine } from '../src/rules.ts';

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const err = (status: number) => new Response('nope', { status });

function client(responses: (() => Response | Promise<Response>)[]) {
  const f = vi.fn(async () => {
    const next = responses.shift();
    if (!next) throw new Error('no more responses');
    return next();
  });
  return { f, c: createNebius({ apiKey: 'k', fetchImpl: f as unknown as typeof fetch, retries: 2, backoffMs: 1 }) };
}

describe('createNebius', () => {
  it('posts to the Token Factory base URL with a bearer key', async () => {
    const { f, c } = client([() => ok({ choices: [{ message: { content: 'hi' } }] })]);
    const r = await c.chat({ model: 'm', messages: [] });
    expect(r.choices[0].message.content).toBe('hi');
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.tokenfactory.nebius.com/v1/chat/completions');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer k');
  });

  it('retries 429 and 5xx, then succeeds', async () => {
    const { f, c } = client([() => err(429), () => err(503), () => ok({ data: [] })]);
    await expect(c.embed('e', ['x'])).resolves.toEqual({ data: [] });
    expect(f).toHaveBeenCalledTimes(3);
  });

  it('retries network errors and gives up with a NebiusError', async () => {
    const boom = () => {
      throw new TypeError('fetch failed');
    };
    const { f, c } = client([boom, boom, boom]);
    await expect(c.chat({})).rejects.toMatchObject({ status: 0 });
    expect(f).toHaveBeenCalledTimes(3);
  });

  it('fails fast with a clear message on 401, 402 and 400', async () => {
    for (const [status, re] of [
      [401, /API key/],
      [402, /credit/],
      [400, /HTTP 400/],
    ] as const) {
      const { f, c } = client([() => err(status)]);
      const e = await c.chat({}).catch((x) => x);
      expect(e).toBeInstanceOf(NebiusError);
      expect(e.status).toBe(status);
      expect(e.message).toMatch(re);
      expect(f).toHaveBeenCalledTimes(1);
    }
  });
});

describe('cosine', () => {
  it('is 1 for parallel, 0 for orthogonal, and safe on zero vectors', () => {
    expect(cosine([1, 2], [2, 4])).toBeCloseTo(1);
    expect(cosine([1, 0], [0, 3])).toBe(0);
    expect(cosine([0, 0], [0, 0])).toBe(0);
  });
});
