import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  AnthropicClient,
  FakeLlm,
  GeminiClient,
  LlmError,
  LlmGateway,
  THINKING_HEADROOM,
  completeJson,
  createClient,
  extractJson,
  type CallRecord,
  type FetchLike,
} from './index.js';

const failed = (): never => {
  throw new Error('The call should have failed.');
};
const KEY = 'sk-test-SECRET-1234567890';

function fetchReturning(
  status: number,
  body: unknown,
  seen: { url?: string; init?: RequestInit }[] = [],
): FetchLike {
  return async (url, init) => {
    seen.push({ url, init });
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
  };
}

describe('AnthropicClient', () => {
  it('sends the key in a header, maps the request and reads text and usage', async () => {
    const seen: { url?: string; init?: RequestInit }[] = [];
    const c = new AnthropicClient({
      apiKey: KEY,
      model: 'm1',
      fetch: fetchReturning(
        200,
        {
          content: [{ type: 'text', text: 'hello' }],
          usage: { input_tokens: 5, output_tokens: 2 },
          stop_reason: 'end_turn',
        },
        seen,
      ),
    });
    const r = await c.complete({
      system: 'be brief',
      messages: [{ role: 'user', content: 'hi' }],
      maxTokens: 50,
      temperature: 0,
    });
    expect(r).toMatchObject({
      text: 'hello',
      provider: 'anthropic',
      model: 'm1',
      usage: { inputTokens: 5, outputTokens: 2 },
    });
    expect(seen[0]!.url).toBe('https://api.anthropic.com/v1/messages');
    const headers = seen[0]!.init!.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe(KEY);
    expect(headers['anthropic-version']).toBe('2023-06-01');
    expect(JSON.parse(String(seen[0]!.init!.body))).toMatchObject({
      model: 'm1',
      max_tokens: 50,
      system: 'be brief',
      temperature: 0,
    });
    expect(seen[0]!.url).not.toContain(KEY);
  });

  it('maps statuses to clear errors and never leaks the key', async () => {
    const auth = new AnthropicClient({
      apiKey: KEY,
      model: 'm',
      fetch: fetchReturning(401, { error: { message: `bad key ${KEY}` } }),
    });
    const e = await auth
      .complete({ messages: [{ role: 'user', content: 'x' }], maxTokens: 1 })
      .then(failed, (x: unknown) => x as LlmError);
    expect(e).toBeInstanceOf(LlmError);
    expect(e.kind).toBe('auth');
    expect(e.message).not.toContain(KEY);
    expect(e.message).toContain('Check the API key in Settings.');

    const limited = new AnthropicClient({
      apiKey: KEY,
      model: 'm',
      fetch: fetchReturning(429, { error: { message: 'slow down' } }),
    });
    const l = await limited
      .complete({ messages: [{ role: 'user', content: 'x' }], maxTokens: 1 })
      .then(failed, (x: unknown) => x as LlmError);
    expect(l.kind).toBe('rate-limit');
    expect(l.retryable).toBe(true);
  });

  it('reports a network failure without the key, and a timeout', async () => {
    const down = new AnthropicClient({
      apiKey: KEY,
      model: 'm',
      fetch: async () => {
        throw new Error(`connect refused for ${KEY}`);
      },
    });
    const e = await down
      .complete({ messages: [{ role: 'user', content: 'x' }], maxTokens: 1 })
      .then(failed, (x: unknown) => x as LlmError);
    expect(e.kind).toBe('network');
    expect(e.message).not.toContain(KEY);

    const slow = new AnthropicClient({
      apiKey: KEY,
      model: 'm',
      fetch: (_u, init) =>
        new Promise((_r, reject) =>
          init.signal!.addEventListener('abort', () => reject(new Error('aborted'))),
        ),
    });
    const t = await slow
      .complete({ messages: [{ role: 'user', content: 'x' }], maxTokens: 1, timeoutMs: 20 })
      .then(failed, (x: unknown) => x as LlmError);
    expect(t.kind).toBe('timeout');
  });

  it('reports an answer with no text', async () => {
    const c = new AnthropicClient({
      apiKey: KEY,
      model: 'm',
      fetch: fetchReturning(200, { content: [], stop_reason: 'end_turn' }),
    });
    const e = await c
      .complete({ messages: [{ role: 'user', content: 'x' }], maxTokens: 1 })
      .then(failed, (x: unknown) => x as LlmError);
    expect(e.kind).toBe('empty');
  });
});

describe('GeminiClient', () => {
  it('keeps the key out of the URL, maps roles and reads text and usage', async () => {
    const seen: { url?: string; init?: RequestInit }[] = [];
    const c = new GeminiClient({
      apiKey: KEY,
      model: 'gemini-x',
      fetch: fetchReturning(
        200,
        {
          candidates: [
            { content: { parts: [{ text: 'a' }, { text: 'b' }] }, finishReason: 'STOP' },
          ],
          usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 3 },
        },
        seen,
      ),
    });
    const r = await c.complete({
      system: 'sys',
      messages: [
        { role: 'user', content: 'q' },
        { role: 'assistant', content: 'prev' },
      ],
      maxTokens: 20,
    });
    expect(r).toMatchObject({
      text: 'ab',
      provider: 'gemini',
      usage: { inputTokens: 7, outputTokens: 3 },
    });
    expect(seen[0]!.url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-x:generateContent',
    );
    expect(seen[0]!.url).not.toContain(KEY);
    expect((seen[0]!.init!.headers as Record<string, string>)['x-goog-api-key']).toBe(KEY);
    const body = JSON.parse(String(seen[0]!.init!.body));
    expect(body.contents.map((x: { role: string }) => x.role)).toEqual(['user', 'model']);
    expect(body.systemInstruction.parts[0].text).toBe('sys');
    expect(body.generationConfig.maxOutputTokens).toBe(20);
    expect(body.generationConfig.thinkingConfig).toBeUndefined();
  });

  it('gives Gemini 3+ low thinking, room for it, and no temperature; 2.x is unchanged', async () => {
    const bodyFor = async (model: string) => {
      const seen: { url?: string; init?: RequestInit }[] = [];
      await new GeminiClient({
        apiKey: KEY,
        model,
        fetch: fetchReturning(
          200,
          { candidates: [{ content: { parts: [{ text: 'ok' }] } }] },
          seen,
        ),
      }).complete({ messages: [{ role: 'user', content: 'q' }], maxTokens: 5, temperature: 0 });
      return JSON.parse(String(seen[0]!.init!.body));
    };
    expect((await bodyFor('gemini-3.8-flash')).generationConfig).toEqual({
      maxOutputTokens: 5 + THINKING_HEADROOM,
      thinkingConfig: { thinkingLevel: 'low' },
    });
    expect((await bodyFor('gemini-2.5-flash')).generationConfig).toEqual({
      maxOutputTokens: 5,
      temperature: 0,
    });
  });

  it('reports a blocked prompt and a quota error', async () => {
    const blocked = new GeminiClient({
      apiKey: KEY,
      model: 'm',
      fetch: fetchReturning(200, { promptFeedback: { blockReason: 'SAFETY' } }),
    });
    expect(
      (
        await blocked
          .complete({ messages: [{ role: 'user', content: 'x' }], maxTokens: 1 })
          .then(failed, (x: unknown) => x as LlmError)
      ).kind,
    ).toBe('blocked');
    const quota = new GeminiClient({
      apiKey: KEY,
      model: 'm',
      fetch: fetchReturning(429, { error: { message: 'quota exceeded' } }),
    });
    const e = await quota
      .complete({ messages: [{ role: 'user', content: 'x' }], maxTokens: 1 })
      .then(failed, (x: unknown) => x as LlmError);
    expect(e.kind).toBe('rate-limit');
    expect(e.message).toContain('switch provider in Settings');
  });

  it('sends attached screenshots and PDFs in each provider’s own shape, ahead of the text', async () => {
    const message = {
      role: 'user' as const,
      content: 'Write cases',
      attachments: [
        { mediaType: 'image/png' as const, data: 'iVBORw0KGgo=' },
        { mediaType: 'application/pdf' as const, data: 'JVBERi0=' },
      ],
    };
    const anthropicSeen: { url?: string; init?: RequestInit }[] = [];
    await new AnthropicClient({
      apiKey: KEY,
      model: 'm1',
      fetch: fetchReturning(200, { content: [{ type: 'text', text: 'ok' }] }, anthropicSeen),
    }).complete({ messages: [message], maxTokens: 10 });
    expect(JSON.parse(String(anthropicSeen[0]!.init!.body)).messages).toEqual([
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo=' },
          },
          {
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: 'JVBERi0=' },
          },
          { type: 'text', text: 'Write cases' },
        ],
      },
    ]);

    const geminiSeen: { url?: string; init?: RequestInit }[] = [];
    await new GeminiClient({
      apiKey: KEY,
      model: 'g1',
      fetch: fetchReturning(
        200,
        { candidates: [{ content: { parts: [{ text: 'ok' }] } }] },
        geminiSeen,
      ),
    }).complete({ messages: [message], maxTokens: 10 });
    expect(JSON.parse(String(geminiSeen[0]!.init!.body)).contents[0].parts).toEqual([
      { inline_data: { mime_type: 'image/png', data: 'iVBORw0KGgo=' } },
      { inline_data: { mime_type: 'application/pdf', data: 'JVBERi0=' } },
      { text: 'Write cases' },
    ]);
  });

  it('createClient picks the adapter for the provider', () => {
    expect(createClient({ provider: 'gemini', apiKey: 'k', model: 'm' }).provider).toBe('gemini');
    expect(createClient({ provider: 'anthropic', apiKey: 'k', model: 'm' }).provider).toBe(
      'anthropic',
    );
  });
});

describe('LlmGateway', () => {
  const ask = (text = 'hello') => ({
    messages: [{ role: 'user' as const, content: text }],
    maxTokens: 100,
  });
  const noSleep = async () => undefined;

  it('removes secrets from every part of the prompt before it leaves, longest first', async () => {
    const fake = new FakeLlm(['ok']);
    const g = new LlmGateway(fake, {
      secrets: () => ['hunter2!', 'hunter2!extra', 'ab'],
      sleep: noSleep,
    });
    await g.complete({
      system: 'the password is hunter2!extra',
      messages: [{ role: 'user', content: 'log in with hunter2! now ab' }],
      maxTokens: 10,
    });
    const sent = fake.requests[0]!;
    expect(sent.system).toBe('the password is [redacted]');
    expect(sent.messages[0]!.content).toBe('log in with [redacted] now ab'); // "ab" is too short to be treated as a secret
  });

  it('caps output tokens, refuses oversized prompts and stops after the call budget', async () => {
    const fake = new FakeLlm(['1', '2', '3']);
    const g = new LlmGateway(fake, {
      maxOutputTokens: 50,
      maxInputChars: 20,
      maxCalls: 2,
      sleep: noSleep,
    });
    await g.complete(ask());
    expect(fake.requests[0]!.maxTokens).toBe(50);
    await expect(g.complete(ask('x'.repeat(30)))).rejects.toMatchObject({ kind: 'budget' });
    await g.complete(ask());
    await expect(g.complete(ask())).rejects.toMatchObject({
      kind: 'budget',
      message: expect.stringContaining('limit of 2 model calls'),
    });
    expect(fake.requests).toHaveLength(2);
  });

  it('retries a rate limit, but not a bad key', async () => {
    const calls: CallRecord[] = [];
    const flaky = new FakeLlm([new LlmError('rate-limit', 'slow'), 'worked']);
    const g = new LlmGateway(flaky, { sleep: noSleep, onCall: (r) => calls.push(r) });
    expect((await g.complete(ask())).text).toBe('worked');
    expect(calls.map((c) => c.ok)).toEqual([false, true]);
    expect(calls[0]!.error).toBe('rate-limit');

    const bad = new FakeLlm([new LlmError('auth', 'nope'), 'never']);
    await expect(new LlmGateway(bad, { sleep: noSleep }).complete(ask())).rejects.toMatchObject({
      kind: 'auth',
    });
    expect(bad.requests).toHaveLength(1);
  });

  it('gives up after the retries and audits sizes, never content', async () => {
    const calls: CallRecord[] = [];
    const down = new FakeLlm([
      new LlmError('server', 'a'),
      new LlmError('server', 'b'),
      new LlmError('server', 'c'),
    ]);
    const g = new LlmGateway(down, { retries: 2, sleep: noSleep, onCall: (r) => calls.push(r) });
    await expect(g.complete(ask('private text'))).rejects.toMatchObject({ kind: 'server' });
    expect(calls).toHaveLength(3);
    expect(JSON.stringify(calls)).not.toContain('private text');
    expect(calls[0]).toMatchObject({ inputChars: 12 });
  });
});

describe('JSON answers', () => {
  const Shape = z.object({ steps: z.array(z.string()).min(1) });

  it('extracts JSON from fences and surrounding prose', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Sure! Here it is: {"a":1} Hope that helps.')).toEqual({ a: 1 });
    expect(() => extractJson('no json here')).toThrow();
  });

  it('accepts a good answer first time', async () => {
    const g = new LlmGateway(new FakeLlm(['{"steps":["open"]}']));
    const r = await completeJson(
      g,
      { messages: [{ role: 'user', content: 'x' }], maxTokens: 50 },
      Shape,
    );
    expect(r.value.steps).toEqual(['open']);
  });

  it('tells the model what was wrong and uses the corrected answer', async () => {
    const fake = new FakeLlm(['{"steps":[]}', '{"steps":["open"]}']);
    const r = await completeJson(
      new LlmGateway(fake),
      { messages: [{ role: 'user', content: 'x' }], maxTokens: 50 },
      Shape,
    );
    expect(r.value.steps).toEqual(['open']);
    const retry = fake.requests[1]!.messages;
    expect(retry.at(-1)!.content).toContain('steps');
    expect(retry.at(-2)!.role).toBe('assistant');
  });

  it('fails clearly when the model cannot produce usable JSON', async () => {
    const g = new LlmGateway(new FakeLlm(['nope', 'still nope']));
    await expect(
      completeJson(g, { messages: [{ role: 'user', content: 'x' }], maxTokens: 50 }, Shape),
    ).rejects.toMatchObject({ kind: 'invalid-output' });
  });
});
