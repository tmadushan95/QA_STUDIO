import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { EventBus } from './events.js';
import { registerInternalSync, registerParameterAi } from './internal-sync.js';
import { MemoryStore } from './store.js';

const TOKEN = 'internal-secret-0123456789abcdef0123456789';

function setup() {
  const blocks = new Map<string, unknown>();
  const events = new EventBus();
  const seen: string[] = [];
  events.subscribe((e) => e.type === 'data' && seen.push(e.path));
  const app = createApp(new MemoryStore());
  registerInternalSync(app, {
    token: TOKEN,
    store: new MemoryStore(),
    events,
    config: { applyRemoteConfig: (k, v) => void blocks.set(k, v) },
  });
  return { app, blocks, seen };
}

describe('config change notices from the API', () => {
  it('refuses a request without the internal secret', async () => {
    const { app, blocks } = setup();
    const r = await app.inject({
      method: 'POST',
      url: '/internal/sync/config',
      payload: { key: 'pages', value: [] },
    });
    expect(r.statusCode).toBe(401);
    expect(blocks.size).toBe(0);
  });

  it('takes the new block and tells open pages to refresh', async () => {
    const { app, blocks, seen } = setup();
    const r = await app.inject({
      method: 'POST',
      url: '/internal/sync/config',
      headers: { 'x-qa-internal-token': TOKEN },
      payload: { key: 'pages:3', value: [{ name: 'Home', route: '/', marker: '' }] },
    });
    expect(r.statusCode).toBe(204);
    expect(blocks.get('pages:3')).toEqual([{ name: 'Home', route: '/', marker: '' }]);
    expect(seen).toEqual(['/api/pages']);
  });
});

describe('the AI route the API asks for parameter values', () => {
  const ask = async (
    suggest: (i: {
      title: string;
      steps: string[];
      names: string[];
    }) => Promise<Record<string, string>>,
    headers: Record<string, string> = { 'x-qa-internal-token': TOKEN },
  ) => {
    const app = createApp(new MemoryStore());
    registerParameterAi(app, { token: TOKEN, suggest });
    return app.inject({
      method: 'POST',
      url: '/internal/parameters/ai-suggest',
      headers,
      payload: { title: 'Create project', steps: ['Open'], names: ['projectCode'] },
    });
  };

  it('refuses a request without the internal secret', async () => {
    const r = await ask(() => Promise.resolve({}), {});
    expect(r.statusCode).toBe(401);
  });

  it('answers with what the AI suggests', async () => {
    const r = await ask((i) => Promise.resolve({ [i.names[0]!]: 'PRJ-7' }));
    expect(r.json()).toEqual({ values: { projectCode: 'PRJ-7' } });
  });

  it('answers with no values, not an error, when the AI is off or fails, so the API guesses instead', async () => {
    const r = await ask(() => Promise.reject(new Error('no provider')));
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ values: {} });
  });
});
