import { describe, expect, it } from 'vitest';
import { ParameterClient } from './parameter-client.js';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function client(handler: (url: URL, init: RequestInit) => Response | Promise<Response>) {
  const seen: { method: string; path: string; token: string; body: unknown }[] = [];
  const c = new ParameterClient({
    baseUrl: 'http://api:5080',
    token: 'secret-token-0123456789',
    fetch: async (input, init) => {
      const url = new URL(String(input));
      seen.push({
        method: String(init?.method),
        path: url.pathname,
        token: new Headers(init?.headers).get('x-qa-internal-token') ?? '',
        body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
      });
      return handler(url, init ?? {});
    },
  });
  return { c, seen };
}

describe('the parameter client', () => {
  it('asks the API for the values a run will use, with the internal secret', async () => {
    const { c, seen } = client(() => json({ items: { TC_1: { project: 'PRJ-1' } } }));
    expect(await c.effective(['TC_1'])).toEqual({ TC_1: { project: 'PRJ-1' } });
    expect(seen).toEqual([
      {
        method: 'POST',
        path: '/internal/persistence/parameters/effective',
        token: 'secret-token-0123456789',
        body: { caseIds: ['TC_1'] },
      },
    ]);
  });

  it('asks for nothing when there are no cases', async () => {
    const { c, seen } = client(() => json({ items: {} }));
    expect(await c.effective([])).toEqual({});
    expect(seen).toEqual([]);
  });

  it('exports, imports, clears and auto-fills through the API', async () => {
    const { c, seen } = client((url) =>
      url.pathname.endsWith('/auto')
        ? json({ configured: 1, filled: 2, stillMissing: [] })
        : url.pathname.endsWith('/export')
          ? json({ items: { TC_1: { a: 'b' } } })
          : json({ imported: 1, deleted: 3 }),
    );
    expect(await c.exportAll()).toEqual({ TC_1: { a: 'b' } });
    await c.importAll({ TC_1: { a: 'b' } });
    expect(await c.clear()).toBe(3);
    expect(await c.autoConfigure(['TC_1'], false)).toMatchObject({ configured: 1, filled: 2 });
    expect(seen.map((s) => `${s.method} ${s.path}`)).toEqual([
      'GET /internal/persistence/parameters/export',
      'POST /internal/persistence/parameters/import',
      'DELETE /internal/persistence/parameters',
      'POST /internal/persistence/parameters/auto',
    ]);
  });

  it('says plainly that the values could not be had when the API is down or refuses', async () => {
    const down = client(() => {
      throw new TypeError('fetch failed');
    });
    await expect(down.c.effective(['TC_1'])).rejects.toMatchObject({
      status: 503,
      code: 'parameters-unavailable',
    });
    const refused = client(() => json({}, 500));
    await expect(refused.c.effective(['TC_1'])).rejects.toMatchObject({ status: 503 });
  });
});
