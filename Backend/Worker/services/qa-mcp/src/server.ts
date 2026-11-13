#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { httpApi } from './client.js';
import { createMcpServer } from './tools.js';

/**
 * MCP server over stdio. Point an MCP client at it, with the QA platform running:
 *   QA_API_URL   where the platform listens (default http://127.0.0.1:5080)
 *   QA_ADMIN_TOKEN  the platform's access token, when it has one
 * stdout carries the protocol, so anything human-readable goes to stderr.
 */
const baseUrl = process.env['QA_API_URL'] ?? 'http://127.0.0.1:5080';
const server = createMcpServer(httpApi({ baseUrl, token: process.env['QA_ADMIN_TOKEN'] }));
await server.connect(new StdioServerTransport());
process.stderr.write(`qa-studio MCP server ready (platform: ${baseUrl})\n`);
