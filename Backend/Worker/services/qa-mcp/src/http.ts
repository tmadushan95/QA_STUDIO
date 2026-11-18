import { randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';

/** Only this machine. A shared server needs per-user sign-in (OAuth) first; see docs/adr/0013. */
export const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1']);
/** Room for a requirement with attached screenshots (the platform's own limit is 16 MB). */
const MAX_BODY = 20 * 1024 * 1024;
/** Open sessions at most, so a misbehaving client cannot grow memory without end. */
const MAX_SESSIONS = 50;

export interface HttpOptions {
  port: number;
  host?: string;
  /** Bearer token clients must send. Strongly advised; without it any program on this machine can connect. */
  token?: string | undefined;
  /** A new MCP server per session: each client gets its own state. */
  createServer: () => McpServer;
}

const send = (res: ServerResponse, status: number, message: string) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message }, id: null }));
};

const tokenMatches = (expected: string, header: string | undefined) => {
  const given = Buffer.from(header?.startsWith('Bearer ') ? header.slice(7).trim() : '');
  const want = Buffer.from(expected);
  return given.length === want.length && timingSafeEqual(given, want);
};

/**
 * The browser checks the MCP spec asks of a local HTTP server: the Host header must be this machine (stops DNS
 * rebinding) and a browser Origin, when sent, must be this machine too (stops other websites driving it).
 */
function isLocalRequest(req: IncomingMessage): boolean {
  const hostname = (value: string) => {
    try {
      return new URL(value.includes('://') ? value : `http://${value}`).hostname.replace(
        /^\[|\]$/g,
        '',
      );
    } catch {
      return '';
    }
  };
  if (!LOOPBACK.has(hostname(req.headers.host ?? ''))) return false;
  const origin = req.headers.origin;
  return origin === undefined || LOOPBACK.has(hostname(origin));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new Error('too-large');
    chunks.push(chunk as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

/** Streamable HTTP on `/mcp`, for MCP clients that cannot start a local process. Loopback only. */
export function startHttpServer(o: HttpOptions): Promise<Server> {
  const host = o.host ?? '127.0.0.1';
  if (!LOOPBACK.has(host)) {
    return Promise.reject(
      new Error(
        `QA_MCP_HTTP_HOST must be this machine (127.0.0.1, localhost or ::1), not "${host}".`,
      ),
    );
  }
  const sessions = new Map<string, StreamableHTTPServerTransport>();

  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    if (new URL(req.url ?? '/', 'http://localhost').pathname !== '/mcp')
      return send(res, 404, 'Use /mcp.');
    if (!isLocalRequest(req)) return send(res, 403, 'Only this machine may connect.');
    if (o.token && !tokenMatches(o.token, req.headers.authorization)) {
      return send(res, 401, 'Send the token as "Authorization: Bearer <QA_MCP_HTTP_TOKEN>".');
    }
    const sessionId = req.headers['mcp-session-id'];
    const existing = typeof sessionId === 'string' ? sessions.get(sessionId) : undefined;

    if (req.method !== 'POST') {
      if (!existing) return send(res, 400, 'Unknown or missing session.');
      return existing.handleRequest(req, res);
    }
    let body: unknown;
    try {
      body = await readJson(req);
    } catch (e) {
      return e instanceof Error && e.message === 'too-large'
        ? send(res, 413, 'The request is too large.')
        : send(res, 400, 'The request is not valid JSON.');
    }
    if (existing) return existing.handleRequest(req, res, body);
    if (!isInitializeRequest(body)) return send(res, 400, 'Start with an initialize request.');
    if (sessions.size >= MAX_SESSIONS) return send(res, 503, 'Too many open sessions.');

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        sessions.set(id, transport);
      },
    });
    transport.onclose = () => {
      if (transport.sessionId) sessions.delete(transport.sessionId);
    };
    // The SDK declares this transport's callbacks as accessors typed `T | undefined`, which `exactOptionalPropertyTypes`
    // reads as incompatible with the optional `Transport` members. It is the same object at run time.
    await o.createServer().connect(transport as Transport);
    return transport.handleRequest(req, res, body);
  };

  const server = createServer((req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) send(res, 500, 'Unexpected server error.');
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(o.port, host, () => resolve(server));
  });
}
