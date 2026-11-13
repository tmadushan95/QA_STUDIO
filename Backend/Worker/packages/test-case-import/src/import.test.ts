import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import {
  buildErrorWorkbook,
  buildInventoryWorkbook,
  buildScope,
  buildTemplate,
  defaultSelection,
  ImportError,
  parseSteps,
  parseWorkbook,
  safeCell,
  selectCases,
  validateUpload,
} from './index.js';

const HEAD = ['Test Case ID', 'Title', 'Module', 'Steps', 'Expected Result', 'Priority', 'Tags'];

async function makeWorkbook(build: (wb: ExcelJS.Workbook) => void): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  build(wb);
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

const sample = () =>
  makeWorkbook((wb) => {
    const cover = wb.addWorksheet('Cover');
    cover.addRow(['Sample test plan']);
    cover.addRow(['Owner: QA']);

    const login = wb.addWorksheet('Login');
    login.addRow(['Release 1 login tests']); // title row above header
    login.addRow(HEAD);
    login.addRow([
      'TC-1',
      'Login works',
      'Auth',
      '1. Open login\n2. Sign in',
      'Dashboard shown',
      'High',
      'smoke, auth',
    ]);
    login.addRow(['TC-2', 'No expected', 'Auth', 'Open login', '', 'Low', '']);
    login.addRow(['', 'Missing id', 'Auth', 'x', 'y', '', '']);
    login.addRow(['TC-3', '', 'Auth', 'x', 'y', '', '']);
    login.addRow(['TC-1', 'Dup of TC-1', 'Auth', 'x', 'y', '', '']);
    login.addRow([]); // blank row is skipped, not rejected

    const appr = wb.addWorksheet('Approvals');
    appr.addRow(HEAD);
    appr.addRow([
      'TC-10',
      'Approve request',
      'Approvals',
      'Approve',
      'Status Approved',
      'High',
      '',
    ]);
    appr.addRow(['TC-1', 'Same id on another sheet', 'Approvals', 'x', 'y', '', '']);
  });

describe('parseWorkbook', () => {
  it('discovers all sheets with status and counts', async () => {
    const wb = await parseWorkbook({ name: 'plan.xlsx', bytes: await sample() });
    expect(wb.sheets.map((s) => [s.name, s.status, s.detectedCount])).toEqual([
      ['Cover', 'unrecognized', 0],
      ['Login', 'has-errors', 2],
      ['Approvals', 'valid', 2],
    ]);
  });

  it('finds the header below a title row and keeps source traceability', async () => {
    const wb = await parseWorkbook({ name: 'plan.xlsx', bytes: await sample() });
    const login = wb.sheets[1]!;
    expect(login.headerRow).toBe(2);
    expect(login.cases[0]!.source).toEqual({
      workbook: 'plan.xlsx',
      worksheet: 'Login',
      rowNumber: 3,
    });
    expect(login.cases[0]!.steps.map((s) => s.action)).toEqual(['Open login', 'Sign in']);
    expect(login.cases[0]!.tags).toEqual(['smoke', 'auth']);
  });

  it('rejects bad rows with reasons and row numbers instead of dropping them', async () => {
    const wb = await parseWorkbook({ name: 'plan.xlsx', bytes: await sample() });
    const rej = wb.sheets[1]!.rejected;
    expect(rej.map((r) => r.rowNumber)).toEqual([5, 6, 7]);
    expect(rej[0]!.reasons).toContain('Missing test case ID');
    expect(rej[1]!.reasons).toContain('Missing title');
    expect(rej[2]!.reasons[0]).toMatch(/Duplicate test case ID "TC-1".*row 3/);
  });

  it('does not invent expected results; it warns', async () => {
    const wb = await parseWorkbook({ name: 'plan.xlsx', bytes: await sample() });
    const tc2 = wb.sheets[1]!.cases[1]!;
    expect(tc2.expectedResult).toBeUndefined();
    expect(wb.sheets[1]!.warnings.map((w) => w.id)).toEqual(['TC-2']);
  });

  it('supports manual column mapping for unrecognized schemas', async () => {
    const bytes = await makeWorkbook((wb) => {
      const ws = wb.addWorksheet('Odd');
      ws.addRow(['Ref', 'What', 'Result']);
      ws.addRow(['A-1', 'Thing', 'ok']);
    });
    const auto = await parseWorkbook({ name: 'odd.xlsx', bytes });
    expect(auto.sheets[0]!.status).toBe('unrecognized');
    const mapped = await parseWorkbook(
      { name: 'odd.xlsx', bytes },
      { overrides: { Odd: { headerRow: 1, mapping: { id: 1, title: 2, expectedResult: 3 } } } },
    );
    expect(mapped.sheets[0]!.cases[0]).toMatchObject({
      id: 'A-1',
      title: 'Thing',
      expectedResult: 'ok',
    });
  });

  it('reads formula results and rich text', async () => {
    const bytes = await makeWorkbook((wb) => {
      const ws = wb.addWorksheet('F');
      ws.addRow(HEAD);
      ws.addRow(['TC-1', { formula: '"a"&"b"', result: 'ab' }, 'M', 's', 'e', '', '']);
    });
    const wb = await parseWorkbook({ name: 'f.xlsx', bytes });
    expect(wb.sheets[0]!.cases[0]!.title).toBe('ab');
  });

  it('flags worksheets over the row limit', async () => {
    const wb = await parseWorkbook(
      { name: 'plan.xlsx', bytes: await sample() },
      { limits: { maxBytes: 1e7, maxSheets: 50, maxRows: 3, maxCols: 100 } },
    );
    expect(wb.sheets.find((s) => s.name === 'Login')!.status).toBe('too-large');
  });

  it('reports corrupt zip content', async () => {
    const bad = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]);
    await expect(parseWorkbook({ name: 'x.xlsx', bytes: bad })).rejects.toMatchObject({
      code: 'corrupt-workbook',
    });
  });
});

describe('validateUpload', () => {
  const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
  it('rejects .xls, other types, empty, oversized and non-zip content', () => {
    expect(() => validateUpload({ name: 'a.xls', bytes: zip })).toThrow(/\.xls/);
    expect(() => validateUpload({ name: 'a.csv', bytes: zip })).toThrow(ImportError);
    expect(() => validateUpload({ name: 'a.xlsx', bytes: new Uint8Array() })).toThrow(/empty/);
    expect(() => validateUpload({ name: 'a.xlsx', bytes: new Uint8Array([1, 2, 3, 4]) })).toThrow(
      /not an .xlsx/,
    );
    expect(() =>
      validateUpload(
        { name: 'a.xlsx', bytes: zip },
        { maxBytes: 2, maxSheets: 1, maxRows: 1, maxCols: 1 },
      ),
    ).toThrow(/limit/);
  });
  it('strips path components from the file name', () => {
    expect(validateUpload({ name: '..\\..\\evil/../plan.xlsx', bytes: zip })).toBe('plan.xlsx');
  });
});

describe('worksheet selection', () => {
  it('defaults to the first worksheet with valid cases, skipping Cover', async () => {
    const wb = await parseWorkbook({ name: 'plan.xlsx', bytes: await sample() });
    expect(defaultSelection(wb)).toEqual(['Login']);
    const s = buildScope(wb);
    expect(s.mode).toBe('single-worksheet');
    expect(s.cases.map((c) => c.id)).toEqual(['TC-1', 'TC-2']);
  });

  it('supports multiple and all, rejecting cross-sheet duplicate IDs', async () => {
    const wb = await parseWorkbook({ name: 'plan.xlsx', bytes: await sample() });
    const multi = buildScope(wb, ['Login', 'Approvals']);
    expect(multi.mode).toBe('entire-workbook'); // both eligible sheets selected
    expect(multi.cases.map((c) => c.id)).toEqual(['TC-1', 'TC-2', 'TC-10']);
    expect(
      multi.rejected.some(
        (r) =>
          r.worksheet === 'Approvals' &&
          /already imported from worksheet "Login"/.test(r.reasons[0]!),
      ),
    ).toBe(true);
    expect(buildScope(wb, 'all').worksheets).toEqual(['Login', 'Approvals']);
  });

  it('rejects unknown worksheets and reports missing selected IDs', async () => {
    const wb = await parseWorkbook({ name: 'plan.xlsx', bytes: await sample() });
    expect(() => buildScope(wb, ['Nope'])).toThrow(/does not exist/);
    const { scope, missing } = selectCases(buildScope(wb, ['Approvals']), ['TC-10', 'TC-99']);
    expect(scope.cases.map((c) => c.id)).toEqual(['TC-10']);
    expect(missing).toEqual(['TC-99']);
  });

  it('returns an empty default when nothing is eligible', async () => {
    const bytes = await makeWorkbook((wb) => wb.addWorksheet('Empty'));
    const wb = await parseWorkbook({ name: 'e.xlsx', bytes });
    expect(defaultSelection(wb)).toEqual([]);
    expect(buildScope(wb).cases).toEqual([]);
  });
});

describe('parseSteps', () => {
  it('strips numbering and ignores blank lines', () => {
    expect(parseSteps('1. a\n\nStep 2: b\n3) c')).toEqual([
      { order: 1, action: 'a' },
      { order: 2, action: 'b' },
      { order: 3, action: 'c' },
    ]);
  });
});

describe('exports', () => {
  const read = async (buf: Buffer) => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ExcelJS.Buffer);
    return wb;
  };

  it('template has headers and no data rows', async () => {
    const wb = await read(await buildTemplate());
    expect(wb.getWorksheet('TestCases')!.rowCount).toBe(1);
  });

  it('error workbook lists rejected rows', async () => {
    const parsed = await parseWorkbook({ name: 'plan.xlsx', bytes: await sample() });
    const wb = await read(await buildErrorWorkbook(buildScope(parsed, ['Login']).rejected));
    const ws = wb.getWorksheet('Rejected Rows')!;
    expect(ws.rowCount).toBe(4);
    expect(String(ws.getRow(2).getCell(4).value)).toContain('Missing test case ID');
  });

  it('inventory round-trips through the importer with traceability columns', async () => {
    const parsed = await parseWorkbook({ name: 'plan.xlsx', bytes: await sample() });
    const buf = await buildInventoryWorkbook(buildScope(parsed, 'all').cases);
    const again = await parseWorkbook({ name: 'inventory.xlsx', bytes: new Uint8Array(buf) });
    expect(again.sheets[0]!.cases.map((c) => c.id)).toEqual(['TC-1', 'TC-2', 'TC-10']);
    const ws = (await read(buf)).getWorksheet('Test Inventory')!;
    expect(ws.getRow(2).getCell(16).value).toBe('Login');
    expect(ws.getRow(2).getCell(17).value).toBe(3);
  });

  it('neutralizes formula injection', () => {
    expect(safeCell('=HYPERLINK("http://x")')).toBe(`'=HYPERLINK("http://x")`);
    expect(safeCell('+1')).toBe("'+1");
    expect(safeCell('normal')).toBe('normal');
  });
});
