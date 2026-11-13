import { describe, expect, it } from 'vitest';
import { ActionRegistry, registerGenericActions } from '@qa-studio/automation-core';
import { SCHEMA_VERSION, type Scenario, type TestCase } from '@qa-studio/shared';
import { createApp } from './app.js';
import { BackupService } from './backups.js';
import { ScenarioService } from './scenario-service.js';
import { SqliteStorage } from './sqlite-storage.js';
import { MemoryStore } from './store.js';
import { fakeParameters } from './test-parameters.js';

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

function setup() {
  const storage = new SqliteStorage(':memory:');
  const store = new MemoryStore();
  for (const id of ['TC_1', 'TC_2']) store.inventory.set(id, tc(id));
  const live = new Map<string, Scenario>();
  const audit = () => undefined;
  const scenarioService = new ScenarioService({
    store: storage,
    registry: registerGenericActions(new ActionRegistry()),
    live,
    caseIds: () => new Set(store.inventory.keys()),
    audit,
  });
  scenarioService.saveEdit('TC_1', {
    steps: [{ action: 'fill', params: { target: { label: 'Code' }, value: '{{data.project}}' } }],
  });
  const parameters = fakeParameters({ TC_1: { project: 'PRJ-1' } });
  const backups = new BackupService({
    store: storage,
    cases: {
      list: () => [...store.inventory.values()],
      restore: (cases) => cases.forEach((c) => store.inventory.set(c.id, c)),
    },
    scenarios: scenarioService,
    parameters,
    audit,
  });
  const app = createApp(store, { scenarioService, scenarios: live, parameters, backups });
  return { app, store, live, storage, parameters };
}

describe('clear all data, and undo', () => {
  it('removes test cases, scenarios and their parameters', async () => {
    const { app, store, live, parameters } = setup();
    const r = (await app.inject({ method: 'DELETE', url: '/api/inventory' })).json();
    expect(r).toMatchObject({
      deletedCases: 2,
      deletedScenarios: 1,
      deletedFiles: 0,
      clearedValues: 1,
      backupId: expect.any(String),
    });
    expect(store.inventory.size).toBe(0);
    expect(live.size).toBe(0);
    expect(parameters.values).toEqual({});

    // Undo puts every part back.
    const restored = await app.inject({
      method: 'POST',
      url: `/api/backups/${r.backupId}/restore`,
    });
    expect(restored.json()).toMatchObject({ cases: 2, scenarios: 1, parameterSets: 1 });
    expect(store.inventory.size).toBe(2);
    expect(live.has('TC_1')).toBe(true);
    expect(parameters.values).toEqual({ TC_1: { project: 'PRJ-1' } });
  });

  it('can keep scenarios and parameters when asked, and lists the snapshot', async () => {
    const { app, live, parameters } = setup();
    await app.inject({ method: 'DELETE', url: '/api/inventory?scenarios=false&parameters=false' });
    expect(live.has('TC_1')).toBe(true);
    expect(parameters.values).toEqual({ TC_1: { project: 'PRJ-1' } });
    const list = (await app.inject({ url: '/api/backups' })).json().items;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ reason: 'Before clearing all data', cases: 2 });
  });

  it('tells storage when a restore has finished, after the data is back', async () => {
    const { storage } = setup();
    const order: string[] = [];
    const backups = new BackupService({
      store: {
        saveBackup: (...a) => storage.saveBackup(...a),
        loadBackup: (id) => storage.loadBackup(id),
        listBackups: () => storage.listBackups(),
        deleteBackup: (id) => storage.deleteBackup(id),
        backupRestored: () => order.push('told'),
      },
      cases: { list: () => [], restore: () => void order.push('cases') },
      scenarios: { approvedScenarios: () => [], restoreScenarios: () => 0 },
      parameters: {
        exportAll: () => Promise.resolve({}),
        importAll: () => Promise.resolve(void order.push('data')),
      },
      audit: () => undefined,
    });
    await backups.restore(await backups.take('x'));
    expect(order).toEqual(['cases', 'data', 'told']);
  });

  it('removes snapshots older than a week', async () => {
    const { storage } = setup();
    let now = new Date('2026-01-01T00:00:00Z');
    const backups = new BackupService({
      store: storage,
      cases: { list: () => [], restore: () => undefined },
      scenarios: { approvedScenarios: () => [], restoreScenarios: () => 0 },
      parameters: {
        exportAll: () => Promise.resolve({}),
        importAll: () => Promise.resolve(),
      },
      audit: () => undefined,
      now: () => now,
    });
    await backups.take('old');
    expect(backups.list()).toHaveLength(1);
    now = new Date('2026-01-09T00:00:00Z');
    expect(backups.list()).toHaveLength(0);
  });

  it('refuses backup IDs it did not make', async () => {
    const { app } = setup();
    const r = await app.inject({ method: 'POST', url: '/api/backups/..%2F..%2Fsecret/restore' });
    expect(r.statusCode).toBe(404);
  });
});
