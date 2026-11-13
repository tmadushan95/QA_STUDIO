import { describe, expect, it } from 'vitest';
import { ActionRegistry, registerGenericActions } from '@qa-studio/automation-core';
import { SCHEMA_VERSION, type Scenario, type TestCase } from '@qa-studio/shared';
import { createApp } from './app.js';
import { ConversionService, type ConversionJob } from './conversions.js';
import { EventBus } from './events.js';
import { PageMapService } from './page-map.js';
import { ScenarioService } from './scenario-service.js';
import { SqliteStorage } from './sqlite-storage.js';
import { MemoryStore } from './store.js';

const tc = (id: string, steps: string[]): TestCase => ({
  schemaVersion: SCHEMA_VERSION,
  id,
  title: `Title ${id}`,
  steps: steps.map((action, i) => ({ order: i + 1, action })),
  tags: [],
  dependsOn: [],
  readiness: 'needs-clarification',
  source: { workbook: 'w', worksheet: 's', rowNumber: 2 },
});

function setup() {
  const storage = new SqliteStorage(':memory:');
  const store = new MemoryStore();
  store.inventory.set('TC_1', tc('TC_1', ['Go to Projects', 'Click the Delete button']));
  store.inventory.set('TC_2', tc('TC_2', ['Click Save', 'Approve the budget twice']));
  store.inventory.set('TC_3', tc('TC_3', ['Do something unusual']));
  store.inventory.set('TC_4', tc('TC_4', ['Click Save']));
  const audit = () => undefined;
  const scenarioService = new ScenarioService({
    store: storage,
    registry: registerGenericActions(new ActionRegistry()),
    live: new Map<string, Scenario>(),
    caseIds: () => new Set(store.inventory.keys()),
    audit,
  });
  // TC_4 already has steps someone approved: conversion must leave it alone.
  scenarioService.saveEdit('TC_4', { steps: [{ action: 'reload', params: {} }] });
  const pages = new PageMapService(storage, audit);
  // The page list is saved by the API as a config block; the worker only reads it.
  storage.saveConfig('pages', [{ name: 'Projects', route: '/projects', marker: 'Projects' }]);
  const events = new EventBus();
  const seen: string[] = [];
  events.subscribe((e) => e.type === 'job' && seen.push(e.status));
  const conversions = new ConversionService({
    inventory: store.inventory,
    scenarios: scenarioService,
    pages: () => pages.map(),
    events,
    audit,
  });
  const app = createApp(store, { scenarioService, conversions });
  return { app, scenarioService, seen };
}

async function finished(app: ReturnType<typeof createApp>, id: string): Promise<ConversionJob> {
  for (let i = 0; i < 50; i++) {
    const j = (await app.inject({ url: `/api/conversions/${id}` })).json() as ConversionJob;
    if (j.status !== 'running') return j;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('conversion did not finish');
}

describe('converting imported test cases', () => {
  it('reports each case as ready, needs review or skipped, with live progress', async () => {
    const { app, seen } = setup();
    const start = await app.inject({
      method: 'POST',
      url: '/api/conversions',
      payload: { caseIds: ['TC_1', 'TC_2', 'TC_3', 'TC_4', 'TC_9'] },
    });
    expect(start.statusCode).toBe(202);
    const job = await finished(app, start.json().id);
    expect(job.counts).toEqual({ pending: 0, ready: 1, 'needs-review': 2, failed: 1, skipped: 1 });
    const by = Object.fromEntries(job.items.map((i) => [i.caseId, i]));
    expect(by['TC_1']).toMatchObject({ status: 'ready', steps: 2 });
    expect(by['TC_2']).toMatchObject({ status: 'needs-review', steps: 1 });
    expect(by['TC_3']?.message).toMatch(/No sentence could be converted/);
    expect(by['TC_4']).toMatchObject({ status: 'skipped' });
    expect(by['TC_9']).toMatchObject({ status: 'failed' });
    expect(seen.filter((s) => s === 'running').length).toBeGreaterThan(0);
    expect(seen.at(-1)).toBe('done');
  });

  it('saves conversions as drafts that only run after approval, and approves ready ones in bulk', async () => {
    const { app, scenarioService } = setup();
    const job = await finished(
      app,
      (
        await app.inject({
          method: 'POST',
          url: '/api/conversions',
          payload: { caseIds: ['TC_1', 'TC_2'] },
        })
      ).json().id,
    );
    expect(job.counts.ready).toBe(1);
    expect(scenarioService.get('TC_1')).toMatchObject({
      draft: { status: 'validated', origin: 'rules' },
    });
    expect(scenarioService.get('TC_1').approved).toBeUndefined();
    const r = await app.inject({
      method: 'POST',
      url: '/api/scenarios/approve',
      payload: { caseIds: ['TC_1', 'TC_3'] },
    });
    expect(r.json()).toEqual({ approved: 1, skipped: ['TC_3'] });
    expect(scenarioService.get('TC_1').approved?.scenario.steps[0]).toEqual({
      action: 'go-to-page',
      params: { page: 'Projects' },
    });
  });
});
