#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { httpApi } from './client.js';
import { startHttpServer } from './http.js';
import { createMcpServer } from './tools.js';
import { parseToolsets } from './toolsets.js';

/**
 * MCP server. Point an MCP client at it, with the QA platform running:
 *   QA_API_URL         where the platform listens (default http://127.0.0.1:5080, the .NET API, which also forwards
 *                      the worker's routes)
 *   QA_ADMIN_TOKEN     the platform's access token, when it has one
 *   QA_MCP_TOOLSETS    which tools to offer: read, author, operate, defects, admin (default read,author,operate)
 *   QA_MCP_PROJECT_ID  project to use when the agent does not name one (optional)
 *   QA_MCP_TRANSPORT   stdio (default) or http
 *   QA_MCP_HTTP_PORT   http only: port (default 5090); QA_MCP_HTTP_HOST (default 127.0.0.1, loopback only)
 *   QA_MCP_HTTP_TOKEN  http only: bearer token clients must send
 * With stdio, stdout carries the protocol, so anything human-readable goes to stderr.
 */
const env = process.env;
const baseUrl = env['QA_API_URL'] ?? 'http://127.0.0.1:5080';
const projectId = Number(env['QA_MCP_PROJECT_ID']);
const api = httpApi({ baseUrl, token: env['QA_ADMIN_TOKEN'] });
const toolsets = parseToolsets(env['QA_MCP_TOOLSETS']);
const create = () =>
  createMcpServer(api, {
    toolsets,
    ...(Number.isInteger(projectId) && projectId > 0 && { defaultProjectId: projectId }),
  });
const sets = [...toolsets].join(',');

if ((env['QA_MCP_TRANSPORT'] ?? 'stdio') === 'http') {
  const port = Number(env['QA_MCP_HTTP_PORT'] ?? 5090);
  const host = env['QA_MCP_HTTP_HOST'] ?? '127.0.0.1';
  const token = env['QA_MCP_HTTP_TOKEN'];
  await startHttpServer({ port, host, token, createServer: create });
  process.stderr.write(
    `qa-studio MCP server on http://${host}:${port}/mcp (platform: ${baseUrl}; toolsets: ${sets})\n`,
  );
  if (!token)
    process.stderr.write(
      'Warning: QA_MCP_HTTP_TOKEN is not set; any program on this machine can connect.\n',
    );
} else {
  await create().connect(new StdioServerTransport());
  process.stderr.write(`qa-studio MCP server ready (platform: ${baseUrl}; toolsets: ${sets})\n`);
}
