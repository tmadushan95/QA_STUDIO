import { beforeEach, describe, expect, it } from 'vitest';
import { RunManager, type CaseExecutor, type CaseJob } from '@qa-studio/execution-engine';
import { ActionRegistry, registerAppActions } from '@qa-studio/automation-core';
import {
  ConfigError,
  DEFAULT_SETTINGS,
  type AppSettings,
  type Scenario,
  type TestCase,
} from '@qa-studio/shared';
import { createApp } from './app.js';
import { ProjectConnectionService } from './project-connections.js';
import { fakeAccounts, fakeSettings } from './test-support.js';
import { MemoryStore } from './store.js';

const login = { strategy: 'login-form' as const, path: '/login', signedInMarker: '' };
const CAPEX = { envName: 'qa', appUrl: 'http://capex.test', login };
const OPEN = {
  envName: 'uat',
  appUrl: 'http://open.test',
  login: { ...login, strategy: 'none' as const },
};

function make(values: Partial<AppSettings> = {}, stored?: unknown) {
  const config = new Map<string, unknown>(
    stored === undefined ? [] : [['project-connections', stored]],
  );
  const audit: string[] = [];
  const service = new ProjectConnectionService({
    store: { loadConfig: (k) => config.get(k), saveConfig: (k, v) => void config.set(k, v) },
    settings: { values: () => ({ ...DEFAULT_SETTINGS, ...values }) },
    allowedEnvs: ['qa', 'uat'],
    audit: (action) => void audit.push(action),
  });
  return { service, config, audit };
}

describe('project connections', () => {
  it('gives each project its own address and sign-in, keeping execution options install-wide', () => {
    const { service } = make({ workers: 3 });
    service.save(1, CAPEX);
    service.save(2, OPEN);
    expect(service.settingsFor(1)).toMatchObject({ appUrl: 'http://capex.test', workers: 3 });
    expect(service.settingsFor(2)).toMatchObject({
      appUrl: 'http://open.test',
      envName: 'uat',
      workers: 3,
      login: { strategy: 'none' },
    });
  });

  it('applies the safety rules per field, and saves nothing that breaks them', () => {
    const { service } = make();
    const wrong = (input: object) => {
      try {
        service.save(1, input);
      } catch (e) {
        return (e as { fields?: Record<string, string> }).fields;
      }
      return undefined;
    };
    expect(wrong({ ...CAPEX, appUrl: 'https://app.prod.example.com' })?.['appUrl']).toMatch(
      /production-looking/,
    );
    expect(wrong({ ...CAPEX, appUrl: 'http://user:pw@capex.test' })?.['appUrl']).toMatch(
      /username or password/,
    );
    expect(wrong({ ...CAPEX, envName: 'prod' })?.['envName']).toMatch(/not an allowed/);
    expect(service.list().items).toEqual([]);
  });

  it('refuses a run for a project that was never set up, saying which one', () => {
    const { service } = make({ appUrl: 'http://old.test', envName: 'qa' });
    expect(() => service.settingsFor(9)).toThrow(ConfigError);
    expect(service.target(9, 'Capex')).toMatchObject({
      available: false,
      reason: expect.stringContaining('Capex has no application address'),
    });
  });

  it('starts projects that hold cases from the old single address, once only', () => {
    const { service, config } = make({ appUrl: 'http://old.test', envName: 'qa', login });
    service.seedFromSettings([1, 1, 2]);
    expect(service.list().items.map((c) => [c.projectId, c.appUrl])).toEqual([
      [1, 'http://old.test'],
      [2, 'http://old.test'],
    ]);
    // A later start, with the block already stored, must not bring back what people changed.
    const later = make(
      { appUrl: 'http://old.test', envName: 'qa', login },
      {
        1: CAPEX,
      },
    );
    later.service.seedFromSettings([1, 2]);
    expect(later.service.list().items.map((c) => c.appUrl)).toEqual(['http://capex.test']);
    expect(config.has('project-connections')).toBe(true);
  });

  it('seeds nothing when no usable address was set up before', () => {
    const { service, config } = make();
    service.seedFromSettings([1]);
    expect(service.list().items).toEqual([]);
    expect(config.get('project-connections')).toEqual({});
  });

  it('says a stored connection is not ready when its environment leaves the allow-list', () => {
    const { service } = make({}, { 1: { ...CAPEX, envName: 'dev' } });
    expect(service.list().items[0]).toMatchObject({ ready: false });
    expect(service.availability().available).toBe(false);
  });
});

describe('runs across projects', () => {
  const tc = (id: string, projectId?: number, projectName?: string): TestCase => ({
    schemaVersion: 1,
    id,
    title: id,
    steps: [],
    tags: [],
    dependsOn: [],
    readiness: 'needs-clarification',
    source: { workbook: 'x', worksheet: 'S', rowNumber: 2 },
    ...(projectId !== undefined && { projectId }),
    ...(projectName !== undefined && { projectName }),
  });
  const scenario = (caseId: string): Scenario => ({
    schemaVersion: 1,
    caseId,
    steps: [{ action: 'app.open', params: { path: '/' } }],
  });

  let jobs: CaseJob[];
  let app: ReturnType<typeof createApp>;
  let runs: RunManager;

  beforeEach(() => {
    jobs = [];
    const executor: CaseExecutor = {
      execute: async (job) => {
        jobs.push(job);
        return { status: 'passed', steps: [], artifacts: [] };
      },
    };
    const store = new MemoryStore();
    for (const c of [
      tc('C-1', 1, 'Capex'),
      tc('C-2', 1, 'Capex'),
      tc('O-1', 2, 'Open'),
      tc('N-1', 3, 'New'),
      tc('X-1'),
    ])
      store.inventory.set(c.id, c);
    const { service } = make();
    service.save(1, CAPEX);
    service.save(2, OPEN);
    runs = new RunManager(executor);
    app = createApp(store, {
      runs,
      registry: registerAppActions(new ActionRegistry()),
      scenarios: new Map(['C-1', 'C-2', 'O-1'].map((id) => [id, scenario(id)])),
      artifactsDir: 'artifacts',
      settings: fakeSettings({ loginRequired: true }),
      connections: service,
      accounts: fakeAccounts([
        { id: 'a1', label: 'Approver', projectId: 1 },
        { id: 'b1', label: 'Approver', projectId: 2 },
      ]),
    });
  });

  const start = (body: object) => app.inject({ method: 'POST', url: '/api/runs', payload: body });
  const plan = (caseIds: string[]) =>
    app.inject({ method: 'POST', url: '/api/runs/plan', payload: { caseIds } });

  it('plans by project and offers only that project’s accounts', async () => {
    const res = await plan(['C-1', 'C-2', 'O-1', 'N-1']);
    expect(res.statusCode).toBe(200);
    const groups = res.json().groups as Record<string, unknown>[];
    expect(groups).toHaveLength(3);
    expect(groups[0]).toMatchObject({
      projectId: 1,
      projectName: 'Capex',
      caseCount: 2,
      appUrl: 'http://capex.test',
      loginRequired: true,
      available: true,
    });
    expect((groups[0]!['accounts'] as { id: string }[]).map((a) => a.id)).toEqual(['a1']);
    expect(groups[1]).toMatchObject({ projectId: 2, loginRequired: false, accounts: [] });
    expect(groups[2]).toMatchObject({ projectId: 3, available: false });
  });

  it('runs each case as the chosen accounts of its own project, and tells the executor the project', async () => {
    const res = await start({ caseIds: ['C-1', 'O-1'], accountIds: ['a1', 'b1'] });
    expect(res.statusCode).toBe(202);
    expect(res.json().environment).toBe('qa, uat');
    await runs.whenDone(res.json().id);
    expect(jobs.map((j) => [j.caseId, j.projectId, j.account?.id])).toEqual([
      ['C-1', 1, 'a1'],
      ['O-1', 2, undefined],
    ]);
  });

  it('refuses a run touching a project that is not set up, and a case not filed anywhere', async () => {
    for (const id of ['N-1', 'X-1']) {
      const res = await start({ caseIds: ['C-1', id], accountIds: ['a1'] });
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe('project-not-ready');
    }
  });

  it('refuses when the only chosen account belongs to another project', async () => {
    const res = await start({ caseIds: ['C-1'], accountIds: ['b1'] });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatchObject({
      code: 'account-required',
      message: expect.stringContaining('Capex'),
    });
  });

  it('saves through the API, naming wrong fields, and checks without saving', async () => {
    const bad = await app.inject({
      method: 'POST',
      url: '/api/project-connections/check',
      payload: { ...CAPEX, appUrl: 'nonsense' },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.fields['appUrl']).toBeTruthy();
    const put = await app.inject({
      method: 'PUT',
      url: '/api/project-connections/5',
      payload: CAPEX,
    });
    expect(put.json()).toMatchObject({ projectId: 5, ready: true });
    const list = await app.inject({ url: '/api/project-connections' });
    expect(list.json().allowedEnvs).toEqual(['qa', 'uat']);
    expect(list.json().items).toHaveLength(3);
  });
});
