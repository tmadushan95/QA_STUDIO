import crypto from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

export interface SecurityOptions {
  /** When set, every /api request needs it (as a session cookie after sign-in, or a Bearer header for scripts). */
  adminToken?: string | undefined;
  /** Extra Host names the API may be reached by (QA_ALLOWED_HOSTS). localhost and loopback are always allowed. */
  allowedHosts?: string[];
  /** Extra browser Origins allowed to make changes (QA_ALLOWED_ORIGINS). The page's own origin is always allowed. */
  allowedOrigins?: string[];
  /** Mark the session cookie Secure. Set when the API is served over HTTPS. */
  secureCookie?: boolean;
}

const COOKIE = 'qa_session';
const SESSION_SECONDS = 12 * 60 * 60;
const LOGIN_WINDOW_MS = 60_000;
const LOGIN_MAX_ATTEMPTS = 5;
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

const sha = (s: string) => crypto.createHash('sha256').update(s).digest();
export const tokenMatches = (given: string, expected: string) =>
  crypto.timingSafeEqual(sha(given), sha(expected));

export function isLoopbackHost(host: string): boolean {
  return LOOPBACK.has(host.toLowerCase()) || host === '::1';
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function deny(reply: FastifyReply, status: number, code: string, message: string) {
  return reply.code(status).send({ error: { code, message } });
}

/**
 * Protect the API. Always on: the Host header must be a name we expect (stops DNS rebinding), and browser requests
 * that change anything must come from this page's own origin (stops other websites driving the API through the
 * user's browser). Optional: an access token, exchanged for an HttpOnly session cookie.
 */
export function registerSecurity(app: FastifyInstance, opts: SecurityOptions = {}): void {
  const hosts = new Set((opts.allowedHosts ?? []).map((h) => h.toLowerCase()));
  const origins = new Set((opts.allowedOrigins ?? []).map((o) => o.toLowerCase()));
  const sessions = new Map<string, number>();
  let attempts: number[] = [];

  const hostName = (req: FastifyRequest) =>
    (req.headers.host ?? '').replace(/:\d+$/, '').toLowerCase();

  const authenticated = (req: FastifyRequest): boolean => {
    if (!opts.adminToken) return true;
    const bearer = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? '')?.[1];
    if (bearer && tokenMatches(bearer, opts.adminToken)) return true;
    const sid = parseCookies(req.headers.cookie)[COOKIE];
    const expires = sid ? sessions.get(sid) : undefined;
    if (sid && expires !== undefined) {
      if (expires > Date.now()) return true;
      sessions.delete(sid);
    }
    return false;
  };

  app.addHook('onRequest', async (req, reply) => {
    const host = hostName(req);
    if (!isLoopbackHost(host) && !hosts.has(host)) {
      return deny(
        reply,
        421,
        'host-not-allowed',
        'This address is not allowed. Open the app at http://localhost or its configured address.',
      );
    }
    const url = req.url.split('?')[0] ?? '';
    if (!url.startsWith('/api/')) return; // the built dashboard files are public; the API behind them is not
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const origin = req.headers.origin?.toLowerCase();
      const sameOrigin =
        origin !== undefined &&
        (origin === `http://${req.headers.host}` || origin === `https://${req.headers.host}`);
      if (origin !== undefined && !sameOrigin && !origins.has(origin)) {
        return deny(
          reply,
          403,
          'origin-not-allowed',
          'Changes can only be made from this app, not from another website.',
        );
      }
      if (req.headers['sec-fetch-site'] === 'cross-site') {
        return deny(
          reply,
          403,
          'origin-not-allowed',
          'Changes can only be made from this app, not from another website.',
        );
      }
    }
    if (url === '/api/health' || url.startsWith('/api/auth/')) return;
    if (!authenticated(req))
      return deny(reply, 401, 'unauthorized', 'Sign in with the access token to continue.');
  });

  app.get('/api/auth/status', (req) => ({
    required: Boolean(opts.adminToken),
    authenticated: authenticated(req),
  }));

  const Login = z.object({ token: z.string().min(1).max(500) });
  app.post('/api/auth/login', (req, reply) => {
    if (!opts.adminToken) return reply.code(204).send();
    const now = Date.now();
    attempts = attempts.filter((t) => now - t < LOGIN_WINDOW_MS);
    if (attempts.length >= LOGIN_MAX_ATTEMPTS) {
      return deny(
        reply,
        429,
        'too-many-attempts',
        'Too many sign-in attempts. Wait a minute and try again.',
      );
    }
    attempts.push(now);
    const body = Login.safeParse(req.body);
    if (!body.success || !tokenMatches(body.data.token, opts.adminToken)) {
      return deny(reply, 401, 'wrong-token', 'That access token is not right.');
    }
    const sid = crypto.randomBytes(32).toString('base64url');
    sessions.set(sid, now + SESSION_SECONDS * 1000);
    return reply
      .header(
        'Set-Cookie',
        `${COOKIE}=${sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_SECONDS}${opts.secureCookie ? '; Secure' : ''}`,
      )
      .code(204)
      .send();
  });

  app.post('/api/auth/logout', (req, reply) => {
    const sid = parseCookies(req.headers.cookie)[COOKIE];
    if (sid) sessions.delete(sid);
    return reply
      .header('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`)
      .code(204)
      .send();
  });
}
