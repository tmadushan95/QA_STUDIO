import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import { ApiError, httpApi, type Api } from './client.js';
import { createMcpServer } from './tools.js';

/** A fake platform that records calls. */
function fakeApi(routes: Record<string, unknown | Error>) {
  const calls: { method: string; path: string; body?: unknown }[] = [];
  const answer = (key: string) => {
    const hit = Object.entries(routes).find(([k]) => key.startsWith(k));
    if (!hit) throw new ApiError('not found', 404);
    if (hit[1] instanceof Error) throw hit[1];
    return hit[1];
  };
  const api: Api = {
    get: async (path) => (calls.push({ method: 'GET', path }), answer(`GET ${path}`)),
    send: async (method, path, body) => (
      calls.push({ method, path, body }), answer(`${method} ${path}`)
    ),
  };
  return { api, calls };
}

async function connect(api: Api) {
  const [a, b] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer(api);
  const client = new Client({ name: 'test', version: '1' });
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}

const body = (r: { content: unknown }) => JSON.parse((r.content as { text: string }[])[0]!.text);

describe('MCP tools', () => {
  it('lists the tools, and nothing that approves, deletes or changes settings', async () => {
    const client = await connect(fakeApi({}).api);
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      'get_run',
      'get_scenario',
      'get_test_case',
      'list_actions',
      'list_runs',
      'save_scenario_draft',
      'search_knowledge',
      'search_test_cases',
      'start_run',
    ]);
    expect(names.some((n) => /approve|delete|setting|key/.test(n))).toBe(false);
    const readOnly = tools.filter((t) => t.annotations?.readOnlyHint).map((t) => t.name);
    expect(readOnly).not.toContain('save_scenario_draft');
    expect(readOnly).not.toContain('start_run');
    expect(tools.find((t) => t.name === 'save_scenario_draft')!.description).toContain(
      'never runs',
    );
  });

  it('searches test cases through the platform API', async () => {
    const { api, calls } = fakeApi({
      'GET /api/inventory': {
        total: 1,
        items: [
          { id: 'TC_04', title: 'Delete', module: 'Project deletion', priority: 'High', steps: [] },
        ],
      },
    });
    const client = await connect(api);
    const r = await client.callTool({
      name: 'search_test_cases',
      arguments: { query: 'delete', limit: 5 },
    });
    expect(body(r as { content: unknown })).toEqual({
      total: 1,
      items: [{ id: 'TC_04', title: 'Delete', module: 'Project deletion', priority: 'High' }],
    });
    expect(calls[0]!.path).toBe('/api/inventory?q=delete&pageSize=5');
  });

  it('gets one test case by exact ID, and says so when it does not exist', async () => {
    const { api } = fakeApi({
      'GET /api/inventory': {
        items: [
          { id: 'TC_04x', title: 'x' },
          { id: 'TC_04', title: 'Delete' },
        ],
      },
    });
    const client = await connect(api);
    expect(
      body(
        (await client.callTool({ name: 'get_test_case', arguments: { id: 'TC_04' } })) as {
          content: unknown;
        },
      ),
    ).toMatchObject({ id: 'TC_04' });
    const missing = await client.callTool({ name: 'get_test_case', arguments: { id: 'TC_99' } });
    expect(missing.isError).toBe(true);
  });

  it('saves a draft marked as coming through MCP, and passes the platform checks back', async () => {
    const { api, calls } = fakeApi({
      'PUT /api/scenarios/TC_04/draft': {
        status: 'draft',
        issues: ['Step 1 (x): Unknown action "x".'],
      },
    });
    const client = await connect(api);
    const r = await client.callTool({
      name: 'save_scenario_draft',
      arguments: { caseId: 'TC_04', steps: [{ action: 'x', params: {} }], note: 'From the plan' },
    });
    expect(body(r as { content: unknown }).issues[0]).toContain('Unknown action');
    expect(calls[0]).toMatchObject({
      method: 'PUT',
      body: { steps: [{ action: 'x', params: {} }], note: '[via MCP] From the plan' },
    });
  });

  it('starts a run and returns its ID; summarises a run with the failing step', async () => {
    const { api } = fakeApi({
      'POST /api/runs': { id: 'run-1', status: 'queued' },
      'GET /api/runs/run-1': {
        id: 'run-1',
        status: 'failed',
        summary: { total: 1 },
        cases: [
          {
            caseId: 'TC_04',
            status: 'failed',
            failure: { kind: 'assertion', message: 'not visible' },
            steps: [
              { index: 0, action: 'auth.sign-in', status: 'passed' },
              { index: 1, action: 'assert.text-visible', status: 'failed' },
            ],
          },
        ],
      },
    });
    const client = await connect(api);
    expect(
      body(
        (await client.callTool({ name: 'start_run', arguments: { caseIds: ['TC_04'] } })) as {
          content: unknown;
        },
      ),
    ).toEqual({ runId: 'run-1', status: 'queued' });
    const run = body(
      (await client.callTool({ name: 'get_run', arguments: { runId: 'run-1' } })) as {
        content: unknown;
      },
    );
    expect(run.cases[0]).toMatchObject({
      caseId: 'TC_04',
      failedStep: { index: 1, action: 'assert.text-visible' },
    });
  });

  it('turns platform errors into tool errors with the platform message', async () => {
    const { api } = fakeApi({
      'POST /api/runs': new ApiError('Runs are unavailable: enter the app address.', 400),
    });
    const client = await connect(api);
    const r = await client.callTool({ name: 'start_run', arguments: { caseIds: ['TC_04'] } });
    expect(r.isError).toBe(true);
    expect((r.content as { text: string }[])[0]!.text).toBe(
      'Runs are unavailable: enter the app address.',
    );
  });

  it('rejects arguments outside the limits before calling the platform', async () => {
    const { api, calls } = fakeApi({});
    const client = await connect(api);
    const r = await client.callTool({
      name: 'start_run',
      arguments: { caseIds: Array.from({ length: 26 }, (_, i) => `T${i}`) },
    });
    expect(r.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });
});

describe('HTTP client', () => {
  it('sends the access token as a bearer header and JSON bodies', async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const api = httpApi({
      baseUrl: 'http://127.0.0.1:4000/',
      token: 'tok-1234567890abcdef',
      fetch: (async (url: string, init: RequestInit) => (
        seen.push({ url, init }), new Response('{"ok":true}')
      )) as typeof fetch,
    });
    await api.send('POST', '/api/runs', { caseIds: ['A'] });
    expect(seen[0]!.url).toBe('http://127.0.0.1:4000/api/runs');
    expect((seen[0]!.init.headers as Record<string, string>)['authorization']).toBe(
      'Bearer tok-1234567890abcdef',
    );
    expect(seen[0]!.init.body).toBe('{"caseIds":["A"]}');
  });

  it('explains an unreachable platform and a missing token', async () => {
    const down = httpApi({
      baseUrl: 'http://127.0.0.1:1',
      fetch: (async () => {
        throw new Error('ECONNREFUSED');
      }) as typeof fetch,
    });
    await expect(down.get('/api/runs')).rejects.toThrow('not reachable at http://127.0.0.1:1');
    const locked = httpApi({
      baseUrl: 'http://x',
      fetch: (async () => new Response('{}', { status: 401 })) as typeof fetch,
    });
    await expect(locked.get('/api/runs')).rejects.toThrow('Set QA_ADMIN_TOKEN');
  });
});
