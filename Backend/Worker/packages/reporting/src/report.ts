import {
  redact,
  summarizeRun,
  type CaseResult,
  type Run,
  type RunSummary,
} from '@qa-studio/shared';

export const REPORT_SCHEMA_VERSION = 1 as const;

export const PASS_RATE_RULE =
  'Pass rate = passed / (passed + failed). Blocked, skipped, cancelled and pending cases are not counted as executed and are reported separately.';

export interface ReportInput {
  run: Run;
  frameworkVersion: string;
  generatedAt?: string;
  /** Action name -> source ('verified' | 'legacy-csharp' | 'example'), to flag unverified behaviour. */
  actionSources?: Record<string, string>;
  /** Configuration problems that affected execution (invalid scenario files, and so on). */
  configIssues?: string[];
}

export interface ModuleCoverage {
  module: string;
  total: number;
  passed: number;
  failed: number;
  blocked: number;
  cancelled: number;
  skipped: number;
  pending: number;
  passRate: number | null;
}

export interface RunReport {
  schemaVersion: typeof REPORT_SCHEMA_VERSION;
  frameworkVersion: string;
  generatedAt: string;
  run: {
    id: string;
    status: Run['status'];
    environment: string;
    browser: string;
    workers: number;
    /** Labels of the test accounts used. Never usernames or passwords. */
    accounts: string[];
    createdAt: string;
    startedAt?: string;
    endedAt?: string;
    durationMs?: number;
  };
  summary: RunSummary & { passRateRule: string };
  coverageByModule: ModuleCoverage[];
  failureClassification: Record<string, number>;
  cases: CaseResult[];
  issues: string[];
  limitations: string[];
}

function coverage(cases: CaseResult[]): ModuleCoverage[] {
  const groups = new Map<string, CaseResult[]>();
  for (const c of cases) {
    const key = c.module ?? '(no module)';
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([module, cs]) => {
      const n = (s: string) => cs.filter((c) => c.status === s).length;
      const passed = n('passed');
      const failed = n('failed');
      return {
        module,
        total: cs.length,
        passed,
        failed,
        blocked: n('blocked'),
        cancelled: n('cancelled'),
        skipped: n('skipped'),
        pending: n('queued') + n('running'),
        passRate: passed + failed === 0 ? null : passed / (passed + failed),
      };
    });
}

/** Build the machine-readable report. Everything is passed through redaction before it leaves this function. */
export function buildReport(input: ReportInput): RunReport {
  const { run } = input;
  const summary = summarizeRun(run);

  const failureClassification: Record<string, number> = {};
  for (const c of run.cases) {
    if (c.failure)
      failureClassification[c.failure.kind] = (failureClassification[c.failure.kind] ?? 0) + 1;
  }

  const issues = [...(input.configIssues ?? [])];
  const blockedReasons = new Map<string, string[]>();
  for (const c of run.cases) {
    if (c.status === 'blocked' && c.failure) {
      blockedReasons.set(c.failure.message, [
        ...(blockedReasons.get(c.failure.message) ?? []),
        c.caseId,
      ]);
    }
  }
  for (const [reason, ids] of blockedReasons) {
    issues.push(
      `${ids.length} case(s) blocked (${ids.slice(0, 5).join(', ')}${ids.length > 5 ? ', …' : ''}): ${reason}`,
    );
  }

  const limitations = [PASS_RATE_RULE];
  if (['queued', 'running'].includes(run.status))
    limitations.push(
      'The run was still in progress when this report was generated; results are partial.',
    );
  if (summary.counts.cancelled > 0)
    limitations.push(`${summary.counts.cancelled} case(s) were cancelled before completing.`);
  if (summary.counts.blocked > 0)
    limitations.push(
      'Blocked cases were not executed, so coverage is lower than the selected scope suggests.',
    );
  if (failureClassification['timeout']) {
    limitations.push(
      'Failure classification cannot distinguish an application defect from an environment outage; review timeouts before logging defects.',
    );
  }
  const used = new Set(run.cases.flatMap((c) => c.steps.map((s) => s.action)));
  const unverified = [...used]
    .filter((a) => input.actionSources?.[a] !== undefined && input.actionSources[a] !== 'verified')
    .sort();
  if (unverified.length > 0) {
    limitations.push(
      `These actions are not verified against the live application: ${unverified.join(', ')}.`,
    );
  }

  const durationMs =
    run.startedAt && run.endedAt ? Date.parse(run.endedAt) - Date.parse(run.startedAt) : undefined;
  const report: RunReport = {
    schemaVersion: REPORT_SCHEMA_VERSION,
    frameworkVersion: input.frameworkVersion,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    run: {
      id: run.id,
      status: run.status,
      environment: run.environment,
      browser: run.browser,
      workers: run.workers,
      accounts: [
        ...new Set(run.cases.map((c) => c.account).filter((a): a is string => !!a)),
      ].sort(),
      createdAt: run.createdAt,
      ...(run.startedAt !== undefined && { startedAt: run.startedAt }),
      ...(run.endedAt !== undefined && { endedAt: run.endedAt }),
      ...(durationMs !== undefined && { durationMs }),
    },
    summary: { ...summary, passRateRule: PASS_RATE_RULE },
    coverageByModule: coverage(run.cases),
    failureClassification,
    cases: run.cases,
    issues,
    limitations,
  };
  return redact(report) as RunReport;
}
