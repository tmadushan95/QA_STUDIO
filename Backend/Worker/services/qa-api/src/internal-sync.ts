/**
 * Routes the .NET API calls when something the worker holds a copy of changes outside it. Open pages also get their
 * live "refresh" from here, because the worker owns the event stream.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { TestCase } from '@qa-studio/shared';
import { HttpError } from './errors.js';
import type { EventBus } from './events.js';
import { tokenMatches } from './security.js';
import type { MemoryStore } from './store.js';

const ConfigChanged = z.object({ key: z.string().min(1).max(200), value: z.unknown() });

const TestCasesChanged = z.object({
  upserted: z.array(TestCase),
  deleted: z.array(z.string()),
});

export function registerInternalSync(
  app: FastifyInstance,
  o: {
    token: string;
    store: MemoryStore;
    events: EventBus;
    /** Where configuration blocks the API owns are kept in memory. */
    config?: { applyRemoteConfig(key: string, value: unknown): void };
  },
): void {
  // /internal is outside the /api checks in security.ts, so this secret is the only thing guarding these routes.
  const guard = (req: FastifyRequest) => {
    const given = req.headers['x-qa-internal-token'];
    if (typeof given !== 'string' || !tokenMatches(given, o.token)) {
      throw new HttpError(401, 'unauthorized', 'Internal route.');
    }
  };

  app.post('/internal/sync/test-cases', (req, reply) => {
    guard(req);
    const { upserted, deleted } = TestCasesChanged.parse(req.body);
    o.store.applyRemote(upserted, deleted);
    // The path /api/inventory is what the knowledge index's reindex trigger watches.
    o.events.emit({ type: 'data', path: '/api/inventory' });
    return reply.code(204).send();
  });

  // A configuration block the API owns changed (for example the page list). Take the new value and let open pages refresh.
  app.post('/internal/sync/config', (req, reply) => {
    guard(req);
    const { key, value } = ConfigChanged.parse(req.body);
    o.config?.applyRemoteConfig(key, value);
    o.events.emit({ type: 'data', path: `/api/${key.split(':')[0] ?? key}` });
    return reply.code(204).send();
  });

  app.post('/internal/sync/master-data', (req, reply) => {
    guard(req);
    o.events.emit({ type: 'data', path: '/api/projects' });
    return reply.code(204).send();
  });
}

const AiSuggest = z.object({
  title: z.string().max(500).default(''),
  steps: z.array(z.string().max(1000)).max(200).default([]),
  names: z.array(z.string().max(100)).min(1).max(200),
});

/**
 * The API asks here for the AI's values when it fills a case's parameters (the AI is only reachable from the worker). Any
 * failure, or an AI that is off, answers "no values": the API then guesses from the names, so this never fails a save.
 */
export function registerParameterAi(
  app: FastifyInstance,
  o: {
    token: string;
    suggest(input: {
      title: string;
      steps: string[];
      names: string[];
    }): Promise<Record<string, string>>;
  },
): void {
  app.post('/internal/parameters/ai-suggest', async (req) => {
    const given = req.headers['x-qa-internal-token'];
    if (typeof given !== 'string' || !tokenMatches(given, o.token)) {
      throw new HttpError(401, 'unauthorized', 'Internal route.');
    }
    const input = AiSuggest.parse(req.body);
    try {
      return { values: await o.suggest(input) };
    } catch {
      return { values: {} };
    }
  });
}
