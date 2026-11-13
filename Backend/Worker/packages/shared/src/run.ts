import { z } from 'zod';
import { ExecutionStatus, SourceRef } from './test-case.js';

export const FailureKind = z.enum([
  'assertion', // the application did not behave as the scenario expects
  'timeout', // an awaited condition did not occur in time
  'automation-error', // bad action usage or an unexpected error in the automation itself
  'blocked', // not executable: unknown action, invalid params, missing prerequisites
  'cancelled',
]);
export type FailureKind = z.infer<typeof FailureKind>;

export const Failure = z.object({
  kind: FailureKind,
  message: z.string(),
  expected: z.string().optional(),
  actual: z.string().optional(),
});
export type Failure = z.infer<typeof Failure>;

export const StepResult = z.object({
  index: z.number().int().min(0),
  action: z.string(),
  status: ExecutionStatus,
  durationMs: z.number().min(0),
  failure: Failure.optional(),
});
export type StepResult = z.infer<typeof StepResult>;

/** Explicit, data-only mapping from one test case to typed actions. Never code. */
export const Scenario = z.object({
  schemaVersion: z.literal(1),
  caseId: z.string().min(1),
  description: z.string().optional(),
  steps: z
    .array(
      z.object({
        action: z.string().min(1),
        params: z.record(z.string(), z.unknown()).default({}),
      }),
    )
    .min(1),
});
export type Scenario = z.infer<typeof Scenario>;

export const CaseResult = z.object({
  caseId: z.string(),
  title: z.string().optional(),
  module: z.string().optional(),
  priority: z.string().optional(),
  /** Label of the test account this result was run as. Never a username or password. */
  account: z.string().optional(),
  status: ExecutionStatus,
  startedAt: z.string().optional(),
  endedAt: z.string().optional(),
  durationMs: z.number().optional(),
  steps: z.array(StepResult),
  /** Paths relative to the run's artifact directory. */
  artifacts: z.array(z.string()),
  failure: Failure.optional(),
  source: SourceRef.optional(),
});
export type CaseResult = z.infer<typeof CaseResult>;

export const RunStatus = z.enum(['queued', 'running', 'passed', 'failed', 'cancelled']);
export type RunStatus = z.infer<typeof RunStatus>;

export const Run = z.object({
  id: z.string(),
  status: RunStatus,
  createdAt: z.string(),
  startedAt: z.string().optional(),
  endedAt: z.string().optional(),
  environment: z.string(),
  browser: z.string(),
  workers: z.number().int().min(1),
  cases: z.array(CaseResult),
});
export type Run = z.infer<typeof Run>;

export interface RunSummary {
  total: number;
  counts: Record<ExecutionStatus, number>;
  /** passed / (passed + failed). Blocked, skipped and cancelled cases are not counted as executed. null when nothing executed. */
  passRate: number | null;
}

export function summarizeRun(run: Pick<Run, 'cases'>): RunSummary {
  const counts: Record<ExecutionStatus, number> = {
    queued: 0,
    running: 0,
    passed: 0,
    failed: 0,
    skipped: 0,
    blocked: 0,
    cancelled: 0,
  };
  for (const c of run.cases) counts[c.status]++;
  const executed = counts.passed + counts.failed;
  return {
    total: run.cases.length,
    counts,
    passRate: executed === 0 ? null : counts.passed / executed,
  };
}
