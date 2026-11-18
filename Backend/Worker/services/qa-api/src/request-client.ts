import { AsyncLocalStorage } from 'node:async_hooks';
import type { FastifyInstance } from 'fastify';

/** Header an assistant's client (the MCP server) sends, such as `mcp/0.2.0`. The .NET API forwards it unchanged. */
export const CLIENT_HEADER = 'x-qa-client';
/** A short product name with an optional version; anything else is ignored rather than written to the audit trail. */
const CLIENT = /^([a-z][a-z0-9-]{0,19})(\/[0-9A-Za-z.+-]{1,20})?$/;

const current = new AsyncLocalStorage<string>();

/** The client name a request says it came from (`mcp`), or undefined for the web app and anything unrecognised. */
export function clientOf(header: unknown): string | undefined {
  return typeof header === 'string' ? CLIENT.exec(header.trim())?.[1] : undefined;
}

/**
 * Remembers, for everything a request does (including work it starts in the background), which client sent it, so
 * audit entries can say a change came from an assistant.
 */
export function registerRequestClient(app: FastifyInstance): void {
  app.addHook('onRequest', (req, _reply, done) => {
    const client = clientOf(req.headers[CLIENT_HEADER]);
    if (client) current.run(client, done);
    else done();
  });
}

/** An audit detail marked with the client that caused it: `Test case created. (via mcp)`. */
export function withClient(detail: string): string {
  const client = current.getStore();
  return client ? `${detail} (via ${client})` : detail;
}
