import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AccountService } from './accounts.js';
import { createApp } from './app.js';
import { HttpError } from './errors.js';
import { SecretBox } from './secrets.js';
import { SqliteStorage } from './sqlite-storage.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function make(
  opts: {
    file?: string;
    key?: Buffer;
    tester?: () => Promise<{ ok: boolean; message: string }>;
  } = {},
) {
  const storage = new SqliteStorage(opts.file ?? ':memory:');
  const box = new SecretBox(opts.key ?? crypto.randomBytes(32));
  const service = new AccountService({
    store: storage,
    box,
    audit: (a, t, d) => storage.addAudit(a, t, d),
    tester: opts.tester ?? (async () => ({ ok: true, message: 'Signed in successfully.' })),
  });
  return { storage, box, service };
}
const errorOf = (fn: () => unknown): HttpError => {
  try {
    fn();
  } catch (e) {
    return e as HttpError;
  }
  throw new Error('expected an error');
};

describe('AccountService', () => {
  it('creates an account and never returns the password', () => {
    const { service } = make();
    const a = service.create({
      projectId: 1,
      label: 'QA approver',
      username: 'approver@example.com',
      password: 'Sup3r-secret!',
    });
    expect(a).toEqual({
      id: expect.any(String),
      projectId: 1,
      label: 'QA approver',
      username: 'approver@example.com',
      hasPassword: true,
    });
    expect(JSON.stringify(service.list())).not.toContain('Sup3r-secret');
    expect(Object.keys(a)).not.toContain('password');
  });

  it('validates input and reports each field', () => {
    const { service } = make();
    const e = errorOf(() =>
      service.create({ projectId: 1, label: ' ', username: '', password: '' }),
    );
    expect(e.status).toBe(400);
    expect(e.fields).toEqual({
      label: 'Enter a name for this account.',
      username: 'Enter the username.',
      password: 'Enter the password.',
    });
  });

  it('keeps names unique, ignoring case, but lets an account keep its own name', () => {
    const { service } = make();
    const a = service.create({ projectId: 1, label: 'Approver', username: 'a', password: 'p1' });
    const e = errorOf(() =>
      service.create({ projectId: 1, label: 'approver', username: 'b', password: 'p2' }),
    );
    expect(e).toMatchObject({ status: 409, code: 'duplicate-label' });
    expect(service.update(a.id, { label: 'Approver', username: 'a2' }).username).toBe('a2');
  });

  it('keeps the saved password when none is sent, and changes it when one is', () => {
    const { service } = make();
    const a = service.create({ projectId: 1, label: 'A', username: 'u', password: 'first-pw' });
    service.update(a.id, { label: 'Renamed', password: '' });
    expect(service.credentials(a.id)).toEqual({ username: 'u', password: 'first-pw' });
    service.update(a.id, { password: 'second-pw' });
    expect(service.credentials(a.id)?.password).toBe('second-pw');
  });

  it('removes accounts, and unknown ids are errors, not silent drops', () => {
    const { service } = make();
    const a = service.create({ projectId: 1, label: 'A', username: 'u', password: 'p' });
    expect(service.refs([a.id])).toEqual([{ id: a.id, projectId: 1, label: 'A' }]);
    service.remove(a.id);
    expect(errorOf(() => service.refs([a.id])).status).toBe(404);
    expect(errorOf(() => service.remove(a.id)).status).toBe(404);
    expect(errorOf(() => service.update('nope', {})).status).toBe(404);
  });

  it('flags an account whose password can no longer be decrypted (for example a lost key)', async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'acct-')), 'a.db');
    dirs.push(path.dirname(file));
    const first = make({ file });
    first.service.create({ projectId: 1, label: 'A', username: 'u', password: 'p' });
    first.storage.close();
    const second = make({ file, key: crypto.randomBytes(32) });
    expect(second.service.list()[0]).toMatchObject({ label: 'A', hasPassword: false });
    expect(second.service.credentials(second.service.list()[0]!.id)).toBeUndefined();
    await expect(second.service.test(second.service.list()[0]!.id)).rejects.toMatchObject({
      status: 409,
      code: 'password-missing',
    });
    second.storage.close();
  });

  it('never writes the plain password to the database file, the audit trail or the write-ahead log', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'acct-')), 'a.db');
    dirs.push(path.dirname(file));
    const { storage, service } = make({ file });
    const a = service.create({
      projectId: 1,
      label: 'Approver',
      username: 'approver-user',
      password: 'Plain-Text-Pw-9000',
    });
    service.update(a.id, { password: 'Another-Plain-Pw-7000' });
    const audit = JSON.stringify(storage.listAudit());
    expect(audit).not.toMatch(/Plain-Text-Pw|Another-Plain-Pw/);
    expect(audit).toContain('Changed: password.');
    storage.close();
    for (const f of fs.readdirSync(path.dirname(file))) {
      const bytes = fs.readFileSync(path.join(path.dirname(file), f)).toString('latin1');
      expect(bytes, f).not.toContain('Plain-Text-Pw-9000');
      expect(bytes, f).not.toContain('Another-Plain-Pw-7000');
    }
  });

  it('records changes in the audit trail without secrets', () => {
    const { storage, service } = make();
    const a = service.create({ projectId: 1, label: 'Approver', username: 'u', password: 'p-1' });
    service.update(a.id, { username: 'u2' });
    service.remove(a.id);
    expect(storage.listAudit().map((r) => `${r.action}:${r.target}`)).toEqual([
      'account.delete:Approver',
      'account.update:Approver',
      'account.create:Approver',
    ]);
  });

  it('tests a sign-in one at a time and records the outcome', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { storage, service } = make({
      tester: async () => (await gate, { ok: false, message: 'Wrong password.' }),
    });
    const a = service.create({ projectId: 1, label: 'A', username: 'u', password: 'p' });
    const first = service.test(a.id);
    const second = await service.test(a.id).catch((e: HttpError) => e);
    expect(second).toMatchObject({ status: 409, code: 'test-in-progress' });
    release();
    expect(await first).toEqual({ ok: false, message: 'Wrong password.' });
    expect(storage.listAudit()[0]).toMatchObject({
      action: 'account.test',
      detail: 'Sign-in test failed.',
    });
    await expect(service.test(a.id)).resolves.toBeDefined(); // free again after it finishes
  });
});

describe('accounts API', () => {
  const setup = () => {
    const { service, storage } = make();
    const app = createApp(undefined, {
      accounts: service,
      audit: { list: (n) => storage.listAudit(n) },
    });
    return { app, service };
  };
  const post = (
    app: ReturnType<typeof createApp>,
    url: string,
    payload: unknown,
    method: 'POST' | 'PUT' = 'POST',
  ) => app.inject({ method, url, payload: payload as object });

  it('creates, lists, edits and deletes accounts, and no response ever contains a password', async () => {
    const { app } = setup();
    const created = await post(app, '/api/accounts', {
      projectId: 1,
      label: 'Approver',
      username: 'u',
      password: 'Very-Secret-1',
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().id;
    const updated = await post(
      app,
      `/api/accounts/${id}`,
      { username: 'u2', password: 'Very-Secret-2' },
      'PUT',
    );
    const list = await app.inject({ url: '/api/accounts' });
    const del = await app.inject({ method: 'DELETE', url: `/api/accounts/${id}` });
    for (const res of [created, updated, list]) expect(res.body).not.toMatch(/Very-Secret/);
    expect(updated.json()).toMatchObject({ username: 'u2', hasPassword: true });
    expect(list.json().items).toHaveLength(1);
    expect(del.statusCode).toBe(204);
    expect((await app.inject({ url: '/api/accounts' })).json().items).toEqual([]);
  });

  it('answers bad input with a message and per-field errors, and does not echo the submitted password', async () => {
    const { app } = setup();
    const res = await post(app, '/api/accounts', {
      projectId: 1,
      label: '',
      username: 'u',
      password: 'Echoed-Secret',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatchObject({
      code: 'invalid-account',
      fields: { label: 'Enter a name for this account.' },
    });
    expect(res.body).not.toContain('Echoed-Secret');
    const dup = await post(app, '/api/accounts', {
      projectId: 1,
      label: 'A',
      username: 'u',
      password: 'p',
    });
    expect(dup.statusCode).toBe(201);
    expect(
      (await post(app, '/api/accounts', { projectId: 1, label: 'a', username: 'u', password: 'p' }))
        .statusCode,
    ).toBe(409);
  });

  it('tests a sign-in through the API, and 404s for unknown accounts', async () => {
    const { app } = setup();
    const id = (
      await post(app, '/api/accounts', { projectId: 1, label: 'A', username: 'u', password: 'p' })
    ).json().id;
    expect((await post(app, `/api/accounts/${id}/test`, {})).json()).toEqual({
      ok: true,
      message: 'Signed in successfully.',
    });
    expect((await post(app, '/api/accounts/nope/test', {})).statusCode).toBe(404);
  });

  it('lists the audit trail', async () => {
    const { app } = setup();
    await post(app, '/api/accounts', { projectId: 1, label: 'A', username: 'u', password: 'p' });
    const audit = (await app.inject({ url: '/api/audit' })).json().items;
    expect(audit[0]).toMatchObject({ action: 'account.create', target: 'A' });
    expect(JSON.stringify(audit)).not.toContain('"p"');
  });
});
