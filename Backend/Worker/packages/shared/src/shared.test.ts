import { describe, expect, it } from 'vitest';
import {
  allowedEnvsFromEnv,
  ConfigError,
  createLogger,
  mergeSettings,
  parseSettings,
  redact,
  settingsFromEnv,
  TestCase,
} from './index.js';

const good = {
  envName: 'qa',
  appUrl: 'https://app-qa.example.invalid/',
  browser: 'chromium',
  headless: false,
  slowMoMs: 0,
  workers: 2,
  timeoutMs: 60000,
  login: { strategy: 'login-form', path: '/login', signedInMarker: 'Welcome back,' },
};
const issuesOf = (raw: unknown, envs?: string[]) => {
  try {
    parseSettings(raw, envs);
    return [];
  } catch (e) {
    return e instanceof ConfigError ? e.issues : [{ path: '?', message: String(e) }];
  }
};

describe('parseSettings', () => {
  it('normalizes a valid settings object', () => {
    expect(parseSettings({ ...good, envName: 'QA' })).toEqual({
      ...good,
      appUrl: 'https://app-qa.example.invalid',
    });
  });

  it('reports every problem against its field, in plain language', () => {
    const issues = issuesOf({
      ...good,
      appUrl: 'not a url',
      workers: 99,
      slowMoMs: -1,
      browser: 'ie',
      login: { strategy: 'magic', path: 'login', signedInMarker: 'x'.repeat(201) },
    });
    expect(Object.fromEntries(issues.map((i) => [i.path, i.message]))).toMatchObject({
      appUrl: expect.stringContaining('full address'),
      workers: 'Use 16 or fewer.',
      slowMoMs: 'Use 0 or more.',
      browser: expect.stringContaining('chromium'),
      'login.strategy': expect.stringContaining('sign-in method'),
      'login.path': expect.stringContaining('same site'),
      'login.signedInMarker': expect.stringContaining('200 characters'),
    });
  });

  it('accepts an empty signed-in text (then leaving the login page counts as signed in), and the saved-session method', () => {
    expect(
      issuesOf({
        ...good,
        login: { strategy: 'saved-session', path: '/login', signedInMarker: '' },
      }),
    ).toEqual([]);
  });

  it('refuses environments that are not on the allow-list', () => {
    expect(issuesOf({ ...good, envName: 'prod' })).toEqual([
      { path: 'envName', message: expect.stringContaining('not an allowed environment') },
    ]);
    expect(issuesOf({ ...good, envName: 'sandbox' }, ['sandbox'])).toEqual([]);
  });

  it('refuses production-looking hosts, credentials in the address, and non-web schemes', () => {
    expect(issuesOf({ ...good, appUrl: 'https://app.prod.example.com' })[0]).toMatchObject({
      path: 'appUrl',
      message: expect.stringContaining('production'),
    });
    const creds = issuesOf({ ...good, appUrl: 'https://user:pw@app-qa.example.com' })[0]!;
    expect(creds.message).toMatch(/Do not put a username or password/);
    expect(creds.message).not.toContain('pw');
    expect(issuesOf({ ...good, appUrl: 'ftp://app-qa.example.com' })[0]).toMatchObject({
      message: 'Use an http or https address.',
    });
  });

  it('rejects login paths that leave the site', () => {
    for (const path of ['//evil.example/login', 'https://evil.example', 'login', '/a b']) {
      expect(
        issuesOf({ ...good, login: { ...good.login, path } }).map((i) => i.path),
        path,
      ).toContain('login.path');
    }
  });
});

describe('environment defaults and merging', () => {
  it('reads valid values from the environment and ignores unreadable ones', () => {
    const s = settingsFromEnv({
      QA_ENV_NAME: 'QA',
      QA_BASE_URL: 'http://localhost:3000',
      QA_BROWSER: 'firefox',
      QA_HEADLESS: 'true',
      QA_WORKERS: '3',
      QA_TIMEOUT_MS: 'soon',
      QA_LOGIN_STRATEGY: 'login-form',
      QA_LOGIN_PATH: '/signin',
      QA_API_BASE_URL: 'https://localhost:7264',
    });
    expect(s).toEqual({
      envName: 'qa',
      appUrl: 'http://localhost:3000',
      browser: 'firefox',
      headless: true,
      workers: 3,
      login: { strategy: 'login-form', path: '/signin' },
    });
    expect(settingsFromEnv({})).toEqual({});
  });

  it('layers defaults, environment, then saved values, with the saved values winning', () => {
    const m = mergeSettings(
      { envName: 'qa', workers: 3, login: { path: '/signin' } },
      { workers: 5, login: { signedInMarker: 'Hi' } },
    );
    expect(m).toMatchObject({
      envName: 'qa',
      workers: 5,
      headless: false,
      slowMoMs: 0,
      login: { strategy: 'microsoft-sso', path: '/signin', signedInMarker: 'Hi' },
    });
  });

  it('allowed environments come only from the environment variable', () => {
    expect(allowedEnvsFromEnv({})).toEqual(['dev', 'qa', 'uat', 'staging']);
    expect(allowedEnvsFromEnv({ QA_ALLOWED_ENVS: ' QA , dev ' })).toEqual(['qa', 'dev']);
  });
});
describe('redact / logger', () => {
  it('masks sensitive keys and bearer tokens', () => {
    const out = redact({
      user: 'a',
      password: 'x',
      headers: { Authorization: 'Bearer abc.def' },
      note: 'Bearer zzz',
    });
    expect(JSON.stringify(out)).not.toMatch(/abc\.def|zzz|"x"/);
    expect(out).toMatchObject({ user: 'a', password: '[REDACTED]' });
  });
  it('does not mask harmless keys that merely start with pass', () => {
    const out = redact({
      passed: 3,
      passRate: 0.5,
      password: 'x',
      passwd: 'y',
      passphrase: 'z',
      pass: 'w',
      userPassword: 'v',
    });
    expect(out).toEqual({
      passed: 3,
      passRate: 0.5,
      password: '[REDACTED]',
      passwd: '[REDACTED]',
      passphrase: '[REDACTED]',
      pass: '[REDACTED]',
      userPassword: '[REDACTED]',
    });
  });
  it('keeps objects that are shared between branches, and only collapses true cycles', () => {
    const failure = { kind: 'assertion', message: 'x' };
    const out = redact({ step: { failure }, case: { failure } });
    expect(out).toEqual({ step: { failure }, case: { failure } });
  });
  it('handles circular structures', () => {
    const a: Record<string, unknown> = {};
    a['self'] = a;
    expect(() => redact(a)).not.toThrow();
  });
  it('logger redacts context and honours level', () => {
    const lines: string[] = [];
    const log = createLogger((l) => lines.push(l), 'info').child({ run: 'r1' });
    log.debug('hidden');
    log.info('hi', { token: 'secret-value' });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('"run":"r1"');
    expect(lines[0]).not.toContain('secret-value');
  });
});

describe('TestCase schema', () => {
  const valid = {
    schemaVersion: 1,
    id: 'TC-1',
    title: 'Login',
    steps: [{ order: 1, action: 'Open login' }],
    source: { workbook: 'a.xlsx', worksheet: 'Sheet1', rowNumber: 2 },
  };
  it('accepts a case with no expected result and does not invent one', () => {
    const tc = TestCase.parse(valid);
    expect(tc.expectedResult).toBeUndefined();
    expect(tc.readiness).toBe('needs-clarification');
  });
  it('requires traceability', () => {
    expect(
      TestCase.safeParse({ ...valid, source: { workbook: 'a.xlsx', worksheet: 'S' } }).success,
    ).toBe(false);
  });
});
