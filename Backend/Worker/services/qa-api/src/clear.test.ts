import { describe, expect, it } from 'vitest';
import { RunManager, type CaseExecutor } from '@qa-studio/execution-engine';
import type { Scenario, TestCase } from '@qa-studio/shared';
import { createApp } from './app.js';
import { SqliteStorage } from './sqlite-storage.js';
import { MemoryStore } from './store.js';
import { fakeSettings } from './test-support.js';

const tc = (id: string): TestCase => ({
  schemaVersion: 1,
  id,
  title: `T ${id}`,
  steps: [],
  tags: [],
  dependsOn: [],
  readiness: 'needs-clarification',
  source: { workbook: 'w.xlsx', worksheet: 'S', rowNumber: 2 },
});
const scn = (id: string): Scenario => ({
  schemaVersion: 1,
  caseId: id,
  steps: [{ action: 'app.open', params: { path: '/' } }],
});
const passing: CaseExecutor = {
  execute: async () => ({ status: 'passed', steps: [], artifacts: [] }),
};

function setup(executor: CaseExecutor = passing) {
  const storage = new SqliteStorage(':memory:');
  const store = new MemoryStore(storage);
  for (const id of ['A', 'B', 'C']) store.inventory.set(id, tc(id));
  const audit: string[] = [];
  const runs = new RunManager(executor, {
    onChange: (r) => storage.saveRun(r),
    onClear: () => storage.deleteAllRuns(),
  });
  const app = createApp(store, {
    runs,
    settings: fakeSettings(),
    scenarios: new Map([['A', scn('A')]]),
    audit: { list: () => [], add: (a, t, d) => audit.push(`${a}|${t}|${d}`) },
  });
  return { app, store, storage, runs, audit };
}
const finished = async (runs: RunManager, app: ReturnType<typeof createApp>) => {
  const r = (
    await app.inject({ method: 'POST', url: '/api/runs', payload: { caseIds: ['A'] } })
  ).json();
  await runs.whenDone(r.id);
};

describe('start fresh: DELETE /api/inventory', () => {
  it('removes every test case but keeps run history, and says what it removed', async () => {
    const { app, store, storage, runs, audit } = setup();
    await finished(runs, app);
    const res = await app.inject({ method: 'DELETE', url: '/api/inventory' });
    expect(res.json()).toMatchObject({ deletedCases: 3, deletedRuns: 0 });
    expect(store.inventory.size).toBe(0);
    expect(storage.loadCases().items).toEqual([]); // gone from the database, not only memory
    expect(runs.list()).toHaveLength(1);
    expect((await app.inject({ url: '/api/inventory' })).json().total).toBe(0);
    expect(audit).toEqual(['inventory.clear|test cases|Removed 3 test cases.']);
  });

  it('can also remove run history, in memory and in storage', async () => {
    const { app, runs, storage, audit } = setup();
    await finished(runs, app);
    const res = await app.inject({ method: 'DELETE', url: '/api/inventory?runs=true' });
    expect(res.json()).toMatchObject({ deletedCases: 3, deletedRuns: 1 });
    expect(runs.list()).toEqual([]);
    expect(storage.loadRuns().items).toEqual([]);
    expect(audit[0]).toBe('inventory.clear|test cases|Removed 3 test cases and 1 run.');
  });

  it('stays cleared after a restart, because storage was cleared too', async () => {
    const { app, storage } = setup();
    await app.inject({ method: 'DELETE', url: '/api/inventory' });
    expect(new MemoryStore(storage).inventory.size).toBe(0);
  });

  it('refuses to delete run history while a run is in progress, and deletes nothing', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { app, store, runs } = setup({
      execute: async () => (await gate, { status: 'passed', steps: [], artifacts: [] }),
    });
    const started = (
      await app.inject({ method: 'POST', url: '/api/runs', payload: { caseIds: ['A'] } })
    ).json();
    const res = await app.inject({ method: 'DELETE', url: '/api/inventory?runs=true' });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('run-in-progress');
    expect(store.inventory.size).toBe(3);
    release();
    await runs.whenDone(started.id);
    expect(
      (await app.inject({ method: 'DELETE', url: '/api/inventory?runs=true' })).statusCode,
    ).toBe(200);
  });

  it('is harmless on an empty inventory, and reports zero', async () => {
    const { app } = setup();
    await app.inject({ method: 'DELETE', url: '/api/inventory' });
    expect((await app.inject({ method: 'DELETE', url: '/api/inventory' })).json()).toMatchObject({
      deletedCases: 0,
      deletedRuns: 0,
    });
  });

  it('is protected like every other change: another website cannot trigger it', async () => {
    const app = createApp(new MemoryStore(), {}, {});
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/inventory',
      headers: { host: 'localhost:4000', origin: 'https://evil.example' },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('delete chosen test cases: POST /api/inventory/delete', () => {
  it('removes only the chosen cases, in memory and in storage, and audits the count', async () => {
    const { app, store, storage, audit } = setup();
    const res = await app.inject({
      method: 'POST',
      url: '/api/inventory/delete',
      payload: { ids: ['A', 'C', 'A', 'NOPE'] },
    });
    expect(res.json()).toEqual({ deleted: 2, notFound: 1 }); // duplicates count once; unknown IDs are reported, not hidden
    expect([...store.inventory.keys()]).toEqual(['B']);
    expect(storage.loadCases().items.map((c) => c.id)).toEqual(['B']);
    expect(audit).toEqual(['inventory.delete|test cases|Removed 2 test cases.']);
  });

  it('keeps run history, validates the request, and records nothing when nothing was deleted', async () => {
    const { app, runs, audit } = setup();
    await finished(runs, app);
    await app.inject({ method: 'POST', url: '/api/inventory/delete', payload: { ids: ['B'] } });
    expect(runs.list()).toHaveLength(1);
    audit.length = 0;
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/inventory/delete',
          payload: { ids: ['ZZZ'] },
        })
      ).json(),
    ).toEqual({ deleted: 0, notFound: 1 });
    expect(audit).toEqual([]);
    expect(
      (await app.inject({ method: 'POST', url: '/api/inventory/delete', payload: { ids: [] } }))
        .statusCode,
    ).toBe(400);
    expect(
      (await app.inject({ method: 'POST', url: '/api/inventory/delete', payload: {} })).statusCode,
    ).toBe(400);
  });
});

describe('import commit: add or replace', () => {
  const upload = async (app: ReturnType<typeof createApp>) => {
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('S');
    ws.addRow(['Test Case ID', 'Title']);
    ws.addRow(['N-1', 'New one']);
    ws.addRow(['N-2', 'New two']);
    const bytes = Buffer.from(await wb.xlsx.writeBuffer());
    const b = '----x';
    const payload = Buffer.concat([
      Buffer.from(
        `--${b}\r\nContent-Disposition: form-data; name="file"; filename="n.xlsx"\r\nContent-Type: application/octet-stream\r\n\r\n`,
      ),
      bytes,
      Buffer.from(`\r\n--${b}--\r\n`),
    ]);
    const res = await app.inject({
      method: 'POST',
      url: '/api/imports',
      payload,
      headers: { 'content-type': `multipart/form-data; boundary=${b}` },
    });
    return res.json().id as string;
  };

  it('adds to existing test cases by default, and reports the total so the screen can say so', async () => {
    const { app } = setup();
    const id = await upload(app);
    const r = (
      await app.inject({
        method: 'POST',
        url: `/api/imports/${id}/commit`,
        payload: { sheets: 'all' },
      })
    ).json();
    expect(r).toMatchObject({ added: 2, updated: 0, removed: 0, total: 5 }); // A, B, C were already there
  });

  it('replaces the existing test cases when asked, keeping run history, and audits it', async () => {
    const { app, store, storage, runs, audit } = setup();
    await finished(runs, app);
    const id = await upload(app);
    const r = (
      await app.inject({
        method: 'POST',
        url: `/api/imports/${id}/commit`,
        payload: { sheets: 'all', replace: true },
      })
    ).json();
    expect(r).toMatchObject({ added: 2, removed: 3, total: 2 });
    expect([...store.inventory.keys()]).toEqual(['N-1', 'N-2']);
    expect(storage.loadCases().items.map((c) => c.id)).toEqual(['N-1', 'N-2']);
    expect(runs.list()).toHaveLength(1);
    expect(audit).toEqual([
      'inventory.replace|test cases|Replaced 3 existing test cases with 2 from the import.',
    ]);
  });

  it('never empties the inventory when the import request itself is wrong', async () => {
    const { app, store } = setup();
    const id = await upload(app);
    const bad = await app.inject({
      method: 'POST',
      url: `/api/imports/${id}/commit`,
      payload: { sheets: ['No such sheet'], replace: true },
    });
    expect(bad.statusCode).toBe(404);
    expect(store.inventory.size).toBe(3);
  });
});
