import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import type { HttpError } from './errors.js';
import { SettingsService } from './settings-service.js';

const info = {
  paths: { database: '/d.db', artifacts: '/a', scenarios: '/s', dashboard: null },
  runtime: { node: 'v24', platform: 'win32', frameworkVersion: '0.1.0' },
  security: { accessTokenRequired: false, listening: '127.0.0.1:4000' },
};

function make(env: Record<string, string> = {}, initial?: unknown) {
  let saved: unknown = initial;
  const audit: string[] = [];
  const service = new SettingsService({
    store: { loadSettings: () => saved, saveSettings: (s) => (saved = s) },
    env,
    audit: (a, t, d) => audit.push(`${a}|${t}|${d}`),
    info,
  });
  return { service, audit, saved: () => saved };
}
const errorOf = (fn: () => unknown): HttpError => {
  try {
    fn();
  } catch (e) {
    return e as HttpError;
  }
  throw new Error('expected an error');
};

describe('SettingsService', () => {
  it('starts unavailable with a plain next step when nothing is configured', () => {
    const { service } = make();
    expect(service.availability()).toEqual({
      available: false,
      reason: 'Enter the app address and choose an environment in Settings, then try again.',
    });
    expect(service.view()).toMatchObject({
      available: false,
      source: 'defaults',
      loginRequired: true,
    });
    expect(service.view().values).toMatchObject({
      browser: 'chromium',
      headless: false,
      login: { strategy: 'microsoft-sso' },
    });
  });

  it('takes first values from .env, and saved values win over them', () => {
    const { service } = make({
      QA_ENV_NAME: 'qa',
      QA_BASE_URL: 'http://localhost:3000',
      QA_API_BASE_URL: 'https://ignored:7264',
    });
    expect(service.view()).toMatchObject({ available: true, source: 'environment' });
    expect(service.current()).toMatchObject({ envName: 'qa', appUrl: 'http://localhost:3000' });
    service.update({ appUrl: 'https://app-qa.example.com/' });
    expect(service.current().appUrl).toBe('https://app-qa.example.com');
    expect(service.view().source).toBe('saved');
    expect(JSON.stringify(service.view())).not.toContain('ignored'); // no API address anywhere
  });

  it('saves a valid change, applies it at once, and audits the field names only', () => {
    const { service, audit, saved } = make({
      QA_ENV_NAME: 'qa',
      QA_BASE_URL: 'http://localhost:3000',
    });
    const view = service.update({
      headless: false,
      workers: 3,
      slowMoMs: 250,
      login: { strategy: 'login-form', path: '/signin' },
    });
    expect(view.values).toMatchObject({
      workers: 3,
      slowMoMs: 250,
      headless: false,
      login: { strategy: 'login-form', path: '/signin', signedInMarker: 'Welcome back,' },
    });
    expect(service.current().workers).toBe(3);
    expect(saved()).toMatchObject({ workers: 3 });
    expect(audit).toEqual(['settings.update|settings|Changed: slowMoMs, workers, login.']);
    expect(audit.join()).not.toMatch(/localhost|signin/);
  });

  it('rejects a bad change as a whole, naming each field, and saves nothing', () => {
    const { service, saved } = make({
      QA_ENV_NAME: 'qa',
      QA_BASE_URL: 'http://localhost:3000',
    });
    const e = errorOf(() =>
      service.update({ workers: 50, appUrl: 'nope', login: { path: 'login' } }),
    );
    expect(e).toMatchObject({ status: 400, code: 'invalid-settings' });
    expect(Object.keys(e.fields!).sort()).toEqual(['appUrl', 'login.path', 'workers']);
    expect(saved()).toBeUndefined();
    expect(service.current().workers).toBe(1);
  });

  it('refuses production-looking addresses and environments outside the allow-list, whatever the browser sends', () => {
    const { service } = make({ QA_ENV_NAME: 'qa', QA_BASE_URL: 'http://localhost:3000' });
    expect(
      errorOf(() => service.update({ appUrl: 'https://app.prod.example.com' })).fields,
    ).toMatchObject({ appUrl: expect.stringContaining('production') });
    expect(errorOf(() => service.update({ envName: 'prod' })).fields).toMatchObject({
      envName: expect.stringContaining('not an allowed'),
    });
    expect(
      errorOf(() => service.update({ appUrl: 'https://u:p@app-qa.example.com' })).fields!['appUrl'],
    ).toMatch(/Do not put a username or password/);
    // the allow-list itself cannot be changed through the request
    expect(() => service.update({ allowedEnvs: ['prod'], envName: 'prod' })).toThrow();
    expect(service.view().allowedEnvs).toEqual(['dev', 'qa', 'uat', 'staging']);
  });

  it('honours an allow-list from the environment, and ignores unknown fields in a request', () => {
    const { service } = make({
      QA_ALLOWED_ENVS: 'sandbox',
      QA_ENV_NAME: 'sandbox',
      QA_BASE_URL: 'http://localhost:3000',
    });
    expect(service.availability().available).toBe(true);
    const v = service.update({ workers: 2, evil: 'x', login: { strategy: 'none', extra: 1 } });
    expect(JSON.stringify(v.values)).not.toContain('evil');
    expect(v.loginRequired).toBe(false);
    expect(() => service.update('nope')).toThrow(/JSON object/);
    expect(() => service.update([1])).toThrow(/JSON object/);
  });

  it('a saved settings object from an older or damaged store never stops the service starting', () => {
    expect(make({}, 'garbage').service.view().source).toBe('defaults');
    expect(make({}, { workers: 4 }).service.view().values.workers).toBe(4);
  });
});

describe('settings API', () => {
  it('serves, validates and saves settings over HTTP', async () => {
    const { service } = make({ QA_ENV_NAME: 'qa', QA_BASE_URL: 'http://localhost:3000' });
    const app = createApp(undefined, { settings: service });
    expect((await app.inject({ url: '/api/settings' })).json()).toMatchObject({
      available: true,
      values: { appUrl: 'http://localhost:3000' },
    });
    const ok = await app.inject({ method: 'PUT', url: '/api/settings', payload: { workers: 4 } });
    expect(ok.json().values.workers).toBe(4);
    const bad = await app.inject({ method: 'PUT', url: '/api/settings', payload: { workers: 0 } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toMatchObject({
      code: 'invalid-settings',
      fields: { workers: 'Use at least 1.' },
    });
    expect((await createApp().inject({ url: '/api/settings' })).statusCode).toBe(404);
  });
});
