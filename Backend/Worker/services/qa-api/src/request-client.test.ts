import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { clientOf, registerRequestClient, withClient } from './request-client.js';

describe('request client', () => {
  it('keeps only a short product name from the header', () => {
    expect(clientOf('mcp/0.2.0')).toBe('mcp');
    expect(clientOf(' mcp ')).toBe('mcp');
    expect(clientOf('mcp; drop table')).toBeUndefined();
    expect(clientOf('x'.repeat(30))).toBeUndefined();
    expect(clientOf(undefined)).toBeUndefined();
  });

  it('marks audit details written while handling a request from that client, and only those', async () => {
    const app = Fastify();
    registerRequestClient(app);
    app.get('/x', async () => {
      // Work after an await still belongs to the request.
      await new Promise((r) => setTimeout(r, 1));
      return { detail: withClient('Test case created.') };
    });
    const from = (headers: Record<string, string>) =>
      app.inject({ method: 'GET', url: '/x', headers }).then((r) => r.json().detail);
    expect(await from({ 'x-qa-client': 'mcp/0.2.0' })).toBe('Test case created. (via mcp)');
    expect(await from({})).toBe('Test case created.');
    expect(withClient('Outside a request.')).toBe('Outside a request.');
  });
});
