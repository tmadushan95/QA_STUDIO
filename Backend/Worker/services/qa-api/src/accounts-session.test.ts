import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { AccountService } from './accounts.js';
import { createApp } from './app.js';
import { SecretBox } from './secrets.js';
import { SqliteStorage } from './sqlite-storage.js';

const SESSION = JSON.stringify({
  cookies: [{ name: 'auth', value: 'very-secret-token-123' }],
  origins: [],
});

function setup(opts: { saved?: boolean; capture?: () => Promise<string> } = {}) {
  const storage = new SqliteStorage(':memory:');
  const audit: string[] = [];
  const tested: { session?: string | undefined }[] = [];
  const accounts = new AccountService({
    store: storage,
    box: new SecretBox(crypto.randomBytes(32)),
    audit: (a, t, d) => audit.push(`${a}|${t}|${d}`),
    tester: async (_creds, session) => (
      tested.push({ session }), { ok: true, message: 'Signed in successfully.' }
    ),
    capturer: opts.capture ?? (async () => SESSION),
    usesSavedSession: () => opts.saved ?? true,
  });
  const app = createApp(undefined, { accounts });
  const a = accounts.create({
    projectId: 1,
    label: 'Dev boss',
    username: 'boss@example.com',
    password: 'Pw-123456',
  });
  return { app, accounts, storage, audit, tested, id: a.id };
}

describe('saved sessions for SSO accounts', () => {
  it('saves the session from signing in by hand, encrypted, and only says when it was saved', async () => {
    const { app, storage, audit, id } = setup();
    const r = await app.inject({ method: 'POST', url: `/api/accounts/${id}/session` });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ label: 'Dev boss', sessionSavedAt: expect.any(String) });
    expect(r.body).not.toContain('very-secret-token-123');
    const list = await app.inject({ url: '/api/accounts' });
    expect(list.body).not.toContain('very-secret-token-123');
    expect(list.json().items[0].sessionSavedAt).toBeTruthy();
    const stored = storage.loadSession(id)!;
    expect(stored.stateEnc).not.toContain('very-secret-token-123');
    expect(audit.join('\n')).not.toContain('very-secret-token-123');
    expect(audit).toContain('account.session|Dev boss|Signed in by hand; session saved.');
  });

  it('tests the saved session instead of the password, and asks for one when there is none', async () => {
    const { app, accounts, tested, id } = setup();
    const none = await app.inject({ method: 'POST', url: `/api/accounts/${id}/test` });
    expect(none.statusCode).toBe(409);
    expect(none.json().error.message).toContain('Use "Sign in by hand" first');
    await accounts.captureSession(id);
    const ok = await app.inject({ method: 'POST', url: `/api/accounts/${id}/test` });
    expect(ok.json()).toEqual({ ok: true, message: 'Signed in successfully.' });
    expect(tested[0]!.session).toBe(SESSION);
  });

  it('forgets a session on request, and with the account', async () => {
    const { app, accounts, storage, id } = setup();
    await accounts.captureSession(id);
    const r = await app.inject({ method: 'DELETE', url: `/api/accounts/${id}/session` });
    expect(r.json().sessionSavedAt).toBeUndefined();
    await accounts.captureSession(id);
    await app.inject({ method: 'DELETE', url: `/api/accounts/${id}` });
    expect(storage.loadSession(id)).toBeUndefined();
  });

  it('reports a sign-in that did not finish, and allows only one at a time', async () => {
    let release!: () => void;
    const slow = setup({
      capture: () =>
        new Promise(
          (_r, reject) =>
            (release = () => reject(new Error('Sign-in by hand did not finish within 5 minutes.'))),
        ),
    });
    const first = slow.app.inject({ method: 'POST', url: `/api/accounts/${slow.id}/session` });
    await new Promise((r) => setTimeout(r, 20));
    const second = await slow.app.inject({
      method: 'POST',
      url: `/api/accounts/${slow.id}/session`,
    });
    expect(second.statusCode).toBe(409);
    release();
    const r = await first;
    expect(r.statusCode).toBe(500);
    expect(slow.storage.loadSession(slow.id)).toBeUndefined();
  });
});
