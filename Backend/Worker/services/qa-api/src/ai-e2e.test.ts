import crypto from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ActionRegistry, defineAction } from '@qa-studio/automation-core';
import { KnowledgeIndex, type SqlDb } from '@qa-studio/knowledge';
import type { Scenario, TestCase } from '@qa-studio/shared';
import { AiService } from './ai-service.js';
import { AiTasks, type GenerateJob } from './ai-tasks.js';
import { EventBus } from './events.js';
import { ScenarioService } from './scenario-service.js';
import { SecretBox } from './secrets.js';
import { SqliteStorage } from './sqlite-storage.js';

/**
 * The whole path with the real HTTP adapters: AiService -> gateway -> AnthropicClient/GeminiClient -> HTTP -> a local
 * server that speaks each provider's format -> generator -> validator -> scenario draft. Only the host differs.
 */
let server: http.Server | undefined;
afterEach(() => void server?.close());

const PASSWORD = 'Pa55w0rd!';
const KEY = 'sk-ant-e2e-secret-key-0123456789';

const registry = new ActionRegistry()
  .register(
    defineAction({
      name: 'drafts.open-project',
      description: 'Open a project.',
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

const answer = JSON.stringify({
  steps: [
    { action: 'drafts.open-project', params: { list: 'draft', code: '{{data.draftProject}}' } },
    { action: 'project.click-delete', params: {} },
  ],
  description: 'Start a delete',
  dataNeeded: ['draftProject'],
});

async function setup(reply: (provider: 'anthropic' | 'gemini', body: unknown) => unknown) {
  const received: { url: string; headers: http.IncomingHttpHeaders; body: string }[] = [];
  server = http.createServer(async (req, res) => {
    let body = '';
    for await (const c of req) body += c;
    received.push({ url: req.url ?? '', headers: req.headers, body });
    const provider = req.url?.startsWith('/v1/messages') ? 'anthropic' : 'gemini';
    res
      .writeHead(200, { 'content-type': 'application/json' })
      .end(JSON.stringify(reply(provider, JSON.parse(body))));
  });
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const storage = new SqliteStorage(':memory:');
  const ai = new AiService({
    store: storage,
    box: new SecretBox(crypto.randomBytes(32)),
    env: {},
    audit: () => undefined,
    extraSecrets: () => [PASSWORD],
    // Only the host is swapped; the adapters build the real provider URLs and headers.
    fetch: (url, init) => fetch(url.replace(/^https:\/\/[^/]+/, base), init),
  });
  const inventory = new Map<string, TestCase>([
    [
      'TC_1',
      {
        schemaVersion: 1,
        id: 'TC_1',
        title: 'Verify the delete confirmation',
        preconditions: `Sign in as qa with password ${PASSWORD}`,
        steps: [{ order: 1, action: 'Click Delete' }],
        expectedResult: 'A dialog is shown',
        tags: [],
        dependsOn: [],
        readiness: 'needs-clarification',
        source: { workbook: 'p.xlsx', worksheet: 'S', rowNumber: 2 },
      } as TestCase,
    ],
  ]);
  const scenarios = new ScenarioService({
    store: storage,
    registry,
    live: new Map<string, Scenario>(),
    caseIds: () => new Set(inventory.keys()),
    audit: () => undefined,
  });
  const tasks = new AiTasks({
    ai,
    knowledge: new KnowledgeIndex(storage.sql as unknown as SqlDb),
    scenarios,
    actions: () => registry.list(),
    inventory,
    events: new EventBus(),
    audit: () => undefined,
  });
  return { ai, tasks, scenarios, received };
}

async function done(tasks: AiTasks, id: string): Promise<GenerateJob> {
  for (let i = 0; i < 300; i++) {
    const j = tasks.job(id)!;
    if (j.status !== 'running') return j;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('The job did not finish.');
}

describe('generation over the real provider adapters', () => {
  it('Anthropic: sends the documented request, keeps the key and password out of the body, and saves a validated AI draft', async () => {
    const { ai, tasks, scenarios, received } = await setup((p) =>
      p === 'anthropic'
        ? {
            content: [{ type: 'text', text: answer }],
            usage: { input_tokens: 900, output_tokens: 120 },
            stop_reason: 'end_turn',
          }
        : {},
    );
    ai.update({ provider: 'anthropic' });
    ai.setKey('anthropic', KEY);
    const job = await done(tasks, tasks.startGeneration(['TC_1']).id);

    expect(job.results).toEqual([
      { caseId: 'TC_1', outcome: 'drafted', message: 'Needs parameters: draftProject.' },
    ]);
    expect(scenarios.get('TC_1').draft).toMatchObject({ status: 'validated', origin: 'ai' });

    const req = received[0]!;
    expect(req.url).toBe('/v1/messages');
    expect(req.headers['x-api-key']).toBe(KEY);
    expect(req.headers['anthropic-version']).toBe('2023-06-01');
    const body = JSON.parse(req.body);
    expect(body.model).toBe('claude-sonnet-5-5');
    expect(body.system).toContain('drafts.open-project');
    expect(body.messages[0].content).toContain('Verify the delete confirmation');
    expect(req.body).not.toContain(PASSWORD);
    expect(req.body).not.toContain(KEY);
    expect(req.body).toContain('[redacted]');
  });

  it('Gemini: uses generateContent with the key in a header, never in the URL', async () => {
    const { ai, tasks, scenarios, received } = await setup((p) =>
      p === 'gemini'
        ? {
            candidates: [{ content: { parts: [{ text: answer }] }, finishReason: 'STOP' }],
            usageMetadata: { promptTokenCount: 800, candidatesTokenCount: 100 },
          }
        : {},
    );
    const GKEY = 'AIzaSy-e2e-gemini-key-0123456';
    ai.update({ provider: 'gemini' });
    ai.setKey('gemini', GKEY);
    const job = await done(tasks, tasks.startGeneration(['TC_1']).id);
    expect(job.results[0]!.outcome).toBe('drafted');
    expect(scenarios.get('TC_1').draft!.status).toBe('validated');

    const req = received[0]!;
    expect(req.url).toBe('/v1beta/models/gemini-2.5-flash:generateContent');
    expect(req.url).not.toContain(GKEY);
    expect(req.headers['x-goog-api-key']).toBe(GKEY);
    expect(req.body).not.toContain(PASSWORD);
    expect(JSON.parse(req.body).contents[0].parts[0].text).toContain('<test_case>');
  });

  it('repairs a wrong first answer over HTTP, using the platform validator message', async () => {
    let n = 0;
    const { ai, tasks, received } = await setup(() => ({
      content: [
        {
          type: 'text',
          text:
            ++n === 1
              ? JSON.stringify({ steps: [{ action: 'click.button', params: {} }] })
              : answer,
        },
      ],
      usage: { input_tokens: 1, output_tokens: 1 },
      stop_reason: 'end_turn',
    }));
    ai.update({ provider: 'anthropic' });
    ai.setKey('anthropic', KEY);
    const job = await done(tasks, tasks.startGeneration(['TC_1']).id);
    expect(job.results[0]!.outcome).toBe('drafted');
    expect(received).toHaveLength(2);
    expect(JSON.parse(received[1]!.body).messages.at(-1).content).toContain(
      'Unknown action "click.button"',
    );
  });
});
