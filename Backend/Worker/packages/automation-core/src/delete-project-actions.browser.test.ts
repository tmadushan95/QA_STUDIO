import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLogger, Scenario } from '@qa-studio/shared';
import {
  ActionRegistry,
  LEGACY_PAGES,
  registerAppActions,
  registerDeleteProjectActions,
  registerGenericActions,
  resolveData,
  runScenario,
} from './index.js';

/**
 * A stand-in that copies the structure and wording of the target application's delete flow as read from its source
 * (draft list with a search box, edit page with Delete, confirmation, success message, redirect).
 * It proves the actions behave as designed; it does not prove they match the real application.
 */
const projects = new Map<string, { code: string; status: 'Draft' | 'Rejected' }>([
  ['a1', { code: 'PRJ-1', status: 'Draft' }],
  ['a2', { code: 'PRJ-2', status: 'Rejected' }],
  ['a3', { code: 'PRJ-3', status: 'Draft' }],
  ['a4', { code: 'PRJ-4', status: 'Draft' }], // linked to an LRP cycle: the server refuses to delete it
]);

const shell = (body: string) => `<!doctype html><meta charset="utf-8">${body}`;
const listPage = () =>
  shell(`<h1>Draft Projects</h1>
<input type="search" aria-label="Search draft projects" id="q">
<table><tbody id="rows"></tbody></table>
<script>
  const all = ${JSON.stringify([...projects].map(([id, p]) => ({ id, ...p })))};
  const draw = () => {
    const q = document.getElementById('q').value.toLowerCase();
    document.getElementById('rows').innerHTML = all.filter(p => p.code.toLowerCase().includes(q))
      .map(p => '<tr data-id="'+p.id+'" data-status="'+p.status+'"><td>'+p.code+'</td><td>'+p.status+'</td></tr>').join('');
    document.querySelectorAll('tr').forEach(tr => tr.onclick = () => {
      location.href = '/projects/' + tr.dataset.id + (tr.dataset.status === 'Rejected' ? '/resubmit' : '/draft');
    });
  };
  document.getElementById('q').oninput = draw; draw();
</script>`);

function editPage(id: string, canDelete: boolean) {
  return shell(`<h1>Project ${projects.get(id)?.code}</h1>
${canDelete ? '<button id="del">Delete</button>' : ''}
<div id="dlg" role="alertdialog" hidden>
  <h2>Delete Project?</h2>
  <p>Are you sure you want to delete this project? This action will permanently remove the project from the system and cannot be undone.</p>
  <button id="cancel">Cancel</button><button id="ok">Confirm</button>
</div>
<script>
  const dlg = document.getElementById('dlg');
  document.getElementById('del')?.addEventListener('click', () => dlg.hidden = false);
  document.getElementById('cancel').onclick = () => dlg.hidden = true;
  document.getElementById('ok').onclick = async () => {
    const r = await fetch('/api/delete/${id}', { method: 'POST' });
    if (!r.ok) {
      document.body.insertAdjacentHTML('beforeend', '<div role="status">This record is linked to an LRP cycle. Unlink it from the cycle before deleting it.</div>');
      dlg.hidden = true;
      return;
    }
    document.body.insertAdjacentHTML('beforeend', '<div role="status">Project deleted successfully.</div>');
    setTimeout(() => location.href = '/projects/draft-list', 300);
  };
</script>`);
}

let server: http.Server;
let browser: Browser;
let baseUrl: string;
let canDelete = true;
// The same actions as the server: generic steps plus the delete-project pack, since shipped scenarios may mix both.
const registry = registerDeleteProjectActions(
  registerAppActions(registerGenericActions(new ActionRegistry())),
);

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = req.url ?? '/';
    const html = (b: string) => res.writeHead(200, { 'content-type': 'text/html' }).end(b);
    if (url === '/projects/draft-list') return html(listPage());
    if (url === '/open-projects' || url === '/my-projects') return html(listPage());
    const del = /^\/api\/delete\/(\w+)$/.exec(url);
    if (del && req.method === 'POST') {
      if (del[1] === 'a4') return res.writeHead(409).end();
      projects.delete(del[1]!);
      return res.writeHead(204).end();
    }
    const edit = /^\/projects\/(\w+)\/(draft|resubmit)$/.exec(url);
    if (edit) {
      // Like the real app: a page for a deleted project sends the user back to the list.
      if (projects.has(edit[1]!)) return html(editPage(edit[1]!, canDelete));
      return res.writeHead(302, { location: '/projects/draft-list' }).end();
    }
    res.writeHead(404).end('not found');
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
  data: Record<string, string>,
  allowDestructive = false,
) {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    return await runScenario(
      registry,
      { schemaVersion: 1, caseId: 'TC', steps },
      {
        page,
        env: { baseUrl, timeoutMs: 4000, pages: LEGACY_PAGES, data },
        log: createLogger(() => undefined),
        signal: new AbortController().signal,
      },
      { stepTimeoutMs: 20_000, allowDestructive },
    );
  } finally {
    await context.close();
  }
}

const open = (code: string) => ({
  action: 'drafts.open-project',
  params: { list: 'draft', code },
});
const click = { action: 'project.click-delete', params: {} };
const dialog = { action: 'project.assert-delete-dialog', params: { kind: 'individual' } };

describe('delete-project actions (against a stand-in)', () => {
  it('opens a project, shows the confirmation, and cancel leaves it listed', async () => {
    canDelete = true;
    const out = await run(
      [
        open('{{data.p}}'),
        { action: 'project.assert-delete-button', params: { visible: true } },
        click,
        dialog,
        { action: 'project.cancel-delete', params: {} },
        {
          action: 'drafts.assert-listed',
          params: { list: 'draft', code: '{{data.p}}', listed: true },
        },
      ],
      { p: 'PRJ-1' },
    );
    expect(out.failure).toBeUndefined();
    expect(out.status).toBe('passed');
  });

  it('opens a Rejected project on its resubmit page', async () => {
    const out = await run(
      [open('PRJ-2'), { action: 'project.assert-delete-button', params: { visible: true } }],
      {},
    );
    expect(out.status).toBe('passed');
  });

  it('fails clearly when the Delete button is shown but should not be', async () => {
    canDelete = true;
    const out = await run(
      [open('PRJ-1'), { action: 'project.assert-delete-button', params: { visible: false } }],
      {},
    );
    expect(out.status).toBe('failed');
    expect(out.failure).toMatchObject({ kind: 'assertion', expected: 'no Delete button' });
  });

  it('passes the no-permission case when the button is absent', async () => {
    canDelete = false;
    const out = await run(
      [open('PRJ-1'), { action: 'project.assert-delete-button', params: { visible: false } }],
      {},
    );
    canDelete = true;
    expect(out.status).toBe('passed');
  });

  it('reports a code that is not in the list', async () => {
    const out = await run([open('NOPE-9')], {});
    expect(out.status).toBe('failed');
    expect(out.failure?.message).toMatch(/NOPE-9 is not in the draft Draft list/);
  });

  it('blocks a destructive confirm unless deleting is explicitly allowed, and deletes nothing', async () => {
    const steps = [open('PRJ-3'), click, { action: 'project.confirm-delete', params: {} }];
    const out = await run(steps, {});
    expect(out.status).toBe('blocked');
    expect(out.failure?.message).toMatch(/destructive and was not explicitly allowed/);
    expect(projects.has('a3')).toBe(true);
  });

  it('deletes through the confirmation when allowed, then the project is gone from the list and its address', async () => {
    const out = await run(
      [
        open('PRJ-3'),
        click,
        dialog,
        { action: 'project.confirm-delete', params: {} },
        { action: 'drafts.assert-listed', params: { list: 'draft', code: 'PRJ-3', listed: false } },
        { action: 'project.assert-gone', params: {} },
      ],
      {},
      true,
    );
    expect(out.failure).toBeUndefined();
    expect(out.status).toBe('passed');
    expect(projects.has('a3')).toBe(false);
  });

  it('blocks a case whose parameter is not set, naming the missing value', async () => {
    const out = await run([open('{{data.missingOne}}')], { missingOne: '' });
    expect(out.status).toBe('blocked');
    expect(out.failure?.message).toBe(
      'Parameter "missingOne" is not set. Add it in the test case\'s parameters (Test Design or Test Execution page).',
    );
  });
});

describe('refused deletes and read-only checks', () => {
  const refuse = {
    action: 'project.confirm-delete-expect-error',
    params: { message: 'linked to an LRP cycle' },
  };

  it('passes when the app refuses the delete with the expected message, and the project stays listed', async () => {
    const out = await run(
      [
        open('PRJ-4'),
        click,
        dialog,
        refuse,
        { action: 'drafts.assert-listed', params: { list: 'draft', code: 'PRJ-4', listed: true } },
      ],
      {},
      true,
    );
    expect(out.failure).toBeUndefined();
    expect(out.status).toBe('passed');
  });

  it('fails when the app deletes a project that it should have refused', async () => {
    projects.set('a5', { code: 'PRJ-5', status: 'Draft' });
    const out = await run([open('PRJ-5'), click, dialog, refuse], {}, true);
    expect(out.status).toBe('failed');
    expect(out.failure?.message).toBe('The app deleted the project, but it should have refused.');
  });

  it('is blocked, without deleting anything, when deleting is not allowed', async () => {
    const out = await run([open('PRJ-4'), click, refuse], {});
    expect(out.status).toBe('blocked');
    expect(projects.has('a4')).toBe(true);
  });

  it('finds a project in Open projects and opens its page', async () => {
    const out = await run(
      [
        { action: 'projects.open-from-list', params: { list: 'open', code: 'PRJ-4' } },
        { action: 'project.assert-delete-button', params: { visible: true } },
      ],
      {},
    );
    // The stand-in sends every row to its draft page, so the Delete button exists there.
    expect(out.status).toBe('passed');
  });
});

describe('resolveData', () => {
  it('replaces references in nested params and leaves other text alone', () => {
    expect(resolveData({ a: ['x {{ data.k }} y'], n: 3 }, { k: 'V' })).toEqual({
      ok: true,
      value: { a: ['x V y'], n: 3 },
    });
  });
});

// The first scenarios written for the product, kept to catch a change to the step library that would break real steps.
describe('example scenarios', () => {
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'test-fixtures/scenarios');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));

  it('are valid, use only registered actions, and name the test case in their file name', () => {
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const s = Scenario.parse(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
      expect(f).toBe(`${s.caseId}.json`);
      for (const step of s.steps) {
        const filled = resolveData(
          step.params,
          new Proxy({}, { get: () => 'X' }) as Record<string, string>,
        );
        expect(filled.ok).toBe(true);
        const v = registry.validate(step.action, filled.ok ? filled.value : undefined);
        expect(v, `${f}: ${step.action}`).toMatchObject({ ok: true });
      }
    }
  });
});
