import type { FastifyInstance } from 'fastify';

/**
 * What changed, never the data itself: the dashboard refetches through the normal (authenticated) API.
 * - `run`: a run was created or moved on (`id`, `status`).
 * - `data`: something was saved, imported or deleted through the API (`path`).
 */
export type LiveEvent =
  | { type: 'run'; id: string; status: string }
  | { type: 'data'; path: string }
  /** An AI generation job started, moved on or finished. */
  | { type: 'job'; id: string; status: string };

type Listener = (e: LiveEvent) => void;

/** A tiny in-process publish/subscribe for live updates. A throwing listener never affects the others. */
export class EventBus {
  private readonly listeners = new Set<Listener>();

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }

  emit(e: LiveEvent): void {
    for (const fn of [...this.listeners]) {
      try {
        fn(e);
      } catch {
        /* a closed connection must not stop the update reaching the rest */
      }
    }
  }

  get size(): number {
    return this.listeners.size;
  }
}

const HEARTBEAT_MS = 15_000;
/** Cap so a forgotten tab or a loop cannot hold unlimited connections open. */
const MAX_CLIENTS = 50;

/**
 * Server-sent events at GET /api/events. Registered after the security hooks, so the Host check and the optional
 * access token apply exactly as for every other route.
 */
export function registerEvents(app: FastifyInstance, bus: EventBus): void {
  // Any successful change through the API tells open dashboards to refetch.
  app.addHook('onResponse', (req, reply, done) => {
    if (
      req.method !== 'GET' &&
      req.method !== 'HEAD' &&
      req.url.startsWith('/api/') &&
      reply.statusCode < 400
    ) {
      bus.emit({ type: 'data', path: req.url.split('?')[0] ?? req.url });
    }
    done();
  });

  app.get('/api/events', (req, reply) => {
    if (bus.size >= MAX_CLIENTS) {
      return reply.code(503).send({
        error: { code: 'too-many-streams', message: 'Too many live connections are open.' },
      });
    }
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 3000\n\n: connected\n\n');

    const unsubscribe = bus.subscribe((e) => {
      res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
    });
    const beat = setInterval(() => res.write(': keep-alive\n\n'), HEARTBEAT_MS);
    const done = () => {
      clearInterval(beat);
      unsubscribe();
    };
    res.on('close', done);
    res.on('error', done);
  });
}
