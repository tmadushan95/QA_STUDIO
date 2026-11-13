import { describe, expect, it } from 'vitest';
import { ActionRegistry, defineAction } from '@qa-studio/automation-core';
import type { Scenario } from '@qa-studio/shared';
import { z } from 'zod';
import { createApp } from './app.js';
import { ScenarioService } from './scenario-service.js';
import { SqliteStorage } from './sqlite-storage.js';

const open = defineAction({
  name: 'app.open',
  description: 'open',
  source: 'example',
  params: z.object({ path: z.string().startsWith('/') }),
  async run() {},
});
const wipe = defineAction({
  name: 'data.wipe',
  description: 'deletes',
  source: 'example',
  destructive: true,
  params: z.object({}),
  async run() {},
});
const registry = new ActionRegistry().register(open).register(wipe);

function setup() {
  const storage = new SqliteStorage(':memory:');
  const live = new Map<string, Scenario>();
  const audit: string[] = [];
  const build = () =>
    new ScenarioService({
      store: storage,
      registry,
      live,
      caseIds: () => new Set(['TC_1', 'TC_2', 'TC_3']),
      audit: (a, t, d) => audit.push(`${a}|${t}|${d}`),
    });
  const service = build();
  const app = createApp(undefined, { scenarioService: service, scenarios: live });
  return { app, service, live, audit, build, storage };
}

const steps = (path = '/dashboard') => [{ action: 'app.open', params: { path } }];
const draft = (app: ReturnType<typeof createApp>, id: string, body: unknown) =>
  app.inject({ method: 'PUT', url: `/api/scenarios/${id}/draft`, payload: body as object });

describe('scenario lifecycle', () => {
  it('a valid draft becomes validated, but is not runnable until a person approves it', async () => {
    const { app, live } = setup();
    const r = await draft(app, 'TC_1', { steps: steps(), description: 'Open the dashboard' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({
      status: 'validated',
      origin: 'manual',
      version: 1,
      issues: [],
    });
    expect(live.has('TC_1')).toBe(false);

    const ok = await app.inject({ method: 'POST', url: '/api/scenarios/TC_1/approve' });
    expect(ok.json()).toMatchObject({ status: 'approved', version: 1 });
    expect(live.get('TC_1')!.steps).toEqual(steps());
    const row = (await app.inject({ url: '/api/scenarios' }))
      .json()
      .items.find((x: { caseId: string }) => x.caseId === 'TC_1');
    expect(row).toMatchObject({ state: 'approved', source: 'app', hasDraft: false, steps: 1 });
  });

  it('keeps an invalid draft as a draft and names every problem; it cannot be approved', async () => {
    const { app, live } = setup();
    const r = await draft(app, 'TC_1', {
      steps: [
        { action: 'made.up', params: {} },
        { action: 'app.open', params: { path: 'no-slash' } },
      ],
    });
    expect(r.json().status).toBe('draft');
    expect(r.json().issues).toHaveLength(2);
    expect(r.json().issues[0]).toContain('Unknown action "made.up"');
    const ap = await app.inject({ method: 'POST', url: '/api/scenarios/TC_1/approve' });
    expect(ap.statusCode).toBe(409);
    expect(live.has('TC_1')).toBe(false);
  });

  it('accepts test data references in parameters and warns about destructive steps', async () => {
    const { service } = setup();
    const rec = service.saveDraft('TC_2', {
      steps: [
        { action: 'app.open', params: { path: '/{{data.page}}' } },
        { action: 'data.wipe', params: {} },
      ],
    });
    expect(rec.status).toBe('validated');
    expect(rec.warnings).toEqual([
      'Step 2 (data.wipe) deletes data, so it only runs when deleting is allowed.',
    ]);
  });

  it('rejects drafts for an unknown case, with no steps, or in the wrong shape', async () => {
    const { app } = setup();
    expect((await draft(app, 'TC_404', { steps: steps() })).statusCode).toBe(404);
    expect((await draft(app, 'TC_1', { steps: [] })).statusCode).toBe(400);
    expect((await draft(app, 'TC_1', {})).statusCode).toBe(400);
    expect((await draft(app, 'TC_1', { steps: [{ nope: 1 }] })).statusCode).toBe(400);
  });

  it('a new draft sits next to an approved scenario, which keeps running until the draft is approved', async () => {
    const { app, live } = setup();
    await draft(app, 'TC_1', { steps: steps('/one') });
    await app.inject({ method: 'POST', url: '/api/scenarios/TC_1/approve' });
    const second = await draft(app, 'TC_1', { steps: steps('/two') });
    expect(second.json().version).toBe(2);
    expect(live.get('TC_1')!.steps[0]!.params).toEqual({ path: '/one' }); // still the approved one
    const row = (await app.inject({ url: '/api/scenarios' }))
      .json()
      .items.find((x: { caseId: string }) => x.caseId === 'TC_1');
    expect(row).toMatchObject({ state: 'approved', hasDraft: true });
    await app.inject({ method: 'POST', url: '/api/scenarios/TC_1/approve' });
    expect(live.get('TC_1')!.steps[0]!.params).toEqual({ path: '/two' });
  });

  it('discarding a draft leaves the approved scenario alone', async () => {
    const { app, live } = setup();
    await draft(app, 'TC_1', { steps: steps('/one') });
    await app.inject({ method: 'POST', url: '/api/scenarios/TC_1/approve' });
    await draft(app, 'TC_1', { steps: steps('/two') });
    expect(
      (await app.inject({ method: 'DELETE', url: '/api/scenarios/TC_1/draft' })).json(),
    ).toEqual({ discarded: true });
    expect(live.has('TC_1')).toBe(true);
    expect((await app.inject({ url: '/api/scenarios/TC_1' })).json().draft).toBeUndefined();
  });

  it('approved scenarios and drafts survive a restart', async () => {
    const { service, build } = setup();
    service.saveDraft('TC_1', { steps: steps('/kept') });
    service.approve('TC_1');
    service.saveDraft('TC_2', { steps: steps('/pending') });
    const again = build();
    expect(again.get('TC_1').approved?.version).toBe(1);
    expect(again.get('TC_2').draft?.status).toBe('validated');
  });

  it('revoking withdraws approval; the replaced version stays in the history', async () => {
    const { app, live, service } = setup();
    service.saveEdit('TC_3', { steps: steps('/first') });
    service.saveDraft('TC_3', { steps: steps('/override') });
    service.approve('TC_3');
    expect(live.get('TC_3')!.steps[0]!.params).toEqual({ path: '/override' });
    expect(service.history('TC_3').map((r) => r.version)).toEqual([1]);
    expect(
      (await app.inject({ method: 'DELETE', url: '/api/scenarios/TC_3/approved' })).json(),
    ).toEqual({ revoked: true });
    expect(live.has('TC_3')).toBe(false);
  });

  it('saves a person’s valid edit as the approved version, and refuses a save over a newer one', async () => {
    const { app, live } = setup();
    const put = (body: object) =>
      app.inject({ method: 'PUT', url: '/api/scenarios/TC_1', payload: body });
    const first = await put({ steps: steps('/a'), expectedVersion: 0 });
    expect(first.json()).toMatchObject({ status: 'approved', version: 1, origin: 'manual' });
    expect(live.get('TC_1')!.steps[0]!.params).toEqual({ path: '/a' });
    // Someone else's editor still thinks the case is at version 0.
    const stale = await put({ steps: steps('/b'), expectedVersion: 0 });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe('changed-since-opened');
    // Steps with problems are kept as a draft; the approved version keeps running.
    const bad = await put({ steps: [{ action: 'nope', params: {} }], expectedVersion: 1 });
    expect(bad.json()).toMatchObject({ status: 'draft', version: 2 });
    expect(live.get('TC_1')!.steps[0]!.params).toEqual({ path: '/a' });
  });

  it('restores an earlier version as a new version, never rewriting the history', async () => {
    const { app, service } = setup();
    service.saveEdit('TC_1', { steps: steps('/v1') });
    service.saveEdit('TC_1', { steps: steps('/v2') });
    const hist = (await app.inject({ url: '/api/scenarios/TC_1/history' })).json().items as {
      version: number;
    }[];
    expect(hist.map((h) => h.version)).toEqual([1]);
    const r = await app.inject({ method: 'POST', url: '/api/scenarios/TC_1/restore/1' });
    expect(r.json()).toMatchObject({ version: 3, status: 'approved' });
    expect(service.get('TC_1').approved!.scenario.steps[0]!.params).toEqual({ path: '/v1' });
    expect(service.history('TC_1').map((h) => h.version)).toEqual([2, 1]);
  });

  it('clears every scenario, draft and earlier version', () => {
    const { service, live } = setup();
    service.saveEdit('TC_1', { steps: steps('/a') });
    service.saveEdit('TC_1', { steps: steps('/b') });
    service.saveDraft('TC_2', { steps: steps('/c') });
    expect(service.clearAll()).toEqual({ scenarios: 2, files: 0 });
    expect(live.size).toBe(0);
    expect(service.list().filter((r) => r.state !== 'none')).toEqual([]);
    expect(service.history('TC_1')).toEqual([]);
  });

  it('shows a scenario imported from an old file as from a file, and cases with nothing as none', async () => {
    const { app, storage, build } = setup();
    const now = '2026-01-01T00:00:00.000Z';
    storage.saveScenarioRecord('approved', 'TC_3', {
      caseId: 'TC_3',
      scenario: { schemaVersion: 1, caseId: 'TC_3', steps: steps('/from-file') },
      status: 'approved',
      origin: 'file',
      version: 1,
      createdAt: now,
      updatedAt: now,
    });
    const service = build();
    const reloaded = createApp(undefined, { scenarioService: service });
    const items = (await reloaded.inject({ url: '/api/scenarios' })).json().items as {
      caseId: string;
      state: string;
      source?: string;
    }[];
    expect(items.find((x) => x.caseId === 'TC_3')).toMatchObject({
      state: 'approved',
      source: 'file',
    });
    expect(items.find((x) => x.caseId === 'TC_2')).toMatchObject({ state: 'none' });
    await app.close();
  });

  it('records each step of the life in the audit trail, with no step contents', async () => {
    const { service, audit } = setup();
    service.saveDraft('TC_1', { steps: steps('/secret-looking-path') });
    service.approve('TC_1');
    service.saveDraft('TC_1', { steps: steps('/b') });
    service.discardDraft('TC_1');
    service.revoke('TC_1');
    expect(audit.map((a) => a.split('|')[0])).toEqual([
      'scenario.draft',
      'scenario.approve',
      'scenario.draft',
      'scenario.discard',
      'scenario.revoke',
    ]);
    expect(audit.join('\n')).not.toContain('secret-looking-path');
  });
});
