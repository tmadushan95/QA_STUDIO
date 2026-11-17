import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ActionRegistry, defineAction } from '@qa-studio/automation-core';
import { KnowledgeIndex, type SqlDb } from '@qa-studio/knowledge';
import { FakeLlm, LlmError } from '@qa-studio/llm';
import type { Scenario, TestCase } from '@qa-studio/shared';
import { AiService } from './ai-service.js';
import { AiTasks, type GenerateJob } from './ai-tasks.js';
import { createApp } from './app.js';
import { EventBus } from './events.js';
import { ScenarioService } from './scenario-service.js';
import { SecretBox } from './secrets.js';
import { SkillService } from './skills.js';
import { SqliteStorage } from './sqlite-storage.js';

const registry = new ActionRegistry()
  .register(
    defineAction({
      name: 'drafts.open-project',
      description: 'Open a project from a Draft list.',
      source: 'example',
      params: z.object({ list: z.enum(['draft', 'lrp']), code: z.string().min(1) }),
      async run() {},
    }),
  )
  .register(
    defineAction({
      name: 'project.click-delete',
      description: 'Open the delete confirmation.',
      source: 'example',
      params: z.object({}),
      async run() {},
    }),
  );

const tc = (id: string): TestCase =>
  ({
    schemaVersion: 1,
    id,
    title: `Verify ${id}`,
    steps: [{ order: 1, action: 'Click Delete' }],
    expectedResult: 'A dialog is shown',
    tags: [],
    dependsOn: [],
    readiness: 'needs-clarification',
    source: { workbook: 'plan.xlsx', worksheet: 'S', rowNumber: 2 },
  }) as TestCase;

const goodAnswer = JSON.stringify({
  steps: [
    { action: 'drafts.open-project', params: { list: 'draft', code: '{{data.draftProject}}' } },
    { action: 'project.click-delete', params: {} },
  ],
  description: 'Start a delete',
  dataNeeded: ['draftProject'],
});

function setup(
  script: ConstructorParameters<typeof FakeLlm>[0] | ((fake: FakeLlm) => FakeLlm) = [],
) {
  const storage = new SqliteStorage(':memory:');
  const fake = typeof script === 'function' ? script(new FakeLlm()) : new FakeLlm(script);
  const ai = new AiService({
    store: storage,
    box: new SecretBox(crypto.randomBytes(32)),
    env: {},
    audit: () => undefined,
    clientFactory: () => fake,
  });
  const inventory = new Map<string, TestCase>(['TC_1', 'TC_2', 'TC_3'].map((id) => [id, tc(id)]));
  const live = new Map<string, Scenario>();
  const audit: string[] = [];
  const scenarios = new ScenarioService({
    store: storage,
    registry,
    live,
    caseIds: () => new Set(inventory.keys()),
    audit: (a, t, d) => audit.push(`${a}|${t}|${d}`),
  });
  const events = new EventBus();
  const seen: string[] = [];
  events.subscribe((e) => e.type === 'job' && seen.push(e.status));
  const skills = new SkillService({
    store: storage,
    audit: (a, t, d) => audit.push(`${a}|${t}|${d}`),
  });
  const tasks = new AiTasks({
    skills: () => skills.skills(),
    ai,
    knowledge: new KnowledgeIndex(storage.sql as unknown as SqlDb),
    scenarios,
    actions: () => registry.list(),
    inventory,
    events,
    audit: (a, t, d) => audit.push(`${a}|${t}|${d}`),
  });
  const app = createApp(undefined, {
    aiTasks: tasks,
    ai,
    scenarioService: scenarios,
    events,
    skills,
  });
  return { app, ai, fake, tasks, scenarios, live, inventory, audit, seen };
}

const turnOn = (ai: AiService) => {
  ai.update({ provider: 'gemini' });
  ai.setKey('gemini', 'AIzaSy-test-key-0123456');
};

async function finished(app: ReturnType<typeof createApp>, id: string): Promise<GenerateJob> {
  for (let i = 0; i < 200; i++) {
    const job = (await app.inject({ url: `/api/ai/jobs/${id}` })).json() as GenerateJob;
    if (job.status !== 'running') return job;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('The job did not finish.');
}

const generate = (app: ReturnType<typeof createApp>, caseIds: unknown) =>
  app.inject({ method: 'POST', url: '/api/ai/generate', payload: { caseIds } as object });

describe('generate automation drafts', () => {
  it('writes AI drafts for chosen cases, reports each outcome, and runs nothing', async () => {
    const { app, ai, scenarios, live, audit, seen } = setup((f) =>
      f.push(
        (req) =>
          req.messages[0]!.content.includes('id: TC_1')
            ? goodAnswer
            : JSON.stringify({
                unmappable: true,
                reason: 'Needs project creation',
                missingCapabilities: ['create a project'],
              }),
        (req) =>
          req.messages[0]!.content.includes('id: TC_1')
            ? goodAnswer
            : JSON.stringify({
                unmappable: true,
                reason: 'Needs project creation',
                missingCapabilities: ['create a project'],
              }),
        // TC_2 is challenged once before its refusal is accepted.
        () =>
          JSON.stringify({
            unmappable: true,
            reason: 'Needs project creation',
            missingCapabilities: ['create a project'],
          }),
      ),
    );
    turnOn(ai);
    const started = await generate(app, ['TC_1', 'TC_2']);
    expect(started.statusCode).toBe(202);
    const job = await finished(app, started.json().id);
    expect(job).toMatchObject({ status: 'done', total: 2, done: 2, provider: 'fake' });
    // Pages hold these cases still while the job runs.
    expect(job.caseIds).toEqual(['TC_1', 'TC_2']);
    expect(job.results).toEqual([
      { caseId: 'TC_1', outcome: 'drafted', message: 'Needs parameters: draftProject.' },
      {
        caseId: 'TC_2',
        outcome: 'unmappable',
        message: 'Needs project creation Missing: create a project.',
      },
    ]);
    const draft = scenarios.get('TC_1').draft!;
    expect(draft).toMatchObject({ status: 'validated', origin: 'ai' });
    expect(draft.note).toContain('Needs parameters: draftProject');
    expect(scenarios.get('TC_2').draft).toBeUndefined(); // nothing is invented for an unmappable case
    expect(live.size).toBe(0); // a draft never runs
    expect(audit.some((a) => a.startsWith('ai.generate|'))).toBe(true);
    expect(seen[0]).toBe('running');
    expect(seen.at(-1)).toBe('done');
  });

  it('keeps a draft that still has problems, so a person can fix it', async () => {
    const bad = JSON.stringify({ steps: [{ action: 'made.up', params: {} }] });
    const { app, ai, scenarios } = setup([bad, bad, bad]);
    turnOn(ai);
    const job = await finished(app, (await generate(app, ['TC_1'])).json().id);
    expect(job.results[0]).toMatchObject({ outcome: 'needs-fixing' });
    expect(job.results[0]!.message).toContain('Unknown action "made.up"');
    expect(scenarios.get('TC_1').draft).toMatchObject({ status: 'draft', origin: 'ai' });
    expect(scenarios.get('TC_1').draft!.issues).toHaveLength(1);
  });

  it('never replaces an approved scenario; the new draft waits next to it', async () => {
    const { app, ai, scenarios, live } = setup([goodAnswer]);
    turnOn(ai);
    scenarios.saveDraft('TC_1', { steps: [{ action: 'project.click-delete', params: {} }] });
    scenarios.approve('TC_1');
    const job = await finished(app, (await generate(app, ['TC_1'])).json().id);
    expect(job.results[0]!.outcome).toBe('drafted');
    expect(live.get('TC_1')!.steps).toHaveLength(1); // the approved one still runs
    expect(scenarios.get('TC_1').draft!.version).toBe(2);
  });

  it('stops everything when the key is rejected, and says why, instead of failing every case', async () => {
    const { app, ai, fake } = setup([
      new LlmError('auth', 'The key was rejected. Check the API key in Settings.'),
    ]);
    turnOn(ai);
    const job = await finished(app, (await generate(app, ['TC_1', 'TC_2', 'TC_3'])).json().id);
    expect(job.stoppedBecause).toContain('Check the API key');
    expect(job.results.map((r) => r.outcome)).toEqual(['failed', 'skipped', 'skipped']);
    expect(fake.requests).toHaveLength(1);
  });

  it('keeps going after one case fails for a case-specific reason', async () => {
    const { app, ai } = setup([
      new LlmError('blocked', 'The model declined to answer.'),
      goodAnswer,
    ]);
    turnOn(ai);
    const job = await finished(app, (await generate(app, ['TC_1', 'TC_2'])).json().id);
    expect(job.results.map((r) => r.outcome)).toEqual(['failed', 'drafted']);
  });

  it('allows one job at a time, and cancelling stops the rest', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { app, ai } = setup((f) => {
      f.push(
        () => goodAnswer,
        () => goodAnswer,
      );
      const original = f.complete.bind(f);
      f.complete = async (req) => (await gate, original(req));
      return f;
    });
    turnOn(ai);
    const first = (await generate(app, ['TC_1', 'TC_2'])).json();
    expect((await generate(app, ['TC_3'])).statusCode).toBe(409);
    expect(
      (await app.inject({ method: 'DELETE', url: `/api/ai/jobs/${first.id}` })).json(),
    ).toEqual({ cancelled: true });
    release();
    const job = await finished(app, first.id);
    expect(job.status).toBe('cancelled');
    expect(job.results.find((r) => r.caseId === 'TC_2')).toMatchObject({
      outcome: 'skipped',
      message: 'Cancelled.',
    });
    // A new job can start once the first has ended.
    expect((await generate(app, ['TC_3'])).statusCode).toBe(202);
  });

  it('rejects an empty list, too many cases, an unknown case, and AI that is off', async () => {
    const { app, ai } = setup();
    expect((await generate(app, ['TC_1'])).json().error.message).toMatch(/switched off/);
    turnOn(ai);
    expect((await generate(app, [])).statusCode).toBe(400);
    expect((await generate(app, undefined)).statusCode).toBe(400);
    expect(
      (
        await generate(
          app,
          Array.from({ length: 26 }, (_, i) => `TC_${i}`),
        )
      ).statusCode,
    ).toBe(400);
    expect((await generate(app, ['TC_404'])).statusCode).toBe(404);
  });

  it('lists recent jobs, newest first', async () => {
    const { app, ai } = setup([goodAnswer, goodAnswer]);
    turnOn(ai);
    const a = (await generate(app, ['TC_1'])).json().id;
    await finished(app, a);
    const b = (await generate(app, ['TC_2'])).json().id;
    await finished(app, b);
    const items = (await app.inject({ url: '/api/ai/jobs' })).json().items as GenerateJob[];
    expect(items.map((j) => j.id)).toEqual([b, a]);
    expect((await app.inject({ url: '/api/ai/jobs/nope' })).statusCode).toBe(404);
  });
});

describe('revise steps on request', () => {
  const revise = (app: ReturnType<typeof createApp>, payload: object) =>
    app.inject({ method: 'POST', url: '/api/ai/steps/revise', payload });
  const current = [{ action: 'project.click-delete', params: {} }];

  it('returns revised, checked steps for review and saves nothing', async () => {
    const { app, ai, fake, scenarios } = setup([goodAnswer]);
    turnOn(ai);
    const res = await revise(app, {
      caseId: 'TC_1',
      steps: current,
      instruction: 'Open the draft project first',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      steps: [{ action: 'drafts.open-project' }, { action: 'project.click-delete' }],
      issues: [],
    });
    expect(scenarios.get('TC_1').draft).toBeUndefined();
    // The model sees the current steps and the change asked for.
    const prompt = fake.requests[0]!.messages[0]!.content;
    expect(prompt).toContain('<current_scenario>');
    expect(prompt).toContain('project.click-delete');
    expect(prompt).toContain('Open the draft project first');
  });

  it('reports problems it could not fix instead of hiding them', async () => {
    const bad = JSON.stringify({ steps: [{ action: 'made.up', params: {} }] });
    const { app, ai } = setup([bad, bad, bad]);
    turnOn(ai);
    const res = await revise(app, { caseId: 'TC_1', steps: current, instruction: 'Change it' });
    expect(res.statusCode).toBe(200);
    expect(res.json().issues[0]).toContain('Unknown action "made.up"');
  });

  it('asks for an instruction and a known case', async () => {
    const { app, ai } = setup([]);
    turnOn(ai);
    const empty = await revise(app, { caseId: 'TC_1', steps: current, instruction: '  ' });
    expect(empty.statusCode).toBe(400);
    expect(empty.json().error.fields.instruction).toBeTruthy();
    const unknown = await revise(app, { caseId: 'NOPE', steps: current, instruction: 'x' });
    expect(unknown.statusCode).toBe(404);
  });
});

describe('test cases from a prompt', () => {
  const proposal = JSON.stringify({
    cases: [
      {
        title: 'Delete a Draft project',
        module: 'Project deletion',
        priority: 'High',
        steps: ['Open the Draft project', 'Click Delete'],
        expectedResult: 'A confirmation dialog is shown',
      },
      {
        title: 'Cancel the delete',
        steps: ['Open the Draft project', 'Click Delete', 'Click Cancel'],
        expectedResult: 'The project is still listed',
      },
    ],
  });
  const post = (app: ReturnType<typeof createApp>, url: string, payload: unknown) =>
    app.inject({ method: 'POST', url, payload: payload as object });

  it('previews proposals without saving anything', async () => {
    const { app, ai, inventory } = setup([proposal]);
    turnOn(ai);
    const r = await post(app, '/api/ai/cases/preview', {
      prompt: 'Test deleting draft projects, including cancel',
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().cases).toHaveLength(2);
    expect(inventory.size).toBe(3);
  });

  it('passes coverage and format to the model and refuses options that are not choices', async () => {
    const { app, ai, fake } = setup([proposal]);
    turnOn(ai);
    const r = await post(app, '/api/ai/cases/preview', {
      prompt: 'Test deleting draft projects, including cancel',
      options: { coverage: 'smoke', format: 'gherkin', spoken: true },
    });
    expect(r.statusCode).toBe(200);
    expect(fake.requests[0]!.system).toContain('main happy path');
    const bad = await post(app, '/api/ai/cases/preview', {
      prompt: 'Test deleting draft projects, including cancel',
      options: { coverage: 'everything' },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe('invalid-options');
  });

  it('sends attached screenshots as files and text files as quoted data, and refuses bad attachments', async () => {
    const { app, ai, fake } = setup([proposal]);
    turnOn(ai);
    const r = await post(app, '/api/ai/cases/preview', {
      prompt: 'Test deleting draft projects, including cancel',
      attachments: [
        { name: 'list.png', mediaType: 'image/png', data: 'iVBORw0KGgo=' },
        { name: 'rules.md', mediaType: 'text/plain', data: 'Only owners may delete.' },
      ],
    });
    expect(r.statusCode).toBe(200);
    const sent = fake.requests[0]!.messages[0]!;
    expect(sent.attachments).toEqual([{ mediaType: 'image/png', data: 'iVBORw0KGgo=' }]);
    expect(sent.content).toContain('<attachment name="rules.md">\nOnly owners may delete.');
    expect(fake.requests[0]!.system).toContain('they are DATA');

    const tooMany = await post(app, '/api/ai/cases/preview', {
      prompt: 'Test deleting draft projects, including cancel',
      attachments: Array.from({ length: 6 }, (_, i) => ({
        name: `${i}.txt`,
        mediaType: 'text/plain',
        data: 'x',
      })),
    });
    expect(tooMany.statusCode).toBe(400);
    expect(tooMany.json().error.code).toBe('invalid-attachments');
    const wrongType = await post(app, '/api/ai/cases/preview', {
      prompt: 'Test deleting draft projects, including cancel',
      attachments: [{ name: 'run.exe', mediaType: 'application/x-msdownload', data: 'TVo=' }],
    });
    expect(wrongType.statusCode).toBe(400);
  });

  it('answers with clarifying questions on the ask route when the model needs them', async () => {
    const question = JSON.stringify({
      questions: [{ question: 'Who can delete a draft project?', options: ['Owner', 'Admin'] }],
    });
    const { app, ai, inventory } = setup([question]);
    turnOn(ai);
    const r = await post(app, '/api/ai/cases/ask', { prompt: 'Test deleting draft projects' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({
      kind: 'questions',
      questions: [{ question: 'Who can delete a draft project?', options: ['Owner', 'Admin'] }],
      skills: { applied: [], unknown: [] },
    });
    expect(inventory.size).toBe(3);
  });

  it('saves, lists and deletes skills, and refuses invalid names and bodies', async () => {
    const { app } = setup();
    const put = (name: string, payload: unknown) =>
      app.inject({ method: 'PUT', url: `/api/ai/skills/${name}`, payload: payload as object });
    const ok = await put('login-checks', {
      description: 'House rules for login cases',
      instructions: 'Title every case "Login – <what>". Always include a locked-account case.',
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ name: 'login-checks' });
    expect((await app.inject({ url: '/api/ai/skills' })).json().items).toHaveLength(1);
    expect((await put('Bad_Name', { description: 'x', instructions: 'y' })).statusCode).toBe(400);
    expect(
      (await put('ok-name', { description: 'Fine line', instructions: 'short' })).json().error.code,
    ).toBe('invalid-skill');
    const del = await app.inject({ method: 'DELETE', url: '/api/ai/skills/login-checks' });
    expect(del.statusCode).toBe(204);
    expect(
      (await app.inject({ method: 'DELETE', url: '/api/ai/skills/login-checks' })).statusCode,
    ).toBe(404);
  });

  it('applies a /skill in the prompt, reports unknown /words and keeps paths as text', async () => {
    const { app, ai, fake, audit } = setup([proposal]);
    turnOn(ai);
    await app.inject({
      method: 'PUT',
      url: '/api/ai/skills/login-checks',
      payload: {
        description: 'House rules for login cases',
        instructions: 'Title every case "Login – <what>". Always include a locked-account case.',
      },
    });
    const r = await post(app, '/api/ai/cases/preview', {
      prompt: '/login-checks Test signing in from /dashboard and /projects/draft-list',
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().skills).toEqual({ applied: ['login-checks'], unknown: ['dashboard'] });
    const system = fake.requests[0]!.system ?? '';
    expect(system).toContain('<skill name="login-checks"');
    expect(system).toContain('Always include a locked-account case.');
    const content = String(fake.requests[0]!.messages[0]!.content);
    expect(content).not.toContain('/login-checks');
    expect(content).toContain('/dashboard and /projects/draft-list');
    expect(audit.some((a) => a.includes('Skills: login-checks.'))).toBe(true);
  });

  it('refuses a prompt that is only a skill name', async () => {
    const { app, ai } = setup([proposal]);
    turnOn(ai);
    await app.inject({
      method: 'PUT',
      url: '/api/ai/skills/login-checks',
      payload: {
        description: 'House rules',
        instructions: 'Always include a locked-account case.',
      },
    });
    const r = await post(app, '/api/ai/cases/preview', { prompt: '/login-checks please' });
    expect(r.statusCode).toBe(400);
    expect(r.json().error.code).toBe('invalid-prompt');
  });

  it('adds the chosen proposals as real test cases numbered like the rest, an honest source and the ai-generated tag', async () => {
    const { app, inventory, audit } = setup();
    const cases = JSON.parse(proposal).cases;
    const r = await post(app, '/api/ai/cases', { cases });
    expect(r.statusCode).toBe(201);
    const items = r.json().items as TestCase[];
    // The inventory holds TC_1..TC_3, so AI cases continue that numbering.
    expect(items.map((c) => c.id)).toEqual(['TC_4', 'TC_5']);
    expect(items[0]).toMatchObject({
      tags: ['ai-generated'],
      source: { workbook: 'AI prompt', rowNumber: 1 },
    });
    expect(inventory.get('TC_5')!.steps).toHaveLength(3);
    expect(audit.some((a) => a.startsWith('ai.cases.add|'))).toBe(true);
    // Adding again continues the numbering instead of overwriting.
    const again = (await post(app, '/api/ai/cases', { cases: [cases[0]] })).json()
      .items as TestCase[];
    expect(again[0]!.id).toBe('TC_6');
  });

  it('does not let legacy AI- IDs set the format of new AI cases', async () => {
    const { app, inventory } = setup();
    for (const id of ['AI-0001', 'AI-0002', 'AI-0003', 'AI-0004']) inventory.set(id, tc(id));
    const cases = JSON.parse(proposal).cases;
    const items = (await post(app, '/api/ai/cases', { cases: [cases[0]] })).json()
      .items as TestCase[];
    expect(items[0]!.id).toBe('TC_4');
  });

  it('asks for a real description, and reports a model problem in plain words', async () => {
    const { app, ai } = setup([
      new LlmError('auth', 'The key was rejected. Check the API key in Settings.'),
    ]);
    turnOn(ai);
    const short = await post(app, '/api/ai/cases/preview', { prompt: 'x' });
    expect(short.statusCode).toBe(400);
    expect(short.json().error.fields.prompt).toMatch(/sentence or two/);
    const bad = await post(app, '/api/ai/cases/preview', {
      prompt: 'Test deleting draft projects',
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe('ai-auth');
    expect(bad.json().error.message).toContain('Check the API key');
  });

  it('refuses incomplete cases and more than twenty (a thorough request) at once', async () => {
    const { app } = setup();
    const empty = await post(app, '/api/ai/cases', {
      cases: [{ title: 'No steps', steps: [], expectedResult: 'ok ok' }],
    });
    expect(empty.statusCode).toBe(400);
    expect(Object.keys(empty.json().error.fields)[0]).toContain('steps');
    const many = Array.from({ length: 21 }, (_, i) => ({
      title: `Case ${i}`,
      steps: ['x'],
      expectedResult: 'ok ok',
    }));
    expect((await post(app, '/api/ai/cases', { cases: many })).statusCode).toBe(400);
    expect((await post(app, '/api/ai/cases', {})).statusCode).toBe(400);
  });
});
