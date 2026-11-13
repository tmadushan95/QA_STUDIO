import ExcelJS from 'exceljs';
import { safeCell } from '@qa-studio/test-case-import';
import type { RunReport } from './report.js';

const pct = (r: number | null) => (r === null ? 'n/a' : Math.round(r * 100) / 100);

function sheet(wb: ExcelJS.Workbook, name: string, columns: string[]): ExcelJS.Worksheet {
  const ws = wb.addWorksheet(name);
  ws.columns = columns.map((header) => ({
    header,
    width: Math.min(60, Math.max(14, header.length + 4)),
  }));
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  return ws;
}

/** Excel report. Free text goes through safeCell to stop formula injection from untrusted workbook content. */
export async function renderExcel(r: RunReport): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const s = r.summary;

  const sum = sheet(wb, 'Summary', ['Field', 'Value']);
  const fields: [string, string | number][] = [
    ['Execution ID', r.run.id],
    ['Status', r.run.status],
    ['Environment', r.run.environment],
    ['Browser', r.run.browser],
    ['Accounts', r.run.accounts.join(', ')],
    ['Workers', r.run.workers],
    ['Started', r.run.startedAt ?? ''],
    ['Ended', r.run.endedAt ?? ''],
    ['Duration (ms)', r.run.durationMs ?? ''],
    ['Framework version', r.frameworkVersion],
    ['Generated', r.generatedAt],
    ['Selected', s.total],
    ['Passed', s.counts.passed],
    ['Failed', s.counts.failed],
    ['Blocked', s.counts.blocked],
    ['Cancelled', s.counts.cancelled],
    ['Skipped', s.counts.skipped],
    ['Pending', s.counts.queued + s.counts.running],
    ['Pass rate', pct(s.passRate)],
    ['Pass rate rule', s.passRateRule],
    ...r.issues.map((i): [string, string] => ['Issue', i]),
    ...r.limitations.map((l): [string, string] => ['Limitation', l]),
  ];
  for (const [k, v] of fields) sum.addRow([k, typeof v === 'string' ? safeCell(v) : v]);

  const cov = sheet(wb, 'Coverage by module', [
    'Module',
    'Total',
    'Passed',
    'Failed',
    'Blocked',
    'Cancelled',
    'Skipped',
    'Pending',
    'Pass rate',
  ]);
  for (const m of r.coverageByModule)
    cov.addRow([
      safeCell(m.module),
      m.total,
      m.passed,
      m.failed,
      m.blocked,
      m.cancelled,
      m.skipped,
      m.pending,
      pct(m.passRate),
    ]);

  const cases = sheet(wb, 'Cases', [
    'Test Case ID',
    'Title',
    'Module',
    'Priority',
    'Status',
    'Duration (ms)',
    'Failure kind',
    'Failure message',
    'Expected',
    'Actual',
    'Evidence',
    'Source workbook',
    'Source worksheet',
    'Source row',
    'Account',
  ]);
  for (const c of r.cases) {
    cases.addRow([
      safeCell(c.caseId),
      safeCell(c.title ?? ''),
      safeCell(c.module ?? ''),
      safeCell(c.priority ?? ''),
      c.status,
      c.durationMs ?? '',
      c.failure?.kind ?? '',
      safeCell(c.failure?.message ?? ''),
      safeCell(c.failure?.expected ?? ''),
      safeCell(c.failure?.actual ?? ''),
      safeCell(c.artifacts.join(', ')),
      safeCell(c.source?.workbook ?? ''),
      safeCell(c.source?.worksheet ?? ''),
      c.source?.rowNumber ?? '',
      safeCell(c.account ?? ''),
    ]);
  }

  const steps = sheet(wb, 'Steps', [
    'Test Case ID',
    'Step',
    'Action',
    'Status',
    'Duration (ms)',
    'Failure kind',
    'Failure message',
    'Account',
  ]);
  for (const c of r.cases) {
    for (const st of c.steps)
      steps.addRow([
        safeCell(c.caseId),
        st.index + 1,
        safeCell(st.action),
        st.status,
        st.durationMs,
        st.failure?.kind ?? '',
        safeCell(st.failure?.message ?? ''),
        safeCell(c.account ?? ''),
      ]);
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}
