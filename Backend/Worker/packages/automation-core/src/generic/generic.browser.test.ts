/**
 * Proves the generic step library against a small, app-agnostic page: a search form, a table with row actions,
 * a confirmation dialog and a toast. Nothing here is application-specific; the same steps work on any web application.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { chromium, type Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLogger, type Scenario } from '@qa-studio/shared';
import { ActionRegistry, registerGenericActions, resolveData, runScenario } from '../index.js';

const APP = `<!doctype html><meta charset="utf-8"><title>Sample</title>
<main>
  <h1>Projects</h1>
  <label>Search <input id="q"></label>
  <label>Status <select id="st"><option>Draft</option><option>Open</option></select></label>
  <label><input type="checkbox" id="mine"> Mine only</label>
  <button id="save" disabled>Save</button>
  <table>
    <tr><th>Code</th><th>Name</th><th></th></tr>
    <tr><td>PRJ-1</td><td>Alpha</td><td><button>Delete</button></td></tr>
    <tr><td>PRJ-2</td><td>Beta</td><td><button>Delete</button></td></tr>
  </table>
  <p id="total" data-testid="total">2 projects</p>
</main>
<script>
  document.querySelectorAll('table button').forEach((b) => b.onclick = () => {
    const row = b.closest('tr');
    document.body.insertAdjacentHTML('beforeend',
      '<div role="dialog" aria-label="Delete project?"><p>This cannot be undone.</p><button id="ok">Confirm</button><button id="no">Cancel</button></div>');
    document.getElementById('no').onclick = () => document.querySelector('[role=dialog]').remove();
    document.getElementById('ok').onclick = () => {
      row.remove(); document.querySelector('[role=dialog]').remove();
      document.getElementById('total').textContent = '1 projects';
      document.body.insertAdjacentHTML('beforeend', '<p role="status">Project deleted.</p>');
    };
  });
  document.getElementById('q').oninput = () => { document.getElementById('save').disabled = false; };
</script>`;

let server: http.Server;
let browser: Browser;
let baseUrl: string;
const registry = registerGenericActions(new ActionRegistry());

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const ok = req.url === '/projects';
    res.writeHead(ok ? 200 : 404, { 'content-type': 'text/html' }).end(ok ? APP : 'not found');
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
  steps: Scenario['steps'],
  opts: { allowDestructive?: boolean; data?: Record<string, string> } = {},
) {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    return await runScenario(
      registry,
      { schemaVersion: 1, caseId: 'T', steps },
      {
        page,
        env: {
          baseUrl,
          timeoutMs: 2000,
          pages: { projects: { route: '/projects', marker: 'Projects' } },
          data: opts.data ?? {},
        },
        log: createLogger(() => undefined),
        signal: new AbortController().signal,
      },
      { stepTimeoutMs: 4000, allowDestructive: opts.allowDestructive ?? false },
    );
  } finally {
    await context.close();
  }
}

describe('generic step library', () => {
  it('fills, selects, ticks and checks states with targets described like a person would', async () => {
    const r = await run(
      [
        { action: 'go-to-page', params: { page: 'projects' } },
        { action: 'assert-disabled', params: { target: { role: 'button', name: 'Save' } } },
        { action: 'fill', params: { target: { label: 'Search' }, value: '{{data.code}}' } },
        { action: 'assert-value', params: { target: { label: 'Search' }, value: 'PRJ-1' } },
        { action: 'assert-enabled', params: { target: { role: 'button', name: 'Save' } } },
        { action: 'select', params: { target: { label: 'Status' }, option: 'Open' } },
        { action: 'check', params: { target: { label: 'Mine only' } } },
        {
          action: 'assert-count',
          params: { target: { role: 'button', name: 'Delete' }, count: 2 },
        },
        { action: 'assert-url', params: { contains: '/projects' } },
      ].map((s) => {
        // Parameters are filled before the run, exactly as the run engine does.
        const r = resolveData(s.params, { code: 'PRJ-1' });
        return { ...s, params: (r.ok ? r.value : s.params) as Record<string, unknown> };
      }),
    );
    expect(r.failure?.message ?? r.status).toBe('passed');
  });

  it('acts inside a table row and a dialog, remembers a value and compares it later', async () => {
    const r = await run(
      [
        { action: 'open', params: { path: '/projects' } },
        {
          action: 'remember',
          params: { from: 'text', target: { testId: 'total' }, as: 'before' },
        },
        {
          action: 'click',
          params: {
            target: { role: 'button', name: 'Delete', within: { role: 'row', text: 'PRJ-2' } },
          },
        },
        {
          action: 'assert-visible',
          params: { target: { role: 'dialog', name: 'Delete project?' } },
        },
        {
          action: 'click',
          params: {
            target: { role: 'button', name: 'Confirm', within: { role: 'dialog' } },
            destructive: true,
          },
        },
        { action: 'assert-text', params: { text: 'Project deleted.' } },
        { action: 'assert-no-text', params: { text: 'Beta' } },
        { action: 'assert-equals', params: { actual: '{{var.before}}', expected: '2 projects' } },
      ],
      { allowDestructive: true },
    );
    expect(r.failure?.message ?? r.status).toBe('passed');
  });

  it('blocks a step marked as deleting data unless deleting is allowed, before anything runs', async () => {
    const r = await run([
      { action: 'open', params: { path: '/projects' } },
      {
        action: 'click',
        params: { target: { role: 'button', name: 'Delete' }, destructive: true },
      },
    ]);
    expect(r.status).toBe('blocked');
    expect(r.steps[0]?.status).toBe('skipped');
  });

  it('reports a clear assertion failure with what was expected', async () => {
    const r = await run([
      { action: 'open', params: { path: '/projects' } },
      { action: 'assert-text', params: { text: 'No such text' } },
    ]);
    expect(r.status).toBe('failed');
    expect(r.failure).toMatchObject({
      kind: 'assertion',
      message: 'Expected "No such text" to be visible.',
    });
  });

  it('refuses steps without a way to find the element, and unknown pages', async () => {
    expect(registry.validate('click', { target: {} }).ok).toBe(false);
    const r = await run([{ action: 'go-to-page', params: { page: 'nowhere' } }]);
    expect(r.status).toBe('failed');
    expect(r.failure?.message).toMatch(/no page "nowhere"/);
  });

  it('describes every action for the visual editor', () => {
    const list = registry.list();
    expect(list.length).toBe(25);
    expect(list.every((a) => a.ui && a.ui.label && a.ui.group)).toBe(true);
  });
});
