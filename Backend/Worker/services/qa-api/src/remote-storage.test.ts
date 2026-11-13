import { describe, expect, it } from 'vitest';
import { SCHEMA_VERSION, type TestCase } from '@qa-studio/shared';
import { RemoteStorage, type RemoteOperation, type RemoteSnapshot } from './remote-storage.js';
import { MemoryStore } from './store.js';

const tc = (id: string): TestCase => ({
  schemaVersion: SCHEMA_VERSION,
  id,
  title: `Title ${id}`,
  steps: [],
  tags: [],
  dependsOn: [],
  readiness: 'needs-clarification',
  source: { workbook: 'w.xlsx', worksheet: 'S', rowNumber: 2 },
});

const emptySnapshot: RemoteSnapshot = {
  testCases: [],
  scenarios: [],
  revisions: [],
  runs: [],
  config: {},
  accounts: [],
  sessions: [],
  aiKeys: [],
  backups: [],
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** A stand-in for the .NET API that records every batch, and answers batches as told. */
function fakeApi(snapshot: Partial<RemoteSnapshot> = {}) {
  const batches: RemoteOperation[][] = [];
  const state = { batchStatus: 200, offline: false, tokens: new Set<string>() };
  const fetchFn: typeof fetch = async (url, init) => {
    if (state.offline) throw new TypeError('fetch failed');
    state.tokens.add(new Headers(init?.headers).get('x-qa-internal-token') ?? '');
    if (String(url).endsWith('/snapshot')) return json({ ...emptySnapshot, ...snapshot });
    if (String(url).endsWith('/test-cases')) return json({ items: [tc('TC_REMOTE')] });
    if (String(url).includes('/config?prefix=pages'))
      return json({
        items: [{ key: 'pages:3', value: [{ name: 'Home', route: '/', marker: '' }] }],
      });
    if (state.batchStatus !== 200) return json({}, state.batchStatus);
    batches.push((JSON.parse(String(init?.body)) as { operations: RemoteOperation[] }).operations);
    return json({ applied: 1 });
  };
  const errors: string[] = [];
  const storage = new RemoteStorage({
    baseUrl: 'http://api/',
    token: 'secret',
    fetch: fetchFn,
    retryMs: 1,
    log: { info: () => undefined, error: (m) => errors.push(m) },
  });
  return { storage, batches, state, errors };
}

describe('storage backed by the API', () => {
  it('starts from the database and sends nothing back for what it loaded', async () => {
    const { storage, batches, state } = fakeApi({
      testCases: [tc('TC_1')],
      config: { 'case-parameters': { TC_1: { project: 'PRJ-1' } } },
      scenarios: [{ slot: 'approved', caseId: 'TC_1', record: { caseId: 'TC_1' } }],
    });
    await storage.connect();
    await storage.flush();
    expect(storage.loadCases().items.map((c) => c.id)).toEqual(['TC_1']);
    expect(storage.loadConfig('case-parameters')).toEqual({ TC_1: { project: 'PRJ-1' } });
    expect(storage.loadScenarioRecords('approved')).toEqual([{ caseId: 'TC_1' }]);
    expect(batches).toEqual([]);
    expect(state.tokens).toEqual(new Set(['secret']));
  });

  it('skips a stored case that no longer matches the schema instead of refusing to start', async () => {
    const { storage } = fakeApi({ testCases: [tc('TC_1'), { id: 'broken' }] });
    await storage.connect();
    expect(storage.loadCases().items.map((c) => c.id)).toEqual(['TC_1']);
  });

  it('stops at once on a wrong secret, rather than waiting', async () => {
    const storage = new RemoteStorage({
      baseUrl: 'http://api',
      token: 'wrong',
      fetch: async () => json({}, 401),
      log: { info: () => undefined, error: () => undefined },
    });
    await expect(storage.connect(60_000)).rejects.toThrow(/QA_INTERNAL_TOKEN/);
  });

  it('sends every write in order, and reads see it immediately', async () => {
    const { storage, batches } = fakeApi();
    await storage.connect();
    storage.saveCase(tc('TC_1'));
    storage.saveScenarioRecord('draft', 'TC_1', { version: 1 });
    storage.deleteScenarioRecord('draft', 'TC_1');
    storage.saveConfig('case-parameters', { TC_1: { a: 'b' } });
    expect(storage.loadConfig('case-parameters')).toEqual({ TC_1: { a: 'b' } });
    await storage.flush();
    expect(batches.flat().map((o) => o.kind)).toEqual([
      'test-case.upsert',
      'scenario.upsert',
      'scenario.delete',
      'config.upsert',
    ]);
  });

  it('keeps only the latest waiting state of a run, but never reorders around clearing runs', async () => {
    const { storage, batches } = fakeApi();
    await storage.connect();
    const run = (status: string) =>
      ({ id: 'r1', createdAt: '2026-01-01T00:00:00.000Z', status }) as never;
    storage.saveRun(run('queued'));
    storage.saveRun(run('running'));
    storage.deleteAllRuns();
    storage.saveRun(run('passed'));
    await storage.flush();
    const ops = batches.flat();
    expect(ops.map((o) => o.kind)).toEqual(['run.upsert', 'run.delete-all', 'run.upsert']);
    expect((ops[0]!.payload as { status: string }).status).toBe('running');
    expect((ops[2]!.payload as { status: string }).status).toBe('passed');
  });

  it('keeps writes queued and in order while the API is away, then delivers them', async () => {
    const { storage, batches, state } = fakeApi();
    await storage.connect();
    state.offline = true;
    storage.saveCase(tc('TC_1'));
    await expect(storage.flush()).rejects.toThrow();
    storage.saveCase(tc('TC_2'));
    state.offline = false;
    await storage.flush();
    expect(batches.flat().map((o) => o.key)).toEqual(['TC_1', 'TC_2']);
  });

  it('reports content the database refuses, and does not let it block later writes', async () => {
    const { storage, batches, state, errors } = fakeApi();
    await storage.connect();
    state.batchStatus = 400;
    storage.saveCase(tc('TC_BAD'));
    await expect(storage.flush()).rejects.toThrow(/refused/);
    expect(errors).toEqual(['the API refused writes']);
    state.batchStatus = 200;
    storage.saveCase(tc('TC_OK'));
    await storage.flush();
    expect(batches.flat().map((o) => o.key)).toEqual(['TC_OK']);
  });

  it('splits a long import into several ordered transactions', async () => {
    const { storage, batches } = fakeApi();
    await storage.connect();
    const small = new RemoteStorage({
      baseUrl: 'http://api',
      token: 'secret',
      batchSize: 2,
      fetch: (async (url: string, init?: RequestInit) => {
        batches.push(
          (JSON.parse(String(init?.body)) as { operations: RemoteOperation[] }).operations,
        );
        return json({ applied: 1 });
      }) as typeof fetch,
      log: { info: () => undefined, error: () => undefined },
    });
    for (const id of ['A', 'B', 'C', 'D', 'E']) small.saveCase(tc(id));
    await small.flush();
    expect(batches.map((b) => b.length)).toEqual([2, 2, 1]);
    expect(batches.flat().map((o) => o.key)).toEqual(['A', 'B', 'C', 'D', 'E']);
  });
});

describe('the inventory and changes made through the API', () => {
  it('applies them without writing them back', async () => {
    const { storage, batches } = fakeApi({ testCases: [tc('TC_1'), tc('TC_2')] });
    await storage.connect();
    const store = new MemoryStore(storage);
    store.applyRemote([tc('TC_3')], ['TC_1']);
    expect([...store.inventory.keys()]).toEqual(['TC_2', 'TC_3']);
    await storage.flush();
    expect(batches).toEqual([]);
  });

  it('takes the database list as the whole truth before a run', async () => {
    const { storage, batches } = fakeApi({ testCases: [tc('TC_1')] });
    await storage.connect();
    const store = new MemoryStore(storage);
    store.replaceFromRemote(await storage.fetchCases());
    expect([...store.inventory.keys()]).toEqual(['TC_REMOTE']);
    expect(batches).toEqual([]);
  });

  it('takes a configuration block the API changed without writing it back, and fetches blocks again before a run', async () => {
    const { storage, batches } = fakeApi();
    await storage.connect();
    storage.applyRemoteConfig('pages', [{ name: 'Home', route: '/', marker: '' }]);
    expect(storage.loadConfig('pages')).toEqual([{ name: 'Home', route: '/', marker: '' }]);
    await storage.flush();
    expect(batches).toEqual([]); // it is already in the database
    const fetched = await storage.fetchConfig('pages');
    expect(fetched).toEqual([
      { key: 'pages:3', value: [{ name: 'Home', route: '/', marker: '' }] },
    ]);
  });

  it('still writes through for changes the worker itself makes', async () => {
    const { storage, batches } = fakeApi();
    await storage.connect();
    const store = new MemoryStore(storage);
    store.inventory.set('TC_9', tc('TC_9'));
    store.inventory.delete('TC_9');
    await storage.flush();
    expect(batches.flat().map((o) => o.kind)).toEqual(['test-case.upsert', 'test-case.delete']);
  });
});
