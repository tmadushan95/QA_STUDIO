import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { ActionRegistry, registerAppActions } from '@qa-studio/automation-core';
import { RunManager, type CaseExecutor } from '@qa-studio/execution-engine';
import { summarizeRun, type Scenario, type TestCase } from '@qa-studio/shared';
import { createApp, type Automation } from './app.js';
import { HttpError } from './errors.js';
import { fakeAccounts, fakeSettings } from './test-support.js';
import { MemoryStore } from './store.js';
import { fakeParameters } from './test-parameters.js';

const tc = (id: string): TestCase => ({
  schemaVersion: 1,
  id,
  title: `Title ${id}`,
  steps: [],
  tags: [],
  dependsOn: [],
  readiness: 'needs-clarification',
  source: { workbook: 'plan.xlsx', worksheet: 'S', rowNumber: 2 },
});
const scenario = (caseId: string): Scenario => ({
  schemaVersion: 1,
  caseId,
  steps: [{ action: 'app.open', params: { path: '/' } }],
});

let store: MemoryStore;
let artifactsDir: string;
let started: string[];
let manager: RunManager;
let release: (() => void) | undefined;

function build(executor?: CaseExecutor): ReturnType<typeof createApp> {
  manager = new RunManager(
    executor ?? {
      execute: async (job) => {
        started.push(job.caseId);
        return {
          status: 'failed',
          steps: [],
          artifacts: [`${job.caseId}/failure.png`],
          failure: { kind: 'assertion', message: 'nope', expected: 'a', actual: 'b' },
        };
      },
    },
  );
  const automation: Automation = {
    runs: manager,
    registry: registerAppActions(new ActionRegistry()),
    scenarios: new Map([['TC-1', scenario('TC-1')]]),
    artifactsDir,
    settings: fakeSettings(),
  };
  return createApp(store, automation);
}

beforeEach(() => {
  store = new MemoryStore();
  for (const id of ['TC-1', 'TC-2']) store.inventory.set(id, tc(id));
  artifactsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'api-art-'));
  started = [];
  release = undefined;
});

/** The finished run with its summary, as the API serves it from the database. Read from the manager here. */
async function waitDone(_app: ReturnType<typeof createApp>, id: string) {
  const run = await manager.whenDone(id);
  if (!run) throw new Error('run did not finish');
  return { ...run, summary: summarizeRun(run) };
}

describe('automation availability', () => {
  it('reports why runs are unavailable and refuses to start one', async () => {
    const app = createApp(store, {
      registry: registerAppActions(new ActionRegistry()),
      runs: new RunManager({
        execute: async () => ({ status: 'passed', steps: [], artifacts: [] }),
      }),
      settings: fakeSettings({ reason: 'Environment "prod" is not an allowed environment.' }),
    });
    const info = (await app.inject({ url: '/api/automation' })).json();
    expect(info).toMatchObject({
      runsAvailable: false,
      reason: expect.stringContaining('not an allowed environment'),
    });
    expect(info.actions.map((a: { name: string }) => a.name)).toContain('nav.open-page');
    const res = await app.inject({
      method: 'POST',
      url: '/api/runs',
      payload: { caseIds: ['TC-1'] },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('environment-not-configured');
  });
});

describe('runs', () => {
  it('starts a run (202), blocks unmapped cases, and reports results with a summary', async () => {
    const app = build();
    const res = await app.inject({
      method: 'POST',
      url: '/api/runs',
      payload: { caseIds: ['TC-1', 'TC-2', 'TC-1'] },
    });
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.cases.map((c: { caseId: string }) => c.caseId)).toEqual(['TC-1', 'TC-2']); // de-duplicated
    expect(body.cases[0].source).toEqual({ workbook: 'plan.xlsx', worksheet: 'S', rowNumber: 2 });
    const done = await waitDone(app, body.id);
    expect(started).toEqual(['TC-1']); // TC-2 has no scenario and never reaches the executor
    expect(done.cases.map((c: { status: string }) => c.status)).toEqual(['failed', 'blocked']);
    expect(done.summary).toMatchObject({
      total: 2,
      passRate: 0,
      counts: { failed: 1, blocked: 1 },
    });
    expect(manager.list()[0]!.id).toBe(body.id);
  });

  it('validates requests: unknown test cases 404, bad bodies 400, unknown runs 404', async () => {
    const app = build();
    expect(
      (await app.inject({ method: 'POST', url: '/api/runs', payload: { caseIds: ['NOPE'] } }))
        .statusCode,
    ).toBe(404);
    expect(
      (await app.inject({ method: 'POST', url: '/api/runs', payload: { caseIds: [] } })).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/runs',
          payload: { caseIds: ['TC-1'], workers: 99 },
        })
      ).statusCode,
    ).toBe(400);
    expect((await app.inject({ url: '/api/runs/nope/artifact?path=x' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/api/runs/nope/cancel' })).statusCode).toBe(
      404,
    );
  });

  it('cancels a run in progress', async () => {
    const gate = new Promise<void>((r) => (release = r));
    const app = build({
      execute: async (_j, { signal }) => (
        await gate, { status: signal.aborted ? 'cancelled' : 'passed', steps: [], artifacts: [] }
      ),
    });
    const run = (
      await app.inject({ method: 'POST', url: '/api/runs', payload: { caseIds: ['TC-1'] } })
    ).json();
    await new Promise((r) => setTimeout(r, 30));
    expect(
      (await app.inject({ method: 'POST', url: `/api/runs/${run.id}/cancel` })).json(),
    ).toEqual({ cancelled: true });
    release!();
    expect((await waitDone(app, run.id)).status).toBe('cancelled');
    expect(
      (await app.inject({ method: 'POST', url: `/api/runs/${run.id}/cancel` })).json(),
    ).toEqual({ cancelled: false });
  });
});

describe('artifacts', () => {
  it('serves only files the run reported, and never paths outside the run directory', async () => {
    const app = build();
    const run = (
      await app.inject({ method: 'POST', url: '/api/runs', payload: { caseIds: ['TC-1'] } })
    ).json();
    await waitDone(app, run.id);
    fs.mkdirSync(path.join(artifactsDir, run.id, 'TC-1'), { recursive: true });
    fs.writeFileSync(path.join(artifactsDir, run.id, 'TC-1', 'failure.png'), 'PNGDATA');
    fs.writeFileSync(path.join(artifactsDir, run.id, 'secret.txt'), 'secret');
    fs.writeFileSync(path.join(artifactsDir, 'outside.txt'), 'outside');

    const ok = await app.inject({
      url: `/api/runs/${run.id}/artifact?path=${encodeURIComponent('TC-1/failure.png')}`,
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.headers['content-type']).toBe('image/png');
    expect(ok.body).toBe('PNGDATA');
    for (const p of [
      'secret.txt',
      '../outside.txt',
      '..%2Foutside.txt',
      'TC-1/../secret.txt',
      '',
    ]) {
      expect(
        (await app.inject({ url: `/api/runs/${run.id}/artifact?path=${p}` })).statusCode,
        p,
      ).toBe(404);
    }
  });
});

describe('reports', () => {
  it('serves JSON, HTML and Excel reports built from the same run, as attachments', async () => {
    store.inventory.set('TC-1', { ...tc('TC-1'), module: 'Projects' });
    const app = build();
    const run = (
      await app.inject({ method: 'POST', url: '/api/runs', payload: { caseIds: ['TC-1', 'TC-2'] } })
    ).json();
    await waitDone(app, run.id);

    const json = await app.inject({ url: `/api/runs/${run.id}/report.json` });
    expect(json.statusCode).toBe(200);
    expect(json.headers['content-disposition']).toContain(
      `qa-run-${run.id.slice(0, 8)}-report.json`,
    );
    const report = json.json();
    expect(report).toMatchObject({
      schemaVersion: 1,
      run: { id: run.id, environment: 'qa' },
      summary: { counts: { failed: 1, blocked: 1 } },
    });
    expect(report.coverageByModule.map((m: { module: string }) => m.module)).toEqual([
      '(no module)',
      'Projects',
    ]);
    expect(report.issues.join(' ')).toMatch(/No approved scenario/);

    const html = await app.inject({ url: `/api/runs/${run.id}/report.html` });
    expect(html.headers['content-type']).toContain('text/html');
    expect(html.headers['content-security-policy']).toContain('sandbox');
    expect(html.body).toContain('QA Studio execution report');

    const xlsx = await app.inject({ url: `/api/runs/${run.id}/report.xlsx` });
    expect(xlsx.headers['content-type']).toContain('spreadsheetml');
    expect(xlsx.rawPayload.subarray(0, 2).toString()).toBe('PK');
  });

  it('404s for unknown runs and unknown formats', async () => {
    const app = build();
    expect((await app.inject({ url: '/api/runs/nope/report.json' })).statusCode).toBe(404);
    const run = (
      await app.inject({ method: 'POST', url: '/api/runs', payload: { caseIds: ['TC-1'] } })
    ).json();
    expect((await app.inject({ url: `/api/runs/${run.id}/report.pdf` })).statusCode).toBe(404);
  });
});

describe('parameter values for a run', () => {
  it("takes each case's values from the API when the run starts, own over common, and gives them to the job", async () => {
    const parameters = fakeParameters(
      { 'TC-1': { code: 'OWN' } },
      { projectOf: () => 7, common: { 7: { code: 'COMMON', role: 'Admin' } } },
    );
    const seen: (Record<string, string> | undefined)[] = [];
    const app = createApp(store, {
      runs: new RunManager({
        execute: async (job) => {
          seen.push(job.data);
          return { status: 'passed', steps: [], artifacts: [] };
        },
      }),
      registry: registerAppActions(new ActionRegistry()),
      scenarios: new Map([['TC-1', scenario('TC-1')]]),
      settings: fakeSettings(),
      parameters,
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/runs',
      payload: { caseIds: ['TC-1'] },
    });
    expect(res.statusCode).toBe(202);
    await new Promise((r) => setTimeout(r, 50));
    expect(parameters.asked).toEqual([['TC-1']]);
    expect(seen).toEqual([{ code: 'OWN', role: 'Admin' }]);
  });

  it('refuses the run, and starts nothing, when the values cannot be had', async () => {
    const parameters = fakeParameters();
    parameters.failWith = new HttpError(503, 'parameters-unavailable', 'The API is not running.');
    let executed = 0;
    const app = createApp(store, {
      runs: new RunManager({
        execute: async () => {
          executed++;
          return { status: 'passed', steps: [], artifacts: [] };
        },
      }),
      registry: registerAppActions(new ActionRegistry()),
      scenarios: new Map([['TC-1', scenario('TC-1')]]),
      settings: fakeSettings(),
      parameters,
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/runs',
      payload: { caseIds: ['TC-1'] },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe('parameters-unavailable');
    await new Promise((r) => setTimeout(r, 50));
    expect(executed).toBe(0);
  });
});

describe('runs across test accounts', () => {
  const ACCOUNTS = [
    { id: 'a1', label: 'Approver' },
    { id: 'b1', label: 'Requester' },
  ];
  let jobs: { caseId: string; account?: string }[];

  function withAccounts(loginRequired: boolean) {
    jobs = [];
    const executor: CaseExecutor = {
      execute: async (job) => {
        jobs.push({ caseId: job.caseId, ...(job.account && { account: job.account.label }) });
        return { status: 'passed', steps: [], artifacts: [] };
      },
    };
    manager = new RunManager(executor);
    return createApp(store, {
      runs: manager,
      registry: registerAppActions(new ActionRegistry()),
      scenarios: new Map([
        ['TC-1', scenario('TC-1')],
        ['TC-2', scenario('TC-2')],
      ]),
      artifactsDir,
      settings: fakeSettings({ loginRequired }),
      accounts: fakeAccounts(ACCOUNTS),
    });
  }
  const start = (app: ReturnType<typeof createApp>, body: object) =>
    app.inject({ method: 'POST', url: '/api/runs', payload: body });

  it('runs every chosen case once as each chosen account', async () => {
    const app = withAccounts(true);
    const res = await start(app, { caseIds: ['TC-1', 'TC-2'], accountIds: ['a1', 'b1'] });
    expect(res.statusCode).toBe(202);
    expect(
      res.json().cases.map((c: { caseId: string; account: string }) => `${c.caseId}/${c.account}`),
    ).toEqual(['TC-1/Approver', 'TC-1/Requester', 'TC-2/Approver', 'TC-2/Requester']);
    const done = await waitDone(app, res.json().id);
    expect(done.status).toBe('passed');
    expect(jobs).toHaveLength(4);
    expect(done.summary.total).toBe(4);
  });

  it('asks for an account when sign-in is required, and does not guess one', async () => {
    const app = withAccounts(true);
    for (const body of [{ caseIds: ['TC-1'] }, { caseIds: ['TC-1'], accountIds: [] }]) {
      const res = await start(app, body);
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatchObject({
        code: 'account-required',
        message: expect.stringContaining('Add accounts in Settings'),
      });
    }
    expect(jobs).toEqual([]);
  });

  it('404s for an account that no longer exists, and ignores accounts when no sign-in is needed', async () => {
    expect(
      (await start(withAccounts(true), { caseIds: ['TC-1'], accountIds: ['gone'] })).statusCode,
    ).toBe(404);
    const app = withAccounts(false);
    const res = await start(app, { caseIds: ['TC-1'], accountIds: ['a1', 'b1'] });
    expect(res.statusCode).toBe(202);
    expect(res.json().cases).toHaveLength(1);
    expect(res.json().cases[0].account).toBeUndefined();
  });

  it('refuses a request that would start too many runs, and counts duplicates only once', async () => {
    const app = withAccounts(true);
    for (let i = 0; i < 300; i++) store.inventory.set(`X${i}`, tc(`X${i}`));
    const big = await start(app, {
      caseIds: Array.from({ length: 300 }, (_, i) => `X${i}`),
      accountIds: ['a1', 'b1'],
    });
    expect(big.statusCode).toBe(400);
    expect(big.json().error).toMatchObject({
      code: 'too-many-runs',
      message: expect.stringContaining('600 test runs'),
    });
    const dup = await start(app, { caseIds: ['TC-1', 'TC-1'], accountIds: ['a1', 'a1'] });
    expect(dup.json().cases).toHaveLength(1);
  });

  it('reports the sign-in requirement and account count, so screens can guide the user', async () => {
    const info = (await withAccounts(true).inject({ url: '/api/automation' })).json();
    expect(info).toMatchObject({
      runsAvailable: true,
      loginRequired: true,
      accountCount: 2,
      environment: 'qa',
    });
  });

  it('uses the number of browsers saved in Settings unless the request says otherwise', async () => {
    const mk = (workers: number) =>
      createApp(store, {
        runs: new RunManager({
          execute: async () => ({ status: 'passed', steps: [], artifacts: [] }),
        }),
        scenarios: new Map([['TC-1', scenario('TC-1')]]),
        settings: fakeSettings({ workers }),
      });
    expect((await start(mk(3), { caseIds: ['TC-1'] })).json().workers).toBe(3);
    expect((await start(mk(3), { caseIds: ['TC-1'], workers: 2 })).json().workers).toBe(2);
    expect((await mk(3).inject({ url: '/api/automation' })).json().workers).toBe(3);
  });
});
