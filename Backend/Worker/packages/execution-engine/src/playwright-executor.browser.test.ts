import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ActionRegistry,
  createStubApp,
  LEGACY_PAGES,
  registerAppActions,
  type Credentials,
  type StubApp,
} from '@qa-studio/automation-core';
import { createLogger, DEFAULT_SETTINGS, type AppSettings, type Scenario } from '@qa-studio/shared';
import { PlaywrightExecutor, RunManager, type AccountRef, type CaseJob } from './index.js';

const USERS = { alice: 'Alice-pw-123', bob: 'Bob-pw-456' };
const ACCOUNTS: Record<string, AccountRef & Credentials> = {
  a1: { id: 'a1', label: 'Alice (approver)', username: 'alice', password: USERS.alice },
  b1: { id: 'b1', label: 'Bob (requester)', username: 'bob', password: USERS.bob },
  bad: { id: 'bad', label: 'Wrong password', username: 'alice', password: 'Not-the-password-1' },
};

let app: StubApp;
let artifactsDir: string;
let settings: AppSettings;
const logs: string[] = [];
let executor: PlaywrightExecutor;

beforeAll(async () => {
  app = await createStubApp({ users: USERS, flow: 'form' });
  artifactsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'art-'));
  settings = {
    ...DEFAULT_SETTINGS,
    envName: 'qa',
    appUrl: app.url,
    headless: true,
    timeoutMs: 1500,
    login: { strategy: 'login-form', path: '/login', signedInMarker: 'Welcome back,' },
  };
  executor = new PlaywrightExecutor({
    getSettings: () => settings,
    getCredentials: (id) => ACCOUNTS[id],
    registry: registerAppActions(new ActionRegistry()),
    pages: LEGACY_PAGES,
    artifactsDir,
    log: createLogger((l) => logs.push(l)),
  });
}, 30_000);

afterAll(async () => {
  await executor.close();
  await app.close();
  fs.rmSync(artifactsDir, { recursive: true, force: true });
});

const scenario = (caseId: string, text: string): Scenario => ({
  schemaVersion: 1,
  caseId,
  steps: [
    { action: 'app.open', params: { path: '/projects' } },
    { action: 'assert.text-visible', params: { text } },
  ],
});
const job = (caseId: string, account: string | undefined, text: string): CaseJob => ({
  caseId,
  account: account ? { id: account, label: ACCOUNTS[account]!.label } : undefined,
  scenario: scenario(caseId, text),
});
const opts = { environment: 'qa', browser: 'chromium', workers: 4 };
const count = (list: string[], user: string) => list.filter((u) => u === user).length;

/** Read the files out of a .zip without extra dependencies (central directory + raw deflate). */
function zipEntries(file: string): Map<string, Buffer> {
  const buf = fs.readFileSync(file);
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  let p = buf.readUInt32LE(eocd + 16);
  const count = buf.readUInt16LE(eocd + 10);
  const out = new Map<string, Buffer>();
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const dataStart = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(dataStart, dataStart + csize);
    out.set(name, method === 8 ? zlib.inflateRawSync(raw) : raw);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

describe('executor with accounts', () => {
  it('opens a fresh browser per case, signs in as each chosen account, and records which account ran', async () => {
    const m = new RunManager(executor);
    const run = m.start(
      [
        job('TC-1', 'a1', 'Signed in as alice'),
        job('TC-1', 'b1', 'Signed in as bob'), // the same case, run as a second account
        job('TC-2', 'b1', 'Signed in as alice'), // fails: this browser is bob's
      ],
      { ...opts, mode: 'concurrent' },
    );
    const done = await m.whenDone(run.id)!;
    const by = Object.fromEntries(done.cases.map((c) => [`${c.caseId}/${c.account}`, c]));
    expect(by['TC-1/Alice (approver)']!.status).toBe('passed');
    expect(by['TC-1/Bob (requester)']!.status).toBe('passed');
    expect(by['TC-2/Bob (requester)']!.status).toBe('failed');
    expect(by['TC-2/Bob (requester)']!.failure).toMatchObject({
      kind: 'assertion',
      expected: 'Signed in as alice',
    });
    // sign-in is the first step, scenario steps follow it
    expect(by['TC-1/Alice (approver)']!.steps.map((s) => [s.index, s.action])).toEqual([
      [0, 'auth.sign-in'],
      [1, 'app.open'],
      [2, 'assert.text-visible'],
    ]);
    // evidence is kept apart per account
    expect(by['TC-2/Bob (requester)']!.artifacts[0]).toBe('TC-2--Bob__requester_/failure.png');
    expect(app.signIns.filter((u) => u === 'alice').length).toBeGreaterThanOrEqual(1);
    expect(app.signIns.filter((u) => u === 'bob').length).toBeGreaterThanOrEqual(2);
  }, 90_000);

  it('clean mode: signs each account in once, and every case still starts in a new signed-in window', async () => {
    const before = { alice: count(app.signIns, 'alice'), bob: count(app.signIns, 'bob') };
    const m = new RunManager(executor);
    const run = m.start(
      [
        job('CL-1', 'a1', 'Signed in as alice'),
        job('CL-1', 'b1', 'Signed in as bob'),
        job('CL-2', 'a1', 'Signed in as alice'),
        job('CL-3', 'a1', 'Signed in as bob'), // fails: the reused sign-in is alice's, never another account's
      ],
      { ...opts, workers: 1, mode: 'clean' },
    );
    const done = await m.whenDone(run.id)!;
    expect(done.cases.map((c) => c.status)).toEqual(['passed', 'passed', 'passed', 'failed']);
    expect(count(app.signIns, 'alice') - before.alice).toBe(1);
    expect(count(app.signIns, 'bob') - before.bob).toBe(1);
    // A reused sign-in is still reported as the first step, so results read the same in every mode.
    expect(done.cases[2]!.steps.map((s) => [s.index, s.action, s.status])).toEqual([
      [0, 'auth.sign-in', 'passed'],
      [1, 'app.open', 'passed'],
      [2, 'assert.text-visible', 'passed'],
    ]);
    // Evidence is still kept per case.
    expect(done.cases[3]!.artifacts).toContain('CL-3--Alice__approver_/failure.png');
  }, 90_000);

  it("shared mode: signs in once and runs the account's cases in the same window", async () => {
    const before = count(app.signIns, 'alice');
    const m = new RunManager(executor);
    const run = m.start(
      [
        job('SH-1', 'a1', 'Signed in as alice'),
        job('SH-2', 'a1', 'No such text'), // a failing case does not stop the next one reusing the window
        job('SH-3', 'a1', 'Signed in as alice'),
      ],
      { ...opts, workers: 1, mode: 'shared' },
    );
    const done = await m.whenDone(run.id)!;
    expect(done.cases.map((c) => c.status)).toEqual(['passed', 'failed', 'passed']);
    expect(count(app.signIns, 'alice') - before).toBe(1);
    expect(done.cases[1]!.artifacts.some((a) => a.endsWith('trace.zip'))).toBe(true);
  }, 90_000);

  it('never puts credentials into results, logs or traces', async () => {
    const m = new RunManager(executor);
    const run = m.start([job('TC-3', 'a1', 'No such text')], opts);
    const done = await m.whenDone(run.id)!;
    expect(done.cases[0]!.status).toBe('failed');
    const everything = JSON.stringify(done) + logs.join('\n');
    expect(everything).not.toContain(USERS.alice);
    expect(everything).not.toContain('"password"');
    const artifacts = done.cases[0]!.artifacts;
    const zip = artifacts.find((a) => a.endsWith('trace.zip'))!;
    const trace = [...zipEntries(path.join(artifactsDir, run.id, zip)).values()]
      .map((b) => b.toString('utf8'))
      .join('\n');
    expect(trace.length).toBeGreaterThan(1000);
    expect(trace).not.toContain(USERS.alice); // sign-in happened before tracing started
    // The page text captured at the failure is evidence too, and must be just as clean.
    const pageText = artifacts.find((a) => a.endsWith('failure-page.txt'))!;
    const page = fs.readFileSync(path.join(artifactsDir, run.id, pageText), 'utf8');
    expect(page).toMatch(/^URL: /);
    expect(page).not.toContain(USERS.alice);
  }, 60_000);

  it('blocks a case when sign-in fails, says why, and does not try that account again in the same run', async () => {
    const before = app.attempts.filter((u) => u === 'alice').length;
    const m = new RunManager(executor);
    const run = m.start(
      [job('TC-4', 'bad', 'x'), job('TC-5', 'bad', 'x'), job('TC-6', 'bad', 'x')],
      {
        ...opts,
        workers: 1,
      },
    );
    const done = await m.whenDone(run.id)!;
    expect(done.cases.map((c) => c.status)).toEqual(['blocked', 'blocked', 'blocked']);
    expect(done.cases[0]!.failure!.message).toMatch(/Could not sign in as "Wrong password"/);
    expect(done.cases[0]!.steps).toEqual([
      expect.objectContaining({ index: 0, action: 'auth.sign-in', status: 'failed' }),
    ]);
    expect(done.cases[0]!.artifacts).toEqual(['TC-4--Wrong_password/sign-in-failed.png']);
    expect(done.cases[1]!.failure!.message).toMatch(
      /earlier sign-in in this run failed.*avoids locking the account/,
    );
    // exactly one real attempt for three cases
    expect(app.attempts.filter((u) => u === 'alice').length - before).toBe(1);
    expect(JSON.stringify(done)).not.toContain('Not-the-password-1');
  }, 60_000);

  it('blocks with a clear message when no account is chosen or the password is missing', async () => {
    const m = new RunManager(executor);
    const run = m.start(
      [
        job('TC-7', undefined, 'x'),
        {
          caseId: 'TC-8',
          account: { id: 'ghost', label: 'Ghost' },
          scenario: scenario('TC-8', 'x'),
        },
      ],
      opts,
    );
    const done = await m.whenDone(run.id)!;
    expect(done.cases[0]!.failure!.message).toMatch(/No test account was chosen/);
    expect(done.cases[1]!.failure!.message).toMatch(
      /password for account "Ghost" is missing.*Settings/,
    );
  }, 30_000);

  it('needs no account when the app needs no sign-in', async () => {
    const open = await createStubApp({ users: {}, flow: 'none' });
    const prior = settings;
    settings = { ...settings, appUrl: open.url, login: { ...settings.login, strategy: 'none' } };
    try {
      const m = new RunManager(executor);
      const guest: CaseJob = {
        caseId: 'TC-9',
        scenario: {
          schemaVersion: 1,
          caseId: 'TC-9',
          steps: [
            { action: 'app.open', params: { path: '/dashboard' } },
            { action: 'assert.text-visible', params: { text: 'Welcome back, guest' } },
          ],
        },
      };
      const done = await m.whenDone(m.start([guest], opts).id)!;
      expect(done.cases[0]!.status).toBe('passed');
      expect(done.cases[0]!.steps.map((s) => s.action)).toEqual([
        'app.open',
        'assert.text-visible',
      ]); // no sign-in step
    } finally {
      settings = prior;
      await open.close();
    }
  }, 30_000);

  it('uses the settings as they are now: a change applies to the next case', async () => {
    const prior = settings;
    settings = { ...settings, appUrl: '' };
    try {
      const m = new RunManager(executor);
      const done = await m.whenDone(m.start([job('TC-10', 'a1', 'x')], opts).id)!;
      expect(done.cases[0]!.status).toBe('blocked');
    } finally {
      settings = prior;
    }
  }, 30_000);

  it('cancelling closes the browser and ends the case as cancelled', async () => {
    const m = new RunManager(executor);
    const slow: Scenario = {
      schemaVersion: 1,
      caseId: 'SLOW',
      steps: [
        { action: 'app.open', params: { path: '/projects' } },
        { action: 'assert.text-visible', params: { text: 'never shown' } },
      ],
    };
    const run = m.start(
      [{ caseId: 'SLOW', account: { id: 'a1', label: 'Alice (approver)' }, scenario: slow }],
      opts,
    );
    await new Promise((r) => setTimeout(r, 900));
    m.cancel(run.id);
    const done = await m.whenDone(run.id)!;
    expect(done.status).toBe('cancelled');
    expect(done.cases[0]!.status).toBe('cancelled');
  }, 60_000);

  it('"Test sign-in" reports success and failure without leaking the password', async () => {
    const ok = await executor.testSignIn(settings, ACCOUNTS['a1']!);
    expect(ok).toEqual({ ok: true, message: 'Signed in successfully.' });
    const bad = await executor.testSignIn(settings, ACCOUNTS['bad']!);
    expect(bad.ok).toBe(false);
    expect(bad.message).not.toContain('Not-the-password-1');
  }, 60_000);
});

describe('executor with saved sessions (SSO with a second factor)', () => {
  it('runs with the saved session of each account, and blocks an account that has none', async () => {
    // A session as "Sign in by hand" would keep it: sign in once, take the browser state.
    const { chromium } = await import('playwright');
    const b = await chromium.launch();
    const ctx = await b.newContext();
    const page = await ctx.newPage();
    await page.goto(`${app.url}/login`);
    await page.getByLabel('Username').fill('bob');
    await page.getByLabel('Password').fill(USERS.bob);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.getByText('Welcome back, bob').waitFor();
    const bobSession = JSON.stringify(await ctx.storageState());
    await b.close();

    const saved: AppSettings = {
      ...settings,
      timeoutMs: 3000,
      login: { ...settings.login, strategy: 'saved-session' },
    };
    const sessionExecutor = new PlaywrightExecutor({
      getSettings: () => saved,
      getCredentials: () => undefined, // passwords are not used at all with saved sessions
      getSession: (id) => (id === 'b1' ? bobSession : undefined),
      registry: registerAppActions(new ActionRegistry()),
      pages: LEGACY_PAGES,
      artifactsDir,
      log: createLogger(() => undefined),
    });
    try {
      const m = new RunManager(sessionExecutor);
      const run = m.start(
        [job('S-1', 'b1', 'Signed in as bob'), job('S-2', 'a1', 'Signed in as alice')],
        opts,
      );
      const done = await m.whenDone(run.id)!;
      expect(done.cases[0]!.status).toBe('passed');
      expect(done.cases[1]!.status).toBe('blocked');
      expect(done.cases[1]!.failure!.message).toMatch(/has no saved session.*Sign in by hand/);
      expect(JSON.stringify(done)).not.toContain('qa_user'); // the session never ends up in results
    } finally {
      await sessionExecutor.close();
    }
  }, 60_000);
});
