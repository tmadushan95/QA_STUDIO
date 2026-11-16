import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import type { Run } from '@qa-studio/shared';
import { buildReport, renderExcel, renderHtml, REPORT_SCHEMA_VERSION } from './index.js';

const run: Run = {
  id: 'run-aaaa-bbbb',
  status: 'failed',
  createdAt: '2026-01-01T00:00:00.000Z',
  startedAt: '2026-01-01T00:00:01.000Z',
  endedAt: '2026-01-01T00:00:06.500Z',
  environment: 'qa',
  browser: 'chromium',
  workers: 2,
  cases: [
    {
      caseId: 'TC-1',
      title: 'Create',
      module: 'Projects',
      status: 'passed',
      durationMs: 700,
      steps: [{ index: 0, action: 'app.open', status: 'passed', durationMs: 20 }],
      artifacts: [],
      source: { workbook: 'plan.xlsx', worksheet: 'Projects', rowNumber: 2 },
    },
    {
      caseId: 'TC-2',
      title: '<img src=x onerror=alert(1)>',
      module: 'Projects',
      status: 'failed',
      durationMs: 2300,
      steps: [
        {
          index: 0,
          action: 'assert.text-visible',
          status: 'failed',
          durationMs: 2000,
          failure: { kind: 'assertion', message: 'Expected text' },
        },
      ],
      failure: {
        kind: 'assertion',
        message: '=HYPERLINK("http://evil")',
        expected: 'Saved',
        actual: 'not visible',
      },
      artifacts: ['TC-2/failure.png'],
      source: { workbook: 'plan.xlsx', worksheet: 'Projects', rowNumber: 3 },
    },
    {
      caseId: 'TC-3',
      status: 'failed',
      steps: [],
      artifacts: [],
      failure: { kind: 'timeout', message: 'Step exceeded 5 ms Bearer abc.def.ghi' },
    },
    {
      caseId: 'TC-10',
      title: 'Approve',
      module: 'Approvals',
      status: 'blocked',
      steps: [],
      artifacts: [],
      failure: { kind: 'blocked', message: 'No approved scenario is mapped to this test case.' },
    },
    {
      caseId: 'TC-11',
      module: 'Approvals',
      status: 'blocked',
      steps: [],
      artifacts: [],
      failure: { kind: 'blocked', message: 'No approved scenario is mapped to this test case.' },
    },
  ],
};

const base = { run, frameworkVersion: '0.1.0', generatedAt: '2026-01-01T01:00:00.000Z' };

describe('buildReport', () => {
  const r = buildReport({
    ...base,
    actionSources: { 'app.open': 'verified', 'assert.text-visible': 'legacy-csharp' },
    configIssues: ['Invalid scenario file b.json'],
  });

  it('captures run metadata, duration, summary and the pass-rate rule', () => {
    expect(r).toMatchObject({
      schemaVersion: REPORT_SCHEMA_VERSION,
      frameworkVersion: '0.1.0',
      run: { id: 'run-aaaa-bbbb', environment: 'qa', durationMs: 5500 },
    });
    expect(r.summary.counts).toMatchObject({ passed: 1, failed: 2, blocked: 2 });
    expect(r.summary.passRate).toBeCloseTo(1 / 3);
    expect(r.summary.passRateRule).toMatch(/passed \/ \(passed \+ failed\)/);
  });

  it('computes coverage by module, with a bucket for cases without one', () => {
    expect(r.coverageByModule).toEqual([
      expect.objectContaining({ module: '(no module)', total: 1, failed: 1, passRate: 0 }),
      expect.objectContaining({ module: 'Approvals', total: 2, blocked: 2, passRate: null }),
      expect.objectContaining({
        module: 'Projects',
        total: 2,
        passed: 1,
        failed: 1,
        passRate: 0.5,
      }),
    ]);
  });

  it('classifies failures and groups blocked reasons into issues', () => {
    expect(r.failureClassification).toEqual({ assertion: 1, timeout: 1, blocked: 2 });
    expect(r.issues).toContain('Invalid scenario file b.json');
    expect(r.issues).toContain(
      '2 case(s) blocked (TC-10, TC-11): No approved scenario is mapped to this test case.',
    );
  });

  it('states limitations honestly, including unverified actions and timeout ambiguity', () => {
    const text = r.limitations.join('\n');
    expect(text).toMatch(/not verified against the live application: assert.text-visible\./);
    expect(text).not.toMatch(/app\.open[,.]/);
    expect(text).toMatch(/cannot distinguish an application defect from an environment outage/);
    expect(text).toMatch(/Blocked cases were not executed/);
  });

  it('redacts secrets and flags in-progress runs', () => {
    expect(JSON.stringify(r)).not.toContain('abc.def.ghi');
    const partial = buildReport({
      ...base,
      run: { ...run, status: 'running', endedAt: undefined },
    });
    expect(partial.limitations.join(' ')).toMatch(/still in progress/);
    expect(partial.run.durationMs).toBeUndefined();
  });
});

describe('shared failure objects', () => {
  it('keeps the case-level failure when it is the same object as a step failure', () => {
    const failure = { kind: 'assertion' as const, message: 'boom', expected: 'a', actual: 'b' };
    const shared: Run = {
      ...run,
      cases: [
        {
          caseId: 'S',
          status: 'failed',
          steps: [{ index: 0, action: 'x', status: 'failed', durationMs: 1, failure }],
          failure,
          artifacts: [],
        },
      ],
    };
    const r = buildReport({ ...base, run: shared });
    expect(r.cases[0]!.failure).toEqual(failure);
    expect(r.failureClassification).toEqual({ assertion: 1 });
    expect(renderHtml(r)).toContain('Expected: a');
  });
});

describe('renderHtml', () => {
  const html = renderHtml(buildReport(base));
  it('escapes untrusted test case text and forbids scripts', () => {
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain("default-src 'none'");
    expect(html).not.toMatch(/<script/i);
  });
  it('includes the required report sections', () => {
    for (const s of [
      'Execution ID',
      'run-aaaa-bbbb',
      'Pass rate: 33%',
      'Coverage by module',
      'Failure classification',
      'Known limitations',
      'plan.xlsx › Projects › row 3',
      'Expected: Saved',
      'TC-2/failure.png',
    ]) {
      expect(html, s).toContain(s);
    }
  });
});

describe('renderExcel', () => {
  it('produces the expected sheets with traceability and neutralized formulas', async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await renderExcel(buildReport(base))) as unknown as ExcelJS.Buffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual([
      'Summary',
      'Coverage by module',
      'Cases',
      'Steps',
    ]);
    const cases = wb.getWorksheet('Cases')!;
    expect(cases.rowCount).toBe(6);
    const tc2 = cases.getRow(3);
    expect(tc2.getCell(1).value).toBe('TC-2');
    expect(tc2.getCell(8).value).toBe(`'=HYPERLINK("http://evil")`);
    expect([tc2.getCell(12).value, tc2.getCell(13).value, tc2.getCell(14).value]).toEqual([
      'plan.xlsx',
      'Projects',
      3,
    ]);
    expect(wb.getWorksheet('Steps')!.rowCount).toBe(3);
    const summary = wb.getWorksheet('Summary')!;
    const passRate = summary
      .getRows(1, summary.rowCount)!
      .find((row) => row.getCell(1).value === 'Pass rate')!;
    expect(passRate.getCell(2).value).toBe(0.33);
  });
});

describe('accounts in reports', () => {
  const accountRun: Run = {
    ...run,
    cases: [
      {
        caseId: 'TC-1',
        module: 'Projects',
        account: 'Approver',
        status: 'passed',
        steps: [
          {
            index: 0,
            action: 'auth.sign-in',
            description: 'Sign in',
            status: 'passed',
            durationMs: 5,
          },
        ],
        artifacts: [],
      },
      {
        caseId: 'TC-1',
        module: 'Projects',
        account: 'Requester <b>',
        status: 'failed',
        steps: [],
        artifacts: [],
        failure: { kind: 'assertion', message: 'nope' },
      },
    ],
  };
  const r = buildReport({ ...base, run: accountRun });

  it('lists the account labels used, as labels only', () => {
    expect(r.run.accounts).toEqual(['Approver', 'Requester <b>']);
    expect(buildReport(base).run.accounts).toEqual([]);
  });

  it('shows the account on each result in HTML (escaped) and Excel', async () => {
    const html = renderHtml(r);
    expect(html).toContain('as Approver');
    expect(html).toContain('Signed in as');
    expect(html).toContain('as Requester &lt;b&gt;');
    expect(html).not.toContain('Requester <b>');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await renderExcel(r)) as unknown as ExcelJS.Buffer);
    const cases = wb.getWorksheet('Cases')!;
    expect(cases.getRow(1).getCell(15).value).toBe('Account');
    expect([cases.getRow(2).getCell(15).value, cases.getRow(3).getCell(15).value]).toEqual([
      'Approver',
      'Requester <b>',
    ]);
    expect(wb.getWorksheet('Steps')!.getRow(2).getCell(8).value).toBe('Approver');
  });

  it('shows each step as a sentence, keeping the action name as a hint', async () => {
    expect(renderHtml(r)).toContain('<span title="auth.sign-in">Sign in</span>');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await renderExcel(r)) as unknown as ExcelJS.Buffer);
    const steps = wb.getWorksheet('Steps')!;
    expect(steps.getRow(1).getCell(9).value).toBe('Description');
    expect(steps.getRow(2).getCell(9).value).toBe('Sign in');
  });
});
