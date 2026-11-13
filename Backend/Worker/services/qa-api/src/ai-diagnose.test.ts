import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ActionRegistry, defineAction } from '@qa-studio/automation-core';
import type { ExploredPage } from '@qa-studio/execution-engine';
import { KnowledgeIndex, type SqlDb } from '@qa-studio/knowledge';
import { FakeLlm } from '@qa-studio/llm';
import type { Run, Scenario, TestCase } from '@qa-studio/shared';
import { AiService } from './ai-service.js';
import { AiTasks } from './ai-tasks.js';
import { createApp } from './app.js';
import { EventBus } from './events.js';
import { ScenarioService } from './scenario-service.js';
import { SecretBox } from './secrets.js';
import { SqliteStorage } from './sqlite-storage.js';

const registry = new ActionRegistry()
  .register(
    defineAction({
      name: 'drafts.open-project',
      description: 'Open a project.',
      source: 'example',
      params: z.object({ list: z.string(), code: z.string() }),
      async run() {},
    }),
  )
  .register(
    defineAction({
      name: 'assert.text-visible',
      description: 'Assert text.',
      source: 'example',
      params: z.object({ text: z.string().min(1) }),
      async run() {},
    }),
  );

const tc = {
  schemaVersion: 1,
  id: 'TC_06',
  title: 'Verify the delete confirmation message',
  steps: [{ order: 1, action: 'Click Delete' }],
  expectedResult: 'The dialog title is "Delete Project?"',
  tags: [],
  dependsOn: [],
  readiness: 'needs-clarification',
  source: { workbook: 'p.xlsx', worksheet: 'S', rowNumber: 7 },
} as TestCase;

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function setup(
  script: string[],
  explore?: (paths: string[], accountId: string | undefined) => Promise<ExploredPage[]>,
) {
  const artifactsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'diag-'));
  dirs.push(artifactsDir);
  const runId = 'run-1234-abcd';
  fs.mkdirSync(path.join(artifactsDir, runId, 'TC_06'), { recursive: true });
  fs.writeFileSync(
    path.join(artifactsDir, runId, 'TC_06', 'failure-page.txt'),
    'URL: https://qa/p/1/draft\n- dialog "Delete Project?"',
  );
  const run = {
    id: runId,
    status: 'failed',
    createdAt: '2026-01-01T00:00:00Z',
    environment: 'qa',
    browser: 'chromium',
    workers: 1,
    cases: [
      {
        caseId: 'TC_06',
        status: 'failed',
        steps: [
          { index: 0, action: 'auth.sign-in', status: 'passed', durationMs: 1 },
          { index: 1, action: 'drafts.open-project', status: 'passed', durationMs: 1 },
          {
            index: 2,
            action: 'assert.text-visible',
            status: 'failed',
            durationMs: 1,
            failure: { kind: 'assertion', message: 'not visible' },
          },
        ],
        failure: {
          kind: 'assertion',
          message: 'Expected text to be visible: "Confirm Delete"',
          expected: 'Confirm Delete',
          actual: 'not visible',
        },
        artifacts: ['TC_06/failure-page.txt'],
      },
      { caseId: 'TC_07', status: 'passed', steps: [], artifacts: [] },
    ],
  } as unknown as Run;

  const storage = new SqliteStorage(':memory:');
  const fake = new FakeLlm(script);
  const ai = new AiService({
    store: storage,
    box: new SecretBox(crypto.randomBytes(32)),
    env: {},
    audit: () => undefined,
    clientFactory: () => fake,
  });
  ai.update({ provider: 'gemini' });
  ai.setKey('gemini', 'AIzaSy-test-key-0123456');
  const inventory = new Map<string, TestCase>([
    ['TC_06', tc],
    ['TC_07', { ...tc, id: 'TC_07' }],
  ]);
  const live = new Map<string, Scenario>();
  const scenarios = new ScenarioService({
    store: storage,
    registry,
    live,
    caseIds: () => new Set(inventory.keys()),
    audit: () => undefined,
  });
  scenarios.saveDraft('TC_06', {
    steps: [
      { action: 'drafts.open-project', params: { list: 'draft', code: '{{data.p}}' } },
      { action: 'assert.text-visible', params: { text: 'Confirm Delete' } },
    ],
  });
  scenarios.approve('TC_06');
  const kb = new KnowledgeIndex(storage.sql as unknown as SqlDb);
  const audit: string[] = [];
  const tasks = new AiTasks({
    ai,
    knowledge: kb,
    scenarios,
    actions: () => registry.list(),
    inventory,
    events: new EventBus(),
    audit: (a, t, d) => audit.push(`${a}|${t}|${d}`),
    runs: { get: (id) => (id === runId ? run : undefined) },
    artifactsDir,
    ...(explore && { explore }),
  });
  const app = createApp(undefined, { aiTasks: tasks });
  return { app, fake, scenarios, live, kb, audit, runId };
}

const diagnose = (app: ReturnType<typeof createApp>, body: unknown) =>
  app.inject({ method: 'POST', url: '/api/ai/diagnose', payload: body as object });

describe('diagnose a failed case', () => {
  it('saves a corrected draft next to the approved scenario when the test is out of date', async () => {
    const fixed = JSON.stringify({
      verdict: 'test-fix',
      explanation: 'The title changed to "Delete Project?", which is what the case expects.',
      steps: [
        { action: 'drafts.open-project', params: { list: 'draft', code: '{{data.p}}' } },
        { action: 'assert.text-visible', params: { text: 'Delete Project?' } },
      ],
    });
    const { app, fake, scenarios, live, runId } = setup([fixed]);
    const r = await diagnose(app, { runId, caseId: 'TC_06' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({
      verdict: 'test-fix',
      draft: { version: 2, status: 'validated', issues: [] },
    });
    // The approved scenario is untouched and still runs; the fix waits for review.
    expect(live.get('TC_06')!.steps[1]!.params).toEqual({ text: 'Confirm Delete' });
    expect(scenarios.get('TC_06').draft).toMatchObject({ origin: 'ai' });
    expect(scenarios.get('TC_06').draft!.note).toContain(
      `Proposed after run ${runId.slice(0, 8)} failed`,
    );
    // The model saw the failing step number (sign-in not counted) and the captured page.
    const prompt = fake.requests[0]!.messages[0]!.content;
    expect(prompt).toContain('step: 2 (assert.text-visible)');
    expect(prompt).toContain('dialog "Delete Project?"');
  });

  it('reports a likely defect and changes nothing', async () => {
    const { app, scenarios, runId, audit } = setup([
      JSON.stringify({
        verdict: 'likely-defect',
        explanation: 'The app shows a different title than the case expects.',
      }),
    ]);
    const r = (await diagnose(app, { runId, caseId: 'TC_06' })).json();
    expect(r).toEqual({
      verdict: 'likely-defect',
      explanation: 'The app shows a different title than the case expects.',
    });
    expect(scenarios.get('TC_06').draft).toBeUndefined();
    expect(audit.at(-1)).toContain('likely-defect');
  });

  it('only diagnoses failed cases of a known run that have a scenario', async () => {
    const { app, runId } = setup([]);
    expect((await diagnose(app, { runId: 'nope', caseId: 'TC_06' })).statusCode).toBe(404);
    expect((await diagnose(app, { runId, caseId: 'TC_99' })).statusCode).toBe(404);
    expect((await diagnose(app, { runId, caseId: 'TC_07' })).statusCode).toBe(409);
    expect((await diagnose(app, {})).statusCode).toBe(400);
  });
});

describe('explore the app read-only', () => {
  const page = (p: string, over: Partial<ExploredPage> = {}): ExploredPage => ({
    path: p,
    ok: true,
    url: `https://qa${p}`,
    title: 'Sample App',
    snapshot: `URL: https://qa${p}\n- heading "Draft Projects"\n- searchbox "Search draft projects"`,
    blockedWrites: 0,
    ...over,
  });

  it('adds what each page shows to the knowledge index, and returns sizes, not the text', async () => {
    let asked: string[] = [];
    const { app, kb, audit } = setup([], async (paths) => {
      asked = paths;
      return [page(paths[0]!), { path: paths[1]!, ok: false, error: 'Timeout', blockedWrites: 2 }];
    });
    const r = await app.inject({
      method: 'POST',
      url: '/api/ai/explore',
      payload: { paths: ['/projects/draft-list', '/broken'] },
    });
    expect(r.statusCode).toBe(200);
    const items = r.json().items;
    expect(items[0]).toMatchObject({
      path: '/projects/draft-list',
      ok: true,
      chars: expect.any(Number),
    });
    expect(items[0].snapshot).toBeUndefined();
    expect(items[1]).toMatchObject({ ok: false, error: 'Timeout', blockedWrites: 2 });
    expect(asked).toEqual(['/projects/draft-list', '/broken']);
    const hits = kb.search('search draft projects', { kinds: ['doc'] });
    expect(hits[0]).toMatchObject({ docId: 'page:/projects/draft-list' });
    expect(kb.stats().doc).toBe(1);
    expect(audit.at(-1)).toContain('Read 1 of 2 page(s); nothing was changed.');
  });

  it('uses the default page list, and rejects paths outside the app', async () => {
    let asked: string[] = [];
    const { app } = setup([], async (paths) => ((asked = paths), []));
    await app.inject({ method: 'POST', url: '/api/ai/explore', payload: {} });
    expect(asked).toContain('/projects/draft-list');
    const defaults = (await app.inject({ url: '/api/ai/explore' })).json();
    expect(defaults.defaultPaths).toEqual(asked);
    for (const bad of ['https://evil.example/', '//evil.example', 'no-slash', '/has space']) {
      const r = await app.inject({
        method: 'POST',
        url: '/api/ai/explore',
        payload: { paths: [bad] },
      });
      expect(r.statusCode, bad).toBe(400);
    }
  });

  it('reports a sign-in or setup problem in plain words', async () => {
    const { app } = setup([], async () => {
      throw new Error('Sign-in is on, so add a test account in Settings to explore as.');
    });
    const r = await app.inject({ method: 'POST', url: '/api/ai/explore', payload: {} });
    expect(r.statusCode).toBe(400);
    expect(r.json().error.message).toContain('add a test account');
  });
});
