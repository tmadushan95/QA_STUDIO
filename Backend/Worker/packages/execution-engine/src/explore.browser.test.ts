import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ActionRegistry } from '@qa-studio/automation-core';
import { createLogger, type AppSettings } from '@qa-studio/shared';
import { PlaywrightExecutor } from './playwright-executor.js';

/** A tiny app: one page that tries to write on load, one that only reads. Counts the writes that got through. */
let server: http.Server;
let base: string;
let writesReceived = 0;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.method !== 'GET') {
      writesReceived++;
      return res.writeHead(200).end('{}');
    }
    const html = (b: string) =>
      res
        .writeHead(200, { 'content-type': 'text/html' })
        .end(`<!doctype html><title>Stub</title>${b}`);
    if (req.url === '/projects/draft-list') {
      return html(`<h1>Draft Projects</h1><input type="search" aria-label="Search draft projects"><table><tr><td>PRJ-1</td></tr></table>
        <script>fetch('/api/audit', { method: 'POST', body: 'x' }).catch(() => {});</script>`);
    }
    if (req.url === '/dashboard') return html('<h1>Welcome back, QA</h1><button>Delete</button>');
    res.writeHead(404).end('not found');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 60_000);
afterAll(() => server?.close());

const settings = (): AppSettings =>
  ({
    envName: 'qa',
    appUrl: base,
    browser: 'chromium',
    headless: true,
    slowMoMs: 0,
    workers: 1,
    timeoutMs: 5000,
    login: { strategy: 'none', path: '/login', signedInMarker: 'Welcome' },
  }) as AppSettings;

const executor = () =>
  new PlaywrightExecutor({
    getSettings: settings,
    getCredentials: () => undefined,
    registry: new ActionRegistry(),
    artifactsDir: 'unused',
    log: createLogger(() => undefined),
  });

describe('read-only exploration', () => {
  it('reads each page as text and refuses every request that would change data', async () => {
    writesReceived = 0;
    const pages = await executor().explore(settings(), undefined, [
      '/projects/draft-list',
      '/dashboard',
    ]);
    expect(pages.map((p) => p.ok)).toEqual([true, true]);
    expect(pages[0]!.snapshot).toContain('heading "Draft Projects"');
    expect(pages[0]!.snapshot).toContain('searchbox "Search draft projects"');
    expect(pages[0]!.snapshot).toContain(`URL: ${base}/projects/draft-list`);
    expect(pages[0]!.blockedWrites).toBe(1);
    expect(pages[1]!.snapshot).toContain('button "Delete"');
    expect(pages[1]!.blockedWrites).toBe(0);
    expect(writesReceived).toBe(0); // the POST never reached the server
  }, 60_000);

  it('refuses pages outside the app and reports a page that does not load', async () => {
    const pages = await executor().explore(settings(), undefined, [
      'https://example.com/',
      '//evil.example/x',
    ]);
    expect(pages.every((p) => !p.ok)).toBe(true);
    expect(pages[0]!.error).toBe('Only pages of the app under test can be explored.');
  }, 60_000);

  it('asks for an account when sign-in is on', async () => {
    const s = {
      ...settings(),
      login: { strategy: 'login-form', path: '/login', signedInMarker: 'Welcome' },
    } as AppSettings;
    await expect(executor().explore(s, undefined, ['/dashboard'])).rejects.toThrow(
      'Choose a test account to explore as.',
    );
  });
});
