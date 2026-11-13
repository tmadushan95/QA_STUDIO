import ExcelJS from 'exceljs';
import type { TestCase } from '@qa-studio/shared';
import { FIELDS, HEADER_LABELS } from './columns.js';
import type { RejectedRow } from './parse.js';

/** Neutralize spreadsheet formula injection: text that Excel would evaluate gets a leading apostrophe. */
export function safeCell(v: string): string {
  return /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
}

function style(ws: ExcelJS.Worksheet): void {
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  ws.columns.forEach(
    (c) => (c.width = Math.min(60, Math.max(14, String(c.header ?? '').length + 4))),
  );
}

async function toBuffer(wb: ExcelJS.Workbook): Promise<Buffer> {
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** Approved import template: headers only, so no example data can be mistaken for real test cases. */
export async function buildTemplate(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('TestCases');
  ws.columns = FIELDS.map((f) => ({ header: HEADER_LABELS[f], key: f }));
  style(ws);
  const help = wb.addWorksheet('Instructions');
  help.addRows([
    ['Test Case ID and Title are required. IDs must be unique.'],
    ['Steps: one step per line in the cell; numbering prefixes such as "1." are optional.'],
    ['Expected Result is never inferred. Leave it blank if unknown and the case is flagged.'],
    ['Tags and Dependencies: separate values with commas.'],
  ]);
  return toBuffer(wb);
}

export async function buildErrorWorkbook(rejected: RejectedRow[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Rejected Rows');
  ws.columns = [
    { header: 'Worksheet', key: 'worksheet' },
    { header: 'Row', key: 'row' },
    { header: 'Test Case ID', key: 'id' },
    { header: 'Reasons', key: 'reasons' },
    { header: 'Original Values', key: 'raw' },
  ];
  for (const r of rejected) {
    ws.addRow({
      worksheet: safeCell(r.worksheet),
      row: r.rowNumber,
      id: safeCell(r.id ?? ''),
      reasons: safeCell(r.reasons.join('; ')),
      raw: safeCell(r.raw.join(' | ')),
    });
  }
  style(ws);
  return toBuffer(wb);
}

/** Export the full or a filtered inventory, with source workbook, worksheet and row for traceability. */
export async function buildInventoryWorkbook(cases: TestCase[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Test Inventory');
  ws.columns = [
    ...FIELDS.map((f) => ({ header: HEADER_LABELS[f], key: f })),
    { header: 'Automation Readiness', key: 'readiness' },
    { header: 'Source Workbook', key: 'workbook' },
    { header: 'Source Worksheet', key: 'worksheet' },
    { header: 'Source Row', key: 'row' },
  ];
  for (const c of cases) {
    ws.addRow({
      id: safeCell(c.id),
      title: safeCell(c.title),
      description: safeCell(c.description ?? ''),
      module: safeCell(c.module ?? ''),
      preconditions: safeCell(c.preconditions ?? ''),
      steps: safeCell(c.steps.map((s) => `${s.order}. ${s.action}`).join('\n')),
      expectedResult: safeCell(c.expectedResult ?? ''),
      priority: safeCell(c.priority ?? ''),
      severity: safeCell(c.severity ?? ''),
      testType: safeCell(c.testType ?? ''),
      userRole: safeCell(c.userRole ?? ''),
      tags: safeCell(c.tags.join(', ')),
      dependsOn: safeCell(c.dependsOn.join(', ')),
      readiness: c.readiness,
      workbook: safeCell(c.source.workbook),
      worksheet: safeCell(c.source.worksheet),
      row: c.source.rowNumber,
    });
  }
  style(ws);
  return toBuffer(wb);
}
