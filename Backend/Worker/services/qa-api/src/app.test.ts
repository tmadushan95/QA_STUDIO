import ExcelJS from 'exceljs';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { MemoryStore } from './store.js';

const HEAD = ['Test Case ID', 'Title', 'Module', 'Steps', 'Expected Result', 'Priority'];

async function workbook(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('Cover').addRow(['Plan']);
  const a = wb.addWorksheet('Login, Auth'); // comma in name on purpose
  a.addRow(HEAD);
  a.addRow(['TC-1', 'Login works', 'Auth', '1. open\n2. sign in', 'Dashboard', 'High']);
  a.addRow(['TC-2', 'Bad creds', 'Auth', 'open', '', 'Low']);
  a.addRow(['', 'no id', 'Auth', '', '', '']);
  const b = wb.addWorksheet('Approvals');
  b.addRow(HEAD);
  b.addRow(['TC-10', 'Approve', 'Approvals', 'approve', 'Approved', 'High']);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

function multipartBody(filename: string, content: Buffer) {
  const boundary = '----qatest';
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    payload: Buffer.concat([head, content, tail]),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

let app: ReturnType<typeof createApp>;
let store: MemoryStore;

beforeEach(() => {
  store = new MemoryStore();
  app = createApp(store);
});

async function upload(name = 'plan.xlsx', content?: Buffer) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/imports',
    ...multipartBody(name, content ?? (await workbook())),
  });
  return res;
}

describe('imports', () => {
  it('uploads, lists worksheets and preselects the first eligible one', async () => {
    const res = await upload();
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.defaultSelection).toEqual(['Login, Auth']);
    expect(
      body.sheets.map(
        (s: { name: string; status: string; detectedCount: number; rejectedCount: number }) => [
          s.name,
          s.status,
          s.detectedCount,
          s.rejectedCount,
        ],
      ),
    ).toEqual([
      ['Cover', 'unrecognized', 0, 0],
      ['Login, Auth', 'has-errors', 2, 1],
      ['Approvals', 'valid', 1, 0],
    ]);
  });

  it('rejects .xls and non-workbook content with actionable errors', async () => {
    const xls = await upload('old.xls');
    expect(xls.statusCode).toBe(400);
    expect(xls.json().error.message).toMatch(/\.xls/);
    const fake = await upload('fake.xlsx', Buffer.from('not a zip at all'));
    expect(fake.statusCode).toBe(400);
    expect(fake.json().error.code).toBe('not-a-workbook');
  });

  it('returns 400 when no file is sent', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/imports',
      payload: '',
      headers: { 'content-type': 'multipart/form-data; boundary=x' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('previews cases for a worksheet selection (names containing commas) with filters and paging', async () => {
    const id = (await upload()).json().id;
    const one = await app.inject({
      url: `/api/imports/${id}/cases?sheet=${encodeURIComponent('Login, Auth')}`,
    });
    expect(one.json()).toMatchObject({
      scope: { mode: 'single-worksheet', worksheets: ['Login, Auth'] },
      total: 2,
      rejectedCount: 1,
    });
    const all = await app.inject({ url: `/api/imports/${id}/cases?all=true` });
    expect(all.json()).toMatchObject({
      scope: { mode: 'entire-workbook' },
      total: 3,
      modules: ['Approvals', 'Auth'],
    });
    const filtered = await app.inject({
      url: `/api/imports/${id}/cases?all=true&q=approve&pageSize=1`,
    });
    expect(filtered.json().items.map((c: { id: string }) => c.id)).toEqual(['TC-10']);
    const warn = all.json().warnings;
    expect(warn.map((w: { id: string }) => w.id)).toEqual(['TC-2']);
  });

  it('defaults to the first eligible worksheet when no selection is given', async () => {
    const id = (await upload()).json().id;
    const res = await app.inject({ url: `/api/imports/${id}/cases` });
    expect(res.json().scope.worksheets).toEqual(['Login, Auth']);
  });

  it('404s for unknown sessions and worksheets; 400s for bad query', async () => {
    expect((await app.inject({ url: '/api/imports/nope' })).statusCode).toBe(404);
    const id = (await upload()).json().id;
    expect((await app.inject({ url: `/api/imports/${id}/cases?sheet=Missing` })).statusCode).toBe(
      404,
    );
    expect((await app.inject({ url: `/api/imports/${id}/cases?pageSize=9999` })).statusCode).toBe(
      400,
    );
  });

  it('applies a manual column mapping to an unrecognized worksheet', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Odd');
    ws.addRow(['Ref', 'What']);
    ws.addRow(['A-1', 'Thing']);
    const id = (await upload('odd.xlsx', Buffer.from(await wb.xlsx.writeBuffer()))).json().id;
    const before = (await app.inject({ url: `/api/imports/${id}` })).json();
    expect(before.sheets[0].status).toBe('unrecognized');
    expect(before.sheets[0].sample[0]).toEqual(['Ref', 'What']);
    const res = await app.inject({
      method: 'PUT',
      url: `/api/imports/${id}/mapping`,
      payload: { sheet: 'Odd', headerRow: 1, mapping: { id: 1, title: 2 } },
    });
    expect(res.json().sheets[0]).toMatchObject({ status: 'valid', detectedCount: 1 });
    const bad = await app.inject({
      method: 'PUT',
      url: `/api/imports/${id}/mapping`,
      payload: { sheet: 'Odd', headerRow: 0, mapping: { bogus: 1 } },
    });
    expect(bad.statusCode).toBe(400);
  });
});

describe('commit, inventory and exports', () => {
  it('commits only the selected scope, then upserts on repeat', async () => {
    const id = (await upload()).json().id;
    const first = await app.inject({
      method: 'POST',
      url: `/api/imports/${id}/commit`,
      payload: { sheets: ['Approvals'] },
    });
    expect(first.json()).toMatchObject({ mode: 'single-worksheet', added: 1, updated: 0 });
    expect([...store.inventory.keys()]).toEqual(['TC-10']);
    const all = await app.inject({
      method: 'POST',
      url: `/api/imports/${id}/commit`,
      payload: { sheets: 'all' },
    });
    expect(all.json()).toMatchObject({
      mode: 'entire-workbook',
      added: 2,
      updated: 1,
      rejected: 1,
    });
  });

  it('commits individually selected IDs and reports missing ones', async () => {
    const id = (await upload()).json().id;
    const res = await app.inject({
      method: 'POST',
      url: `/api/imports/${id}/commit`,
      payload: { sheets: 'all', ids: ['TC-1', 'TC-404'] },
    });
    expect(res.json()).toMatchObject({ added: 1, missing: ['TC-404'] });
  });

  it('lists and filters the inventory and keeps source traceability', async () => {
    const id = (await upload()).json().id;
    await app.inject({
      method: 'POST',
      url: `/api/imports/${id}/commit`,
      payload: { sheets: 'all' },
    });
    const res = await app.inject({ url: '/api/inventory?module=Auth' });
    const body = res.json();
    expect(body.total).toBe(2);
    expect(body.items[0].source).toEqual({
      workbook: 'plan.xlsx',
      worksheet: 'Login, Auth',
      rowNumber: 2,
    });
    expect(body.modules).toEqual(['Approvals', 'Auth']);
  });

  it('serves the template, error workbook and inventory export as xlsx', async () => {
    const id = (await upload()).json().id;
    await app.inject({
      method: 'POST',
      url: `/api/imports/${id}/commit`,
      payload: { sheets: 'all' },
    });
    for (const url of [
      '/api/template.xlsx',
      `/api/imports/${id}/errors.xlsx?all=true`,
      '/api/inventory/export.xlsx?id=TC-1',
    ]) {
      const res = await app.inject({ url });
      expect(res.statusCode, url).toBe(200);
      expect(res.headers['content-type']).toContain('spreadsheetml');
      expect(res.headers['content-disposition']).toContain('attachment');
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(res.rawPayload as unknown as ExcelJS.Buffer);
      expect(wb.worksheets.length).toBeGreaterThan(0);
    }
    const inv = new ExcelJS.Workbook();
    await inv.xlsx.load(
      (await app.inject({ url: '/api/inventory/export.xlsx?id=TC-1' }))
        .rawPayload as unknown as ExcelJS.Buffer,
    );
    expect(inv.worksheets[0]!.rowCount).toBe(2); // header + the one selected case
  });

  it('bounds the number of retained import sessions', async () => {
    const content = await workbook();
    for (let i = 0; i < 25; i++) await upload(`p${i}.xlsx`, content);
    expect(store.sessions.size).toBe(20);
  });
});

describe('capabilities', () => {
  it('lists what this worker build offers, so the web app can spot an outdated worker', async () => {
    const r = await createApp(new MemoryStore()).inject({ url: '/api/automation' });
    expect(r.json().capabilities).toEqual(
      expect.arrayContaining(['api-parameters', 'azure-devops']),
    );
  });
});

describe('unknown routes', () => {
  it('names the route and points to a worker older than the web app, rather than a bare "Not found"', async () => {
    const app = createApp(new MemoryStore());
    const r = await app.inject({ method: 'GET', url: '/api/no-such-feature/TC_01?x=1' });
    expect(r.statusCode).toBe(404);
    expect(r.json().error.code).toBe('route-not-found');
    expect(r.json().error.message).toContain('GET /api/no-such-feature/TC_01.');
    expect(r.json().error.message).toContain('restart QA Studio');
  });
});
