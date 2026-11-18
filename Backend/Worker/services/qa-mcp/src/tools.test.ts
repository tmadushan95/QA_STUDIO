import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it } from 'vitest';
import { ApiError, CLIENT_HEADER, httpApi, type Api } from './client.js';
import { createMcpServer, type McpServerOptions } from './tools.js';
import { parseToolsets, TOOLSETS } from './toolsets.js';

/** A fake platform that records calls and answers by "METHOD path" prefix. */
function fakeApi(routes: Record<string, unknown> = {}) {
  const calls: { method: string; path: string; body?: unknown }[] = [];
  const answer = (key: string) => {
    const hit = Object.entries(routes).find(([k]) => key.startsWith(k));
    if (!hit) throw new ApiError('not found', 404);
    const value = typeof hit[1] === 'function' ? (hit[1] as () => unknown)() : hit[1];
    if (value instanceof Error) throw value;
    return value;
  };
  const api: Api = {
    get: async (path) => (calls.push({ method: 'GET', path }), answer(`GET ${path}`)),
    send: async (method, path, body) => (
      calls.push({ method, path, body }), answer(`${method} ${path}`)
    ),
  };
  return { api, calls };
}

async function connect(
  api: Api,
  options: McpServerOptions = {},
  elicit?: (message: string) => { action: 'accept' | 'decline'; content?: { confirm: boolean } },
) {
  const [a, b] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer(api, { pollMs: 1, ...options });
  const client = new Client(
    { name: 'test', version: '1' },
    elicit ? { capabilities: { elicitation: { form: {} } } } : {},
  );
  if (elicit) client.setRequestHandler(ElicitRequestSchema, (r) => elicit(r.params.message));
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}

const body = <T = Record<string, unknown>>(r: unknown) =>
  JSON.parse((r as { content: { text: string }[] }).content[0]!.text) as T;
const text = (r: unknown) => (r as { content: { text: string }[] }).content[0]!.text;
const names = async (options: McpServerOptions = {}) =>
  (await (await connect(fakeApi().api, options)).listTools()).tools.map((t) => t.name).sort();

describe('toolsets', () => {
  it('offers read, author and operate by default, and nothing that deletes or files bugs', async () => {
    const tools = await names();
    expect(tools).toContain('search_test_cases');
    expect(tools).toContain('create_test_case');
    expect(tools).toContain('start_run');
    expect(tools.filter((n) => n.startsWith('delete_'))).toEqual([]);
    expect(tools).not.toContain('report_defect');
  });

  it('read alone offers no tool that writes', async () => {
    const client = await connect(fakeApi().api, { toolsets: ['read'] });
    const { tools } = await client.listTools();
    const writers = tools.filter((t) => !t.annotations?.readOnlyHint).map((t) => t.name);
    expect(writers).toEqual([]);
  });

  it('never offers approving, restoring, settings, keys, accounts or connections, whatever is turned on', async () => {
    const tools = await names({ toolsets: TOOLSETS });
    expect(
      tools.filter((n) =>
        /approve|restore|setting|key|token|account|connection|backup|secret/.test(n),
      ),
    ).toEqual([]);
    expect(tools).toContain('delete_project');
    expect(tools).toContain('report_defect');
  });

  it('marks every tool with its risk, and keeps schemas simple enough for every client', async () => {
    const client = await connect(fakeApi().api, { toolsets: TOOLSETS });
    const { tools } = await client.listTools();
    for (const t of tools) {
      expect(t.annotations?.readOnlyHint, t.name).toBeTypeOf('boolean');
      expect(t.description!.length, t.name).toBeGreaterThan(20);
      // Gemini and some other clients reject these JSON Schema features.
      expect(JSON.stringify(t.inputSchema), t.name).not.toMatch(/"(anyOf|oneOf|allOf|\$ref)"/);
    }
    const destructive = tools.filter((t) => t.annotations?.destructiveHint).map((t) => t.name);
    expect(destructive.every((n) => n.startsWith('delete_'))).toBe(true);
  });

  it('parses QA_MCP_TOOLSETS, always including read, and refuses unknown names', () => {
    expect([...parseToolsets(undefined)]).toEqual(['read', 'author', 'operate']);
    expect([...parseToolsets('operate, defects')]).toEqual(['read', 'operate', 'defects']);
    expect(() => parseToolsets('read,everything')).toThrow('unknown toolsets: everything');
  });
});

describe('test cases', () => {
  it("searches the API's test cases with filters and returns short summaries and the next page", async () => {
    const { api, calls } = fakeApi({
      'GET /api/test-cases': {
        total: 30,
        page: 1,
        pageSize: 25,
        items: [
          {
            id: 'TC_04',
            title: 'Delete',
            module: 'Projects',
            priority: 'High',
            readiness: 'ready',
            testSuiteName: 'Smoke',
            projectName: 'CRM',
            steps: [{ order: 1, action: 'x' }],
            rowVersion: 'AAA',
          },
        ],
      },
    });
    const client = await connect(api, { defaultProjectId: 3 });
    const r = await client.callTool({ name: 'search_test_cases', arguments: { query: 'delete' } });
    expect(body(r)).toEqual({
      total: 30,
      page: 1,
      nextPage: 2,
      items: [
        {
          id: 'TC_04',
          title: 'Delete',
          module: 'Projects',
          priority: 'High',
          readiness: 'ready',
          suite: 'Smoke',
          project: 'CRM',
        },
      ],
    });
    expect((r as { structuredContent?: unknown }).structuredContent).toMatchObject({ total: 30 });
    expect(calls[0]!.path).toBe('/api/test-cases?projectId=3&q=delete&pageSize=25');
  });

  it('gets one test case directly, and says so when it does not exist', async () => {
    const { api, calls } = fakeApi({
      'GET /api/test-cases/TC_04': { id: 'TC_04', title: 'Delete' },
      'GET /api/test-cases/TC_99': new ApiError('There is no test case TC_99.', 404, 'not-found'),
    });
    const client = await connect(api);
    expect(
      body(await client.callTool({ name: 'get_test_case', arguments: { id: 'TC_04' } })),
    ).toMatchObject({ id: 'TC_04' });
    expect(calls[0]!.path).toBe('/api/test-cases/TC_04');
    const missing = await client.callTool({ name: 'get_test_case', arguments: { id: 'TC_99' } });
    expect(missing.isError).toBe(true);
  });

  it('updates only the fields passed, keeping the rest and sending the row version', async () => {
    const { api, calls } = fakeApi({
      'GET /api/test-cases/TC_04': {
        id: 'TC_04',
        title: 'Delete',
        module: 'Projects',
        priority: 'High',
        tags: ['smoke'],
        steps: [],
        testSuiteId: 7,
        rowVersion: 'RV1',
      },
      'PUT /api/test-cases/TC_04': { id: 'TC_04' },
    });
    const client = await connect(api);
    await client.callTool({
      name: 'update_test_case',
      arguments: { id: 'TC_04', priority: 'Low' },
    });
    expect(calls[1]).toMatchObject({
      method: 'PUT',
      body: {
        title: 'Delete',
        module: 'Projects',
        priority: 'Low',
        tags: ['smoke'],
        testSuiteId: 7,
        rowVersion: 'RV1',
      },
    });
    expect(calls[1]!.body).not.toHaveProperty('writtenSteps');
  });

  it('creates a case with written steps in the suite', async () => {
    const { api, calls } = fakeApi({ 'POST /api/test-cases': { id: 'TC_05' } });
    const client = await connect(api);
    await client.callTool({
      name: 'create_test_case',
      arguments: {
        suiteId: 2,
        title: 'Add',
        steps: [{ action: 'Click Add', expected: 'A form opens' }],
      },
    });
    expect(calls[0]!.body).toEqual({
      title: 'Add',
      testSuiteId: 2,
      writtenSteps: [{ action: 'Click Add', expected: 'A form opens' }],
    });
  });
});

describe('deletes', () => {
  const routes = {
    'GET /api/projects/4': { id: 4, code: 'CRM', name: 'Sales', rowVersion: 'x' },
    'DELETE /api/projects/4': undefined,
  };

  it('need the target named again', async () => {
    const { api, calls } = fakeApi(routes);
    const client = await connect(api, { toolsets: ['admin'] });
    const wrong = await client.callTool({
      name: 'delete_project',
      arguments: { projectId: 4, confirm: 'Sales' },
    });
    expect(wrong.isError).toBe(true);
    expect(text(wrong)).toContain('confirm: "CRM"');
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    const right = await client.callTool({
      name: 'delete_project',
      arguments: { projectId: 4, confirm: 'CRM' },
    });
    expect(right.isError).toBeFalsy();
    expect(calls.at(-1)).toMatchObject({ method: 'DELETE', path: '/api/projects/4' });
  });

  it('ask the person when the client can, and stop when they decline', async () => {
    const { api, calls } = fakeApi(routes);
    const asked: string[] = [];
    const client = await connect(
      api,
      { toolsets: ['admin'] },
      (m) => (asked.push(m), { action: 'decline' }),
    );
    const r = await client.callTool({
      name: 'delete_project',
      arguments: { projectId: 4, confirm: 'CRM' },
    });
    expect(r.isError).toBe(true);
    expect(asked[0]).toContain('Delete project CRM');
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
  });
});

describe('scenarios, parameters and AI', () => {
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
    expect(body<{ issues: string[] }>(r).issues[0]).toContain('Unknown action');
    expect(calls[0]).toMatchObject({
      method: 'PUT',
      body: { steps: [{ action: 'x', params: {} }], note: '[via MCP] From the plan' },
    });
  });

  it('hides secret parameter values in both shapes the API uses', async () => {
    const { api } = fakeApi({
      'GET /api/parameters/TC_04': {
        values: { userName: 'qa1', password: 'hunter2' },
        items: [
          { name: 'apiKey', value: 'k-123', common: 'k-000', source: 'case' },
          { name: 'city', value: 'Oslo' },
        ],
      },
    });
    const client = await connect(api);
    const r = body(
      await client.callTool({ name: 'get_case_parameters', arguments: { caseId: 'TC_04' } }),
    );
    expect(r['values']).toEqual({ userName: 'qa1', password: '[hidden]' });
    expect(r['items']).toEqual([
      { name: 'apiKey', value: '[hidden]', common: '[hidden]', source: 'case' },
      { name: 'city', value: 'Oslo' },
    ]);
  });

  it('proposes test cases without saving, then adds the chosen ones to a suite', async () => {
    const { api, calls } = fakeApi({
      'POST /api/ai/cases/preview': {
        cases: [
          { title: 'Delete asks first', steps: ['Click Delete'], expectedResult: 'A dialog' },
        ],
      },
      'POST /api/ai/cases': { items: [{ id: 'TC_10' }] },
    });
    const client = await connect(api, { defaultProjectId: 3 });
    await client.callTool({
      name: 'propose_test_cases',
      arguments: { prompt: 'Users can delete drafts', coverage: 'smoke' },
    });
    expect(calls[0]!.body).toEqual({
      prompt: 'Users can delete drafts',
      projectId: 3,
      options: { coverage: 'smoke' },
    });
    await client.callTool({
      name: 'add_test_cases',
      arguments: {
        cases: [
          { title: 'Delete asks first', steps: ['Click Delete'], expectedResult: 'A dialog' },
        ],
        suiteId: 9,
      },
    });
    expect(calls[1]).toMatchObject({
      path: '/api/ai/cases',
      body: { projectId: 3, testSuiteId: 9 },
    });
  });
});

describe('runs', () => {
  const finished = {
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
          {
            index: 1,
            action: 'assert.text-visible',
            description: 'Text "Done" is visible',
            status: 'failed',
          },
        ],
      },
    ],
  };

  it('starts a run and returns its ID; summarises a run with the failing step', async () => {
    const { api } = fakeApi({
      'POST /api/runs': { id: 'run-1', status: 'queued' },
      'GET /api/runs/run-1': finished,
    });
    const client = await connect(api);
    expect(
      body(await client.callTool({ name: 'start_run', arguments: { caseIds: ['TC_04'] } })),
    ).toEqual({ runId: 'run-1', status: 'queued' });
    const run = body<{ cases: unknown[] }>(
      await client.callTool({ name: 'get_run', arguments: { runId: 'run-1' } }),
    );
    expect(run.cases[0]).toMatchObject({
      caseId: 'TC_04',
      failedStep: {
        index: 1,
        action: 'assert.text-visible',
        description: 'Text "Done" is visible',
      },
    });
  });

  it('waits for a run, reporting progress, until it finishes', async () => {
    let reads = 0;
    const running = {
      ...finished,
      status: 'running',
      cases: [{ caseId: 'TC_04', status: 'running', steps: [] }],
    };
    const { api } = fakeApi({ 'GET /api/runs/run-1': () => (++reads < 3 ? running : finished) });
    const client = await connect(api);
    const progress: number[] = [];
    const r = await client.callTool(
      { name: 'wait_for_run', arguments: { runId: 'run-1' } },
      undefined,
      { onprogress: (p) => void progress.push(p.progress) },
    );
    expect(body(r)).toMatchObject({ finished: true, status: 'failed' });
    expect(reads).toBe(3);
    expect(progress).toEqual([0, 0, 1]);
  });

  it('reruns only the failed cases of a finished run', async () => {
    const { api, calls } = fakeApi({
      'GET /api/runs/run-1': finished,
      'POST /api/runs': { id: 'run-2', status: 'queued' },
    });
    const client = await connect(api);
    const r = body(
      await client.callTool({
        name: 'rerun_failed_cases',
        arguments: { runId: 'run-1', accountIds: ['a1'] },
      }),
    );
    expect(r).toMatchObject({ runId: 'run-2', failedCaseIds: ['TC_04'] });
    expect(calls[1]).toMatchObject({
      method: 'POST',
      body: { caseIds: ['TC_04'], accountIds: ['a1'] },
    });
  });

  it('turns platform errors into tool errors with the platform message and what to do', async () => {
    const { api } = fakeApi({
      'POST /api/runs': new ApiError('Runs are unavailable: enter the app address.', 400),
      'GET /api/runs/x': new ApiError(
        'The test runner service is not running.',
        503,
        'worker-unavailable',
      ),
    });
    const client = await connect(api);
    const r = await client.callTool({ name: 'start_run', arguments: { caseIds: ['TC_04'] } });
    expect(r.isError).toBe(true);
    expect(text(r)).toBe('Runs are unavailable: enter the app address.');
    expect(text(await client.callTool({ name: 'get_run', arguments: { runId: 'x' } }))).toContain(
      'npm start in Backend/Worker',
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

describe('Azure DevOps and defects', () => {
  it('files a defect through the platform and lists filed ones from the audit trail', async () => {
    const { api, calls } = fakeApi({
      'POST /api/azure-devops/defects': { action: 'filed', bugId: 900 },
      'GET /api/audit': {
        items: [{ action: 'azure-devops.defect', target: 'TC_04' }, { action: 'inventory.create' }],
      },
    });
    const client = await connect(api, { toolsets: ['defects'] });
    await client.callTool({
      name: 'report_defect',
      arguments: { runId: 'run-2', caseId: 'TC_04', storyId: 42 },
    });
    expect(calls[0]).toMatchObject({ body: { runId: 'run-2', caseId: 'TC_04', storyId: 42 } });
    const listed = body(await client.callTool({ name: 'list_reported_defects', arguments: {} }));
    expect(listed['items']).toEqual([{ action: 'azure-devops.defect', target: 'TC_04' }]);
  });
});

describe('resources and prompts', () => {
  it('lists and reads resources from the platform', async () => {
    const { api } = fakeApi({
      'GET /api/projects/1': { id: 1, code: 'CRM' },
      'GET /api/projects': { items: [{ id: 1, code: 'CRM', name: 'Sales' }] },
      'GET /api/project-versions': { items: [] },
      'GET /api/test-suites': { items: [{ id: 2 }] },
      'GET /api/automation': { actions: [{ name: 'nav.open' }] },
    });
    const client = await connect(api);
    const { resources } = await client.listResources();
    expect(resources.map((r) => r.uri)).toEqual(
      expect.arrayContaining(['qa://actions', 'qa://docs/step-format', 'qa://projects/1']),
    );
    const project = await client.readResource({ uri: 'qa://projects/1' });
    expect(JSON.parse((project.contents[0] as { text: string }).text)).toMatchObject({
      project: { code: 'CRM' },
      suites: [{ id: 2 }],
    });
    const guide = await client.readResource({ uri: 'qa://docs/step-format' });
    expect((guide.contents[0] as { text: string }).text.length).toBeGreaterThan(100);
  });

  it('offers the workflows as prompts that name the tools to use', async () => {
    const client = await connect(fakeApi().api);
    const { prompts } = await client.listPrompts();
    expect(prompts.map((p) => p.name).sort()).toEqual([
      'automate-test-case',
      'coverage-review',
      'generate-cases-from-requirement',
      'triage-failed-run',
    ]);
    const p = await client.getPrompt({
      name: 'automate-test-case',
      arguments: { caseId: 'TC_12' },
    });
    const t = (p.messages[0]!.content as { text: string }).text;
    expect(t).toContain('TC_12');
    expect(t).toContain('validate_scenario');
  });
});

describe('HTTP client', () => {
  it('sends the access token, the client name and JSON bodies', async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const api = httpApi({
      baseUrl: 'http://127.0.0.1:4000/',
      token: 'tok-1234567890abcdef',
      fetch: (async (url: string, init: RequestInit) => (
        seen.push({ url, init }), new Response('{"ok":true}')
      )) as typeof fetch,
    });
    await api.send('POST', '/api/runs', { caseIds: ['A'] });
    const headers = seen[0]!.init.headers as Record<string, string>;
    expect(seen[0]!.url).toBe('http://127.0.0.1:4000/api/runs');
    expect(headers['authorization']).toBe('Bearer tok-1234567890abcdef');
    expect(headers[CLIENT_HEADER]).toMatch(/^mcp\//);
    expect(seen[0]!.init.body).toBe('{"caseIds":["A"]}');
  });

  it('explains an unreachable platform and a missing token, and keeps the error code', async () => {
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
    const stopped = httpApi({
      baseUrl: 'http://x',
      fetch: (async () =>
        new Response('{"error":{"code":"worker-unavailable","message":"Stopped."}}', {
          status: 503,
        })) as typeof fetch,
    });
    await expect(stopped.get('/api/runs')).rejects.toMatchObject({
      code: 'worker-unavailable',
      status: 503,
    });
  });
});
