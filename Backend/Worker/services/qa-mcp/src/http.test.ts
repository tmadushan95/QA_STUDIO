import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { afterEach, describe, expect, it } from 'vitest';
import type { Api } from './client.js';
import { startHttpServer } from './http.js';
import { createMcpServer } from './tools.js';

const api: Api = { get: async () => ({ items: [] }), send: async () => ({}) };
const servers: { close(): void }[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.close();
});

async function start(token?: string) {
  const server = await startHttpServer({
    port: 0,
    token,
    createServer: () => createMcpServer(api),
  });
  servers.push(server);
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
}

const post = (url: string, headers: Record<string, string>) =>
  fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...headers,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
  });

describe('HTTP transport', () => {
  it('serves the same tools to an MCP client that sends the token', async () => {
    const url = await start('secret-token-1234');
    const client = new Client({ name: 'test', version: '1' });
    const transport = new StreamableHTTPClientTransport(new URL(url), {
      requestInit: { headers: { authorization: 'Bearer secret-token-1234' } },
    });
    // Same SDK typing gap as in http.ts: accessors typed `T | undefined` under exactOptionalPropertyTypes.
    await client.connect(transport as Transport);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toContain('list_projects');
    await client.close();
  });

  it('refuses a wrong token, another website and a request that does not start a session', async () => {
    const url = await start('secret-token-1234');
    expect((await post(url, { authorization: 'Bearer wrong' })).status).toBe(401);
    expect(
      (
        await post(url, {
          authorization: 'Bearer secret-token-1234',
          origin: 'https://evil.example',
        })
      ).status,
    ).toBe(403);
    expect((await post(url, { authorization: 'Bearer secret-token-1234' })).status).toBe(400);
  });

  it('will not listen beyond this machine', async () => {
    await expect(
      startHttpServer({ port: 0, host: '0.0.0.0', createServer: () => createMcpServer(api) }),
    ).rejects.toThrow('must be this machine');
  });
});
