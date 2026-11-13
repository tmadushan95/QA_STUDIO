import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { isLoopbackHost, type SecurityOptions } from './security.js';

const TOKEN = 'correct-horse-battery-staple';
const app = (opts: SecurityOptions = {}) => createApp(undefined, {}, opts);
const cookieOf = (res: { headers: Record<string, unknown> }) =>
  String(res.headers['set-cookie']).split(';')[0]!;

describe('host and origin checks (always on)', () => {
  it('refuses unexpected Host headers, which is how DNS-rebinding attacks reach a local service', async () => {
    const a = app();
    for (const host of ['evil.example.com', 'localhost.evil.com', '10.0.0.5:4000']) {
      const res = await a.inject({ url: '/api/health', headers: { host } });
      expect(res.statusCode, host).toBe(421);
      expect(res.json().error.code).toBe('host-not-allowed');
    }
    for (const host of ['localhost:4000', '127.0.0.1:4000', '[::1]:4000', 'localhost']) {
      expect((await a.inject({ url: '/api/health', headers: { host } })).statusCode, host).toBe(
        200,
      );
    }
    expect(
      (
        await app({ allowedHosts: ['qa-tools.corp'] }).inject({
          url: '/api/health',
          headers: { host: 'qa-tools.corp:4000' },
        })
      ).statusCode,
    ).toBe(200);
  });

  it('refuses changes that come from another website, but allows this page and non-browser clients', async () => {
    const a = app();
    const post = (headers: Record<string, string>) =>
      a.inject({
        method: 'POST',
        url: '/api/auth/logout',
        headers: { host: 'localhost:4000', ...headers },
      });
    expect((await post({ origin: 'https://evil.example' })).statusCode).toBe(403);
    expect((await post({ origin: 'http://localhost:9999' })).statusCode).toBe(403); // another local site
    expect((await post({ 'sec-fetch-site': 'cross-site' })).statusCode).toBe(403);
    expect((await post({ origin: 'http://localhost:4000' })).statusCode).toBe(204); // this page
    expect((await post({})).statusCode).toBe(204); // curl, scripts, tests: no Origin header
    expect(
      (
        await app({ allowedOrigins: ['http://localhost:5173'] }).inject({
          method: 'POST',
          url: '/api/auth/logout',
          headers: { host: 'localhost:4000', origin: 'http://localhost:5173' },
        })
      ).statusCode,
    ).toBe(204);
  });

  it('does not apply to reading the built dashboard files', async () => {
    expect((await app().inject({ url: '/', headers: { host: 'localhost:4000' } })).statusCode).toBe(
      404,
    ); // nothing built, but not 421/401
  });
});

describe('access token (optional)', () => {
  const a = () => app({ adminToken: TOKEN });

  it('locks the API until you sign in, but leaves health and the sign-in endpoints open', async () => {
    const x = a();
    expect((await x.inject({ url: '/api/automation' })).statusCode).toBe(401);
    expect((await x.inject({ url: '/api/accounts' })).json().error.code).toBe('unauthorized');
    expect((await x.inject({ method: 'PUT', url: '/api/settings', payload: {} })).statusCode).toBe(
      401,
    );
    expect((await x.inject({ url: '/api/health' })).statusCode).toBe(200);
    expect((await x.inject({ url: '/api/auth/status' })).json()).toEqual({
      required: true,
      authenticated: false,
    });
  });

  it('signs in with the token and sets an HttpOnly, SameSite=Strict session cookie', async () => {
    const x = a();
    const bad = await x.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { token: 'nope' },
    });
    expect(bad.statusCode).toBe(401);
    expect(bad.json().error.code).toBe('wrong-token');
    const ok = await x.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { token: TOKEN },
    });
    expect(ok.statusCode).toBe(204);
    const header = String(ok.headers['set-cookie']);
    expect(header).toMatch(/HttpOnly/);
    expect(header).toMatch(/SameSite=Strict/);
    expect(header).not.toMatch(/Secure/);
    expect(header).not.toContain(TOKEN);
    const cookie = cookieOf(ok);
    expect((await x.inject({ url: '/api/auth/status', headers: { cookie } })).json()).toEqual({
      required: true,
      authenticated: true,
    });
    expect((await x.inject({ url: '/api/audit', headers: { cookie } })).statusCode).toBe(200);
  });

  it('marks the cookie Secure when asked, and accepts a Bearer token for scripts', async () => {
    const x = app({ adminToken: TOKEN, secureCookie: true });
    const ok = await x.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { token: TOKEN },
    });
    expect(String(ok.headers['set-cookie'])).toMatch(/; Secure/);
    expect(
      (await x.inject({ url: '/api/audit', headers: { authorization: `Bearer ${TOKEN}` } }))
        .statusCode,
    ).toBe(200);
    expect(
      (await x.inject({ url: '/api/audit', headers: { authorization: 'Bearer wrong' } }))
        .statusCode,
    ).toBe(401);
    expect(
      (await x.inject({ url: '/api/audit', headers: { cookie: 'qa_session=forged' } })).statusCode,
    ).toBe(401);
  });

  it('signing out ends the session', async () => {
    const x = a();
    const cookie = cookieOf(
      await x.inject({ method: 'POST', url: '/api/auth/login', payload: { token: TOKEN } }),
    );
    expect(
      (await x.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie } })).statusCode,
    ).toBe(204);
    expect((await x.inject({ url: '/api/audit', headers: { cookie } })).statusCode).toBe(401);
  });

  it('slows down guessing: too many attempts in a minute are refused, even with the right token', async () => {
    const x = a();
    for (let i = 0; i < 5; i++)
      await x.inject({ method: 'POST', url: '/api/auth/login', payload: { token: `guess-${i}` } });
    const blocked = await x.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { token: TOKEN },
    });
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().error.code).toBe('too-many-attempts');
  });

  it('without a token configured, the API is open to local use and sign-in is a no-op', async () => {
    const x = app();
    expect((await x.inject({ url: '/api/auth/status' })).json()).toEqual({
      required: false,
      authenticated: true,
    });
    expect(
      (await x.inject({ method: 'POST', url: '/api/auth/login', payload: { token: 'x' } }))
        .statusCode,
    ).toBe(204);
  });
});

describe('isLoopbackHost', () => {
  it('recognises loopback names only', () => {
    for (const h of ['127.0.0.1', 'localhost', '[::1]', '::1', 'LOCALHOST'])
      expect(isLoopbackHost(h), h).toBe(true);
    for (const h of ['0.0.0.0', '192.168.1.5', 'example.com', '::'])
      expect(isLoopbackHost(h), h).toBe(false);
  });
});

describe('unreadable requests', () => {
  it('answers malformed JSON and wrong content types with a 400, not a server error, and never echoes the input', async () => {
    const x = app({ adminToken: TOKEN });
    const bad = await x.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'content-type': 'application/json' },
      payload: '{"token": "hunter2-secret',
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe('bad-request');
    expect(bad.body).not.toContain('hunter2');
    const wrongType = await x.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'content-type': 'text/plain' },
      payload: 'token=x',
    });
    expect(wrongType.statusCode).toBeGreaterThanOrEqual(400); // a client error, whichever the framework picks
    expect(wrongType.statusCode).toBeLessThan(500);
  });
});
