import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { EventBus } from './events.js';

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  await close?.();
  close = undefined;
});

async function start(bus = new EventBus()) {
  const app = createApp(undefined, { events: bus });
  await app.listen({ port: 0, host: '127.0.0.1' });
  close = () => app.close();
  const { port } = app.server.address() as AddressInfo;
  return { app, bus, base: `http://127.0.0.1:${port}` };
}

/** Open the stream and return a reader that resolves once the text contains `needle`. */
async function openStream(base: string) {
  const ctrl = new AbortController();
  const res = await fetch(`${base}/api/events`, { signal: ctrl.signal });
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let text = '';
  const until = async (needle: string, ms = 3000) => {
    const end = Date.now() + ms;
    while (!text.includes(needle)) {
      if (Date.now() > end) throw new Error(`Timed out waiting for ${needle}. Got: ${text}`);
      const chunk = await Promise.race([
        reader.read(),
        new Promise<null>((r) => setTimeout(() => r(null), 200)),
      ]);
      if (chunk && !chunk.done) text += dec.decode(chunk.value);
    }
    return text;
  };
  return { res, until, text: () => text, stop: () => ctrl.abort() };
}

describe('live events', () => {
  it('streams run events as server-sent events', async () => {
    const { base, bus } = await start();
    const s = await openStream(base);
    expect(s.res.headers.get('content-type')).toBe('text/event-stream');
    await s.until(': connected');
    bus.emit({ type: 'run', id: 'r1', status: 'running' });
    const text = await s.until('"id":"r1"');
    expect(text).toContain('event: run');
    expect(text).toContain('"status":"running"');
    s.stop();
  });

  it('tells open dashboards when something is changed through the API, but not for reads or failures', async () => {
    const { app, base, bus } = await start();
    const seen: string[] = [];
    bus.subscribe((e) => seen.push(e.type === 'data' ? e.path : e.type));

    await app.inject({ method: 'GET', url: '/api/health' });
    await app.inject({ method: 'POST', url: '/api/inventory/delete', payload: { nope: 1 } }); // rejected
    expect(seen).toEqual([]);

    const ok = await app.inject({ method: 'DELETE', url: '/api/inventory' });
    expect(ok.statusCode).toBe(200);
    await new Promise((r) => setTimeout(r, 20));
    expect(seen).toEqual(['/api/inventory']);
    expect(base).toContain('127.0.0.1');
  });

  it('stops delivering to a closed connection and does not let one failing listener block the rest', async () => {
    const { base, bus } = await start();
    bus.subscribe(() => {
      throw new Error('boom');
    });
    const s = await openStream(base);
    await s.until(': connected');
    const before = bus.size;
    s.stop();
    for (let i = 0; i < 20 && bus.size >= before; i++) await new Promise((r) => setTimeout(r, 50));
    expect(bus.size).toBe(before - 1);
    expect(() => bus.emit({ type: 'run', id: 'x', status: 'queued' })).not.toThrow();
  });
});
