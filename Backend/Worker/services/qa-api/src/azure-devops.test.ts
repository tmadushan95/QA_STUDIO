import { describe, expect, it } from 'vitest';
import type { Run, TestCase } from '@qa-studio/shared';
import { createApp } from './app.js';
import {
  AzureDevOpsService,
  CONFIG_KEY,
  outcomeOf,
  parseSteps,
  plainText,
  type PipelineHost,
} from './azure-devops.js';
import { MemoryStore } from './store.js';

const STEPS_XML =
  '<steps id="0" last="3"><step id="2" type="ActionStep"><parameterizedString isformatted="true">&lt;DIV&gt;&lt;P&gt;Open the &amp;quot;Projects&amp;quot; page&lt;/P&gt;&lt;/DIV&gt;</parameterizedString><parameterizedString isformatted="true">&lt;P&gt;The list shows&lt;/P&gt;</parameterizedString><description/></step>' +
  '<compref id="3" ref="999"></compref>' +
  '<step id="4" type="ValidateStep"><parameterizedString isformatted="true">Click Save</parameterizedString><parameterizedString isformatted="true"></parameterizedString></step></steps>';

interface Call {
  method: string;
  url: string;
  body?: unknown;
  auth?: string | undefined;
}

function setup(responses: Record<string, unknown> = {}) {
  const config = new Map<string, unknown>();
  const calls: Call[] = [];
  const store = new MemoryStore();
  const fetch = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? 'GET';
    calls.push({
      method,
      url: u,
      ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}),
      auth: (init?.headers as Record<string, string>)['Authorization'],
    });
    const key = Object.keys(responses).find((k) => `${method} ${u}`.includes(k));
    if (key === undefined) return new Response('{}', { status: 200 });
    const value = responses[key];
    if (typeof value === 'number') return new Response('', { status: value });
    return new Response(JSON.stringify(value), { status: 200 });
  }) as typeof globalThis.fetch;
  const service = new AzureDevOpsService({
    store: { loadConfig: (k) => config.get(k), saveConfig: (k, v) => void config.set(k, v) },
    // A reversible stand-in for the real encryption, enough to prove the token is not stored as typed.
    box: {
      encrypt: (s) => `enc:${[...s].reverse().join('')}`,
      decrypt: (s) => (s.startsWith('enc:') ? [...s.slice(4)].reverse().join('') : undefined),
    },
    inventory: store.inventory,
    audit: () => undefined,
    fetch,
  });
  const app = createApp(store, { azureDevOps: service });
  return { service, app, config, calls, store };
}

const TOKEN = 'abcdefghijklmnopqrstuvwxyz0123456789';

async function connect(s: ReturnType<typeof setup>, extra: object = {}) {
  await s.app.inject({
    method: 'PUT',
    url: '/api/azure-devops',
    payload: { orgUrl: 'https://dev.azure.com/contoso/', project: 'Shop App', ...extra },
  });
  await s.app.inject({ method: 'PUT', url: '/api/azure-devops/token', payload: { token: TOKEN } });
}

describe('Azure DevOps text helpers', () => {
  it('reads action and expected result from the Steps field, decoding twice, and names shared steps', () => {
    expect(parseSteps(STEPS_XML)).toEqual([
      { action: 'Open the "Projects" page', expected: 'The list shows' },
      { action: 'Run the shared steps of work item 999' },
      { action: 'Click Save' },
    ]);
    expect(parseSteps(undefined)).toEqual([]);
  });

  it('turns rich text into one plain line', () => {
    expect(plainText('<div>Line one<br/>Line&nbsp;two</div><p>&lt;tag&gt; &#65;</p>')).toBe(
      'Line one Line two <tag> A',
    );
  });

  it('maps every QA Studio result to an Azure DevOps outcome', () => {
    expect(['passed', 'failed', 'blocked', 'cancelled', 'skipped'].map(outcomeOf)).toEqual([
      'Passed',
      'Failed',
      'Blocked',
      'NotExecuted',
      'NotExecuted',
    ]);
  });
});

describe('Azure DevOps connection', () => {
  it('stores the token encrypted, never returns it, and says what is missing', async () => {
    const s = setup();
    expect((await s.app.inject({ url: '/api/azure-devops' })).json()).toMatchObject({
      ready: false,
      hasToken: false,
    });
    await connect(s);
    const view = (await s.app.inject({ url: '/api/azure-devops' })).json();
    expect(view).toMatchObject({
      ready: true,
      hasToken: true,
      config: { orgUrl: 'https://dev.azure.com/contoso', project: 'Shop App' },
    });
    expect(JSON.stringify(view)).not.toContain(TOKEN);
    expect(s.config.get('azure-devops-pat')).not.toBe(TOKEN);
  });

  it('refuses an http address and a short token, naming the field', async () => {
    const s = setup();
    const r = await s.app.inject({
      method: 'PUT',
      url: '/api/azure-devops',
      payload: { orgUrl: 'http://dev.azure.com/x', project: 'P' },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().error.fields).toHaveProperty('orgUrl');
    const t = await s.app.inject({
      method: 'PUT',
      url: '/api/azure-devops/token',
      payload: { token: 'short' },
    });
    expect(t.json().error.fields).toHaveProperty('token');
  });

  it('lists plans with Basic auth on the project URL, and explains a refused token', async () => {
    const s = setup({
      'testplan/plans': { value: [{ id: 7, name: 'Release 2', state: 'Active' }] },
    });
    await connect(s);
    const plans = await s.app.inject({ url: '/api/azure-devops/plans' });
    expect(plans.json().items).toEqual([{ id: 7, name: 'Release 2', state: 'Active' }]);
    expect(s.calls[0]!.url).toBe(
      'https://dev.azure.com/contoso/Shop%20App/_apis/testplan/plans?api-version=7.1',
    );
    expect(s.calls[0]!.auth).toBe(`Basic ${Buffer.from(`:${TOKEN}`).toString('base64')}`);

    const refused = setup({ 'testplan/plans': 401 });
    await connect(refused);
    expect(
      (await refused.app.inject({ method: 'POST', url: '/api/azure-devops/test' })).json(),
    ).toMatchObject({ ok: false });
  });
});

describe('Azure DevOps import and publishing', () => {
  const responses = {
    'Plans/7/suites': { value: [{ id: 11, name: 'Checkout' }] },
    'Suites/11/TestCase': { value: [{ workItem: { id: 501 } }, { workItem: { id: 502 } }] },
    'POST https://dev.azure.com/contoso/Shop%20App/_apis/wit/workitemsbatch': {
      value: [
        {
          id: 501,
          fields: {
            'System.Title': 'Pay by card',
            'Microsoft.VSTS.TCM.Steps': STEPS_XML,
            'Microsoft.VSTS.Common.Priority': 1,
            'System.Tags': 'smoke; payments',
          },
        },
        { id: 502, fields: { 'System.Title': 'Pay by voucher' } },
      ],
    },
    'Suites/11/TestPoint': {
      value: [
        { id: 9001, testCaseReference: { id: 501 } },
        { id: 9002, testCaseReference: { id: 502 } },
      ],
    },
    'POST https://dev.azure.com/contoso/Shop%20App/_apis/test/runs': {
      id: 77,
      webAccessUrl: 'https://dev.azure.com/run/77',
    },
    'GET https://dev.azure.com/contoso/Shop%20App/_apis/test/Runs/77/results': {
      value: [
        { id: 1, testCase: { id: '501' } },
        { id: 2, testCase: { id: '502' } },
      ],
    },
  };

  it('imports a suite as ADO-<id> cases with steps, priority, tags and filing hints, and updates on re-import', async () => {
    const s = setup(responses);
    await connect(s, { testSuiteId: 4, projectVersionId: 9 });
    const r = await s.app.inject({
      method: 'POST',
      url: '/api/azure-devops/import',
      payload: { planId: 7, suiteId: 11 },
    });
    expect(r.json()).toEqual({ added: 2, updated: 0, caseIds: ['ADO-501', 'ADO-502'] });
    const tc = s.store.inventory.get('ADO-501')!;
    expect(tc).toMatchObject({
      title: 'Pay by card',
      module: 'Checkout',
      priority: 'High',
      tags: ['smoke', 'payments'],
      testSuiteId: 4,
      projectVersionId: 9,
      source: { workbook: 'azure-devops', worksheet: 'Plan 7 / Suite 11', rowNumber: 501 },
    });
    expect(tc.steps).toHaveLength(3);
    const again = await s.app.inject({
      method: 'POST',
      url: '/api/azure-devops/import',
      payload: { planId: 7, suiteId: 11 },
    });
    expect(again.json()).toMatchObject({ added: 0, updated: 2 });
  });

  it('files new cases in the chosen QA Studio project, but never moves one people already filed', async () => {
    const s = setup(responses);
    await connect(s, { projectId: 5, projectVersionId: 9 });
    s.store.inventory.set('ADO-502', {
      ...(s.store.inventory.get('ADO-502') ?? {}),
      schemaVersion: 1,
      id: 'ADO-502',
      title: 'Old',
      steps: [],
      tags: [],
      dependsOn: [],
      readiness: 'ready',
      source: { workbook: 'azure-devops', worksheet: 'x', rowNumber: 502 },
      projectId: 3,
      projectName: 'Elsewhere',
    } as TestCase);
    await s.service.importCases({ planId: 7, suiteId: 11 });
    expect(s.store.inventory.get('ADO-501')).toMatchObject({ projectId: 5, projectVersionId: 9 });
    expect(s.store.inventory.get('ADO-502')).toMatchObject({
      projectId: 3,
      projectName: 'Elsewhere',
    });
  });

  it('publishes the worst result per work item to the suite test points and completes the run', async () => {
    const s = setup(responses);
    await connect(s);
    await s.service.importCases({ planId: 7, suiteId: 11 });
    const run = {
      id: 'run-1234567890',
      cases: [
        { caseId: 'ADO-501', status: 'passed', account: 'a', steps: [{ durationMs: 100 }] },
        {
          caseId: 'ADO-501',
          status: 'failed',
          account: 'b',
          failure: { kind: 'assertion', message: 'Total wrong' },
          steps: [{ durationMs: 50 }],
        },
        { caseId: 'ADO-502', status: 'blocked', steps: [] },
        { caseId: 'TC_LOCAL', status: 'passed', steps: [] },
      ],
    } as unknown as Run;
    const out = await s.service.publishResults({ planId: 7, suiteId: 11, run });
    expect(out).toEqual({ azureRunId: 77, url: 'https://dev.azure.com/run/77', published: 2 });
    const created = s.calls.find((c) => c.method === 'POST' && c.url.includes('/test/runs'))!;
    expect(created.body).toMatchObject({
      plan: { id: '7' },
      pointIds: [9001, 9002],
      automated: true,
    });
    const patched = s.calls.find((c) => c.method === 'PATCH' && c.url.includes('/results'))!;
    expect(patched.body).toEqual([
      {
        id: 1,
        state: 'Completed',
        outcome: 'Failed',
        durationInMs: 50,
        errorMessage: 'Total wrong',
      },
      { id: 2, state: 'Completed', outcome: 'Blocked', durationInMs: 0 },
    ]);
    expect(s.calls.at(-1)).toMatchObject({ method: 'PATCH', body: { state: 'Completed' } });
  });
});

describe('Azure DevOps pipeline', () => {
  const host = (over: Partial<PipelineHost> = {}): PipelineHost => ({
    convert: () => Promise.resolve({ ready: 2, needsReview: 0 }),
    approve: () => Promise.resolve(2),
    runnable: (ids) => ids,
    configure: () => Promise.resolve(0),
    run: (ids) =>
      Promise.resolve({
        id: 'r1',
        cases: ids.map((caseId) => ({ caseId, status: 'passed', steps: [] })),
      } as unknown as Run),
    ...over,
  });
  const responses = {
    'Plans/7/suites': { value: [{ id: 11, name: 'Checkout' }] },
    'Suites/11/TestCase': { value: [{ workItem: { id: 501 } }] },
    'wit/workitemsbatch': { value: [{ id: 501, fields: { 'System.Title': 'Pay' } }] },
  };

  async function finished(s: ReturnType<typeof setup>) {
    for (let i = 0; i < 50 && s.service.jobsList()[0]?.status === 'running'; i++) {
      await new Promise((r) => setTimeout(r, 10));
    }
    return s.service.jobsList()[0]!;
  }

  it('runs every stage in order and records the run', async () => {
    const s = setup(responses);
    await connect(s, { planId: 7, suiteId: 11, publishResults: false });
    const job = s.service.startPipeline({}, host());
    expect(job.status).toBe('running');
    const done = await finished(s);
    expect(done.status).toBe('done');
    expect(done.runId).toBe('r1');
    expect(done.steps.map((x) => `${x.stage}:${x.status}`)).toEqual([
      'import:done',
      'convert:done',
      'approve:done',
      'parameters:done',
      'run:done',
      'publish:skipped',
    ]);
  });

  it('stops with a reason when nothing is ready, and refuses a second pipeline while one runs', async () => {
    const s = setup(responses);
    await connect(s, { planId: 7, suiteId: 11 });
    let release: () => void = () => undefined;
    const slow = host({
      convert: () => new Promise((r) => (release = () => r({ ready: 0, needsReview: 1 }))),
      runnable: () => [],
    });
    s.service.startPipeline({}, slow);
    await new Promise((r) => setTimeout(r, 20));
    expect(() => s.service.startPipeline({}, slow)).toThrow(/already running/);
    release();
    const done = await finished(s);
    expect(done.status).toBe('failed');
    expect(done.error).toMatch(/No test case is ready/);
    expect(done.steps.find((x) => x.stage === 'publish')!.status).toBe('skipped');
  });

  it('needs a plan and suite, and a connection', async () => {
    const s = setup(responses);
    expect(() => s.service.startPipeline({}, host())).toThrow();
    s.config.set(CONFIG_KEY, { orgUrl: 'https://dev.azure.com/c', project: 'P' });
    s.config.set('azure-devops-pat', `enc:${[...TOKEN].reverse().join('')}`);
    expect(() => s.service.startPipeline({}, host())).toThrow(/plan and suite/);
  });
});

// Type-only check that imported cases keep the shared schema's shape.
const _shape: Pick<TestCase, 'testSuiteId' | 'projectVersionId'> = {
  testSuiteId: 1,
  projectVersionId: 2,
};
void _shape;
