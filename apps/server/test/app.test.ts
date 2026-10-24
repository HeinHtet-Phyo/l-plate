import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

// Without a key the server must still pair phones and give an offline debrief.
delete process.env.NEBIUS_API_KEY;
process.env.LOG_LEVEL = 'silent';
const { buildApp } = await import('../src/index.ts');

let app: FastifyInstance;
beforeAll(async () => {
  app = buildApp();
  await app.ready();
});
afterAll(() => app.close());

describe('server routes (no Nebius key)', () => {
  it('reports health and pairs', async () => {
    expect((await app.inject('/api/health')).json()).toEqual({ ok: true });
    const pair = (await app.inject({ method: 'POST', url: '/api/pair' })).json();
    expect(pair).toHaveProperty('sessionId');
  });

  it('refuses the instructor without a key', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/instructor', payload: {} });
    expect(r.statusCode).toBe(503);
  });

  it('falls back to a rule-based debrief and sanitises stats', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/debrief',
      payload: { route: 'Goodmayes', faults: [{ kind: 'redLight', category: 'Traffic lights', text: 'red', road: 'x', time: 1 }], stats: { distance: 'lots' } },
    });
    const d = r.json();
    expect(r.statusCode).toBe(200);
    expect(d).toMatchObject({ result: 'fail', source: 'offline' });
    expect(d.error).toMatch(/NEBIUS_API_KEY/);
  });

  it('validates /api/route input', async () => {
    expect((await app.inject('/api/route?from=a,b')).statusCode).toBe(400);
  });
});
