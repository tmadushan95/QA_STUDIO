import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { FakeLlm, LlmError, type LlmClient } from '@qa-studio/llm';
import { KnowledgeIndex, testCaseDoc, type SqlDb } from '@qa-studio/knowledge';
import type { TestCase } from '@qa-studio/shared';
import { AiService } from './ai-service.js';
import { createApp } from './app.js';
import { SecretBox } from './secrets.js';
import { SqliteStorage } from './sqlite-storage.js';

const KEY = 'AIzaSy-super-secret-key-0001';

function setup(opts: { env?: Record<string, string>; fake?: () => LlmClient } = {}) {
  const storage = new SqliteStorage(':memory:');
  const box = new SecretBox(crypto.randomBytes(32));
  const audit: string[] = [];
  const build = () =>
    new AiService({
      store: storage,
      box,
      env: opts.env ?? {},
      audit: (a, t, d) => audit.push(`${a}|${t}|${d}`),
      extraSecrets: () => ['Pa55w0rd!'],
      ...(opts.fake && { clientFactory: opts.fake }),
    });
  const ai = build();
  const kb = new KnowledgeIndex(storage.sql as unknown as SqlDb);
  const app = createApp(undefined, {
    ai,
    knowledge: { stats: () => kb.stats(), reindex: () => kb.stats(), search: (q) => kb.search(q) },
  });
  return { app, ai, storage, audit, box, build, kb };
}

const put = (app: ReturnType<typeof createApp>, url: string, payload: unknown) =>
  app.inject({ method: 'PUT', url, payload: payload as object });

describe('AI settings', () => {
  it('starts switched off and says what to do', async () => {
    const { app } = setup();
    const v = (await app.inject({ url: '/api/ai' })).json();
    expect(v).toMatchObject({
      provider: 'none',
      ready: false,
      anthropic: { model: 'claude-sonnet-5-5', hasKey: false, keySource: 'none' },
      gemini: { model: 'gemini-2.5-flash', hasKey: false },
      limits: { maxOutputTokens: 4096, maxCallsPerTask: 20 },
    });
    expect(v.reason).toMatch(/switched off/);
  });

  it('saves provider, models and limits, keeps them across a restart, and audits the change', async () => {
    const { app, build, audit } = setup();
    const r = await put(app, '/api/ai', {
      provider: 'gemini',
      gemini: { model: 'gemini-2.5-flash-lite' },
      limits: { maxCallsPerTask: 5 },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({
      provider: 'gemini',
      gemini: { model: 'gemini-2.5-flash-lite' },
      limits: { maxCallsPerTask: 5, maxOutputTokens: 4096 },
    });
    expect(build().view()).toMatchObject({
      provider: 'gemini',
      gemini: { model: 'gemini-2.5-flash-lite' },
    });
    expect(audit.some((a) => a.startsWith('ai.update|'))).toBe(true);
  });

  it('rejects a bad model name, provider or limit, naming each field, and saves nothing', async () => {
    const { app, ai } = setup();
    const r = await put(app, '/api/ai', {
      provider: 'openai',
      gemini: { model: 'bad name!' },
      limits: { maxCallsPerTask: 0 },
    });
    expect(r.statusCode).toBe(400);
    expect(Object.keys(r.json().error.fields).sort()).toEqual([
      'gemini.model',
      'limits.maxCallsPerTask',
      'provider',
    ]);
    expect(ai.view().provider).toBe('none');
  });

  it('stores a key encrypted, never returns it, and never writes it to the audit trail', async () => {
    const { app, storage, audit } = setup();
    const r = await put(app, '/api/ai/keys/gemini', { key: KEY });
    expect(r.statusCode).toBe(200);
    expect(r.body).not.toContain(KEY);
    expect(r.json().gemini).toMatchObject({ hasKey: true, keySource: 'app' });
    expect(JSON.stringify((await app.inject({ url: '/api/ai' })).json())).not.toContain(KEY);
    const stored = storage.loadAiKey('gemini')!;
    expect(stored).not.toContain(KEY);
    expect(stored.startsWith('v1:')).toBe(true);
    expect(audit.join('\n')).not.toContain(KEY);
    expect(audit).toContain('ai.key.set|gemini|API key saved.');
  });

  it('rejects an empty, short or spaced key, and an unknown provider', async () => {
    const { app } = setup();
    for (const key of ['', 'short', 'has a space in it', undefined]) {
      const r = await put(app, '/api/ai/keys/anthropic', { key });
      expect(r.statusCode, String(key)).toBe(400);
      expect(r.json().error.fields.key).toBeTruthy();
    }
    expect((await put(app, '/api/ai/keys/openai', { key: KEY })).statusCode).toBe(404);
  });

  it('removes a key, and falls back to the environment variable when there is one', async () => {
    const { app } = setup({ env: { QA_GEMINI_API_KEY: 'env-key-123456789' } });
    expect((await app.inject({ url: '/api/ai' })).json().gemini).toMatchObject({
      hasKey: true,
      keySource: 'environment',
    });
    await put(app, '/api/ai/keys/gemini', { key: KEY });
    expect((await app.inject({ url: '/api/ai' })).json().gemini.keySource).toBe('app');
    const gone = await app.inject({ method: 'DELETE', url: '/api/ai/keys/gemini' });
    expect(gone.json().gemini.keySource).toBe('environment');
  });

  it('is ready only when the chosen provider has a key', async () => {
    const { app } = setup();
    await put(app, '/api/ai', { provider: 'anthropic' });
    expect((await app.inject({ url: '/api/ai' })).json()).toMatchObject({
      ready: false,
      reason: 'Add an API key for Anthropic to use it.',
    });
    await put(app, '/api/ai/keys/anthropic', { key: KEY });
    expect((await app.inject({ url: '/api/ai' })).json().ready).toBe(true);
  });
});

describe('AI connection test', () => {
  it('reports success with the model that answered', async () => {
    const fake = new FakeLlm(['OK'], 'claude-sonnet-5-5');
    const { app } = setup({ fake: () => fake });
    await put(app, '/api/ai', { provider: 'anthropic' });
    await put(app, '/api/ai/keys/anthropic', { key: KEY });
    const r = (await app.inject({ method: 'POST', url: '/api/ai/test', payload: {} })).json();
    expect(r).toMatchObject({ ok: true, provider: 'anthropic', model: 'claude-sonnet-5-5' });
    expect(fake.requests).toHaveLength(1);
    expect(fake.requests[0]!.maxTokens).toBeLessThanOrEqual(16);
  });

  it('reports a failure in plain words without the key', async () => {
    const { app } = setup({
      fake: () =>
        new FakeLlm([new LlmError('auth', 'Invalid key. Check the API key in Settings.')]),
    });
    await put(app, '/api/ai/keys/gemini', { key: KEY });
    const r = (
      await app.inject({ method: 'POST', url: '/api/ai/test', payload: { provider: 'gemini' } })
    ).json();
    expect(r).toMatchObject({ ok: false, provider: 'gemini' });
    expect(r.message).toContain('Check the API key');
    expect(JSON.stringify(r)).not.toContain(KEY);
  });

  it('says what is missing when there is no key or no provider', async () => {
    const { app } = setup();
    expect(
      (await app.inject({ method: 'POST', url: '/api/ai/test', payload: {} })).statusCode,
    ).toBe(400);
    const r = (
      await app.inject({ method: 'POST', url: '/api/ai/test', payload: { provider: 'anthropic' } })
    ).json();
    expect(r).toMatchObject({ ok: false });
    expect(r.message).toContain('Add one in Settings');
  });

  it('never sends the API keys or a test-account password to the model', async () => {
    const fake = new FakeLlm(['ok']);
    const { ai } = setup({ fake: () => fake });
    ai.update({ provider: 'gemini' });
    ai.setKey('gemini', KEY);
    await ai.gateway().complete({
      messages: [{ role: 'user', content: `use ${KEY} and password Pa55w0rd! to sign in` }],
      maxTokens: 50,
    });
    expect(fake.requests[0]!.messages[0]!.content).toBe(
      'use [redacted] and password [redacted] to sign in',
    );
  });

  it('refuses to build a gateway while AI is off', () => {
    const { ai } = setup();
    expect(() => ai.gateway()).toThrow(/switched off/);
  });
});

describe('knowledge endpoints', () => {
  it('reports counts and searches with citations', async () => {
    const { app, kb } = setup();
    const tc = {
      schemaVersion: 1,
      id: 'TC_04',
      title: 'Verify deletion of a Draft project',
      steps: [],
      tags: [],
      dependsOn: [],
      readiness: 'needs-clarification',
      source: { workbook: 'plan.xlsx', worksheet: 'S', rowNumber: 5 },
    } as unknown as TestCase;
    kb.upsert(testCaseDoc(tc));
    expect((await app.inject({ url: '/api/knowledge' })).json()).toMatchObject({ 'test-case': 1 });
    const hits = (await app.inject({ url: '/api/knowledge/search?q=draft%20deletion' })).json()
      .items;
    expect(hits[0]).toMatchObject({ docId: 'TC_04', source: 'plan.xlsx › S › row 5' });
    expect((await app.inject({ method: 'POST', url: '/api/knowledge/reindex' })).statusCode).toBe(
      200,
    );
  });
});
