import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { chromium, type Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLogger, type Scenario } from '@qa-studio/shared';
import {
  ActionRegistry,
  LEGACY_PAGES,
  registerAppActions,
  runScenario,
  type ActionContext,
} from './index.js';

const NAV = `<nav><a href="/dashboard">Dashboard</a><a href="/operational-units">Operational Units</a></nav>`;
const PAGES: Record<string, string> = {
  '/dashboard': `${NAV}<h1>Welcome back, QA</h1>`,
  '/operational-units': `${NAV}<p>${LEGACY_PAGES['operational-units']!.marker}</p>
    <table><tr><td>Formosa</td><td><button onclick="document.body.insertAdjacentHTML('beforeend','<h2>Formosa details</h2>')">View</button></td></tr></table>`,
};

let server: http.Server;
let browser: Browser;
let baseUrl: string;
const registry = registerAppActions(new ActionRegistry());

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const body = PAGES[req.url ?? ''];
    res.writeHead(body ? 200 : 404, { 'content-type': 'text/html' }).end(body ?? 'not found');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  browser = await chromium.launch();
}, 60_000);

afterAll(async () => {
  await browser?.close();
  server?.close();
});

async function run(
  scenario: Scenario,
  opts: { timeoutMs?: number; signal?: AbortSignal; allowDestructive?: boolean } = {},
) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const timeoutMs = opts.timeoutMs ?? 3000;
  const ctx: Omit<ActionContext, 'vars'> = {
    page,
    env: { baseUrl, timeoutMs, pages: LEGACY_PAGES },
    log: createLogger(() => undefined),
    signal: opts.signal ?? new AbortController().signal,
  };
  try {
    return await runScenario(registry, scenario, ctx, {
      stepTimeoutMs: timeoutMs * 2,
      allowDestructive: opts.allowDestructive ?? false,
    });
  } finally {
    await context.close();
  }
}

const scenario = (steps: Scenario['steps']): Scenario => ({
  schemaVersion: 1,
  caseId: 'TC-1',
  steps,
});

describe('Application actions against a local stub app', () => {
  it('passes a data-driven scenario: open dashboard, navigate, view a unit', async () => {
    const out = await run(
      scenario([
        { action: 'app.open', params: { path: '/dashboard' } },
        { action: 'auth.assert-signed-in', params: {} },
        { action: 'nav.open-page', params: { page: 'operational-units' } },
        { action: 'operational-units.view', params: { name: 'Formosa' } },
      ]),
    );
    expect(out.status).toBe('passed');
    expect(out.steps.map((s) => s.status)).toEqual(['passed', 'passed', 'passed', 'passed']);
  }, 30_000);

  it('reports an assertion failure with expected/actual and skips the remaining steps', async () => {
    const out = await run(
      scenario([
        { action: 'app.open', params: { path: '/dashboard' } },
        { action: 'assert.text-visible', params: { text: 'Totally absent text' } },
        { action: 'app.open', params: { path: '/operational-units' } },
      ]),
      { timeoutMs: 800 },
    );
    expect(out.status).toBe('failed');
    expect(out.failure).toMatchObject({
      kind: 'assertion',
      expected: 'Totally absent text',
      actual: 'not visible',
    });
    expect(out.steps.map((s) => s.status)).toEqual(['passed', 'failed', 'skipped']);
  }, 30_000);

  it('classifies a missing nav link as a timeout and an unknown page key as an automation error', async () => {
    const t = await run(
      scenario([
        { action: 'app.open', params: { path: '/dashboard' } },
        { action: 'operational-units.view', params: { name: 'Nobody' } },
      ]),
      { timeoutMs: 600 },
    );
    expect(t.failure?.kind).toBe('timeout');
    const a = await run(
      scenario([
        { action: 'app.open', params: { path: '/dashboard' } },
        { action: 'nav.open-page', params: { page: 'nope' } },
      ]),
    );
    expect(a.failure).toMatchObject({ kind: 'automation-error' });
    expect(a.failure?.message).toMatch(/Unknown page "nope"/);
  }, 30_000);

  it('blocks the whole case, running nothing, for unknown actions or bad params', async () => {
    const out = await run(
      scenario([
        { action: 'app.open', params: { path: '/dashboard' } },
        { action: 'approvals.approve-request', params: {} },
        { action: 'app.open', params: { path: 'https://evil.example/' } },
      ]),
    );
    expect(out.status).toBe('blocked');
    expect(out.steps.map((s) => s.status)).toEqual(['skipped', 'blocked', 'blocked']);
    expect(out.failure?.message).toMatch(/Unknown action "approvals.approve-request"/);
    expect(out.failure?.message).toMatch(/same-origin path/);
  }, 30_000);

  it('cancels remaining steps when the signal aborts', async () => {
    const ac = new AbortController();
    ac.abort();
    const out = await run(scenario([{ action: 'app.open', params: { path: '/dashboard' } }]), {
      signal: ac.signal,
    });
    expect(out.status).toBe('cancelled');
    expect(out.steps[0]!.status).toBe('cancelled');
  }, 30_000);
});

describe('registry', () => {
  it('lists actions with JSON Schema and rejects duplicates', () => {
    const list = registry.list();
    expect(list.map((a) => a.name)).toContain('nav.open-page');
    expect(list.find((a) => a.name === 'operational-units.view')?.params).toMatchObject({
      type: 'object',
      required: ['name'],
    });
    expect(() => registerAppActions(registry)).toThrow(/already registered/);
  });
});
