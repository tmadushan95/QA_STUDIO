import { z } from 'zod';

export const SCHEMA_VERSION = 1 as const;

export const AutomationReadiness = z.enum([
  'ready',
  'partially-supported',
  'needs-test-data',
  'needs-new-capability',
  'needs-clarification',
  'manual-only',
]);
export type AutomationReadiness = z.infer<typeof AutomationReadiness>;

export const ExecutionStatus = z.enum([
  'queued',
  'running',
  'passed',
  'failed',
  'skipped',
  'blocked',
  'cancelled',
]);
export type ExecutionStatus = z.infer<typeof ExecutionStatus>;

/** Where a test case came from; carried through runs and reports for traceability. */
export const SourceRef = z.object({
  workbook: z.string().min(1),
  worksheet: z.string().min(1),
  rowNumber: z.number().int().positive(),
});
export type SourceRef = z.infer<typeof SourceRef>;

export const TestStep = z.object({
  order: z.number().int().positive(),
  action: z.string().min(1),
  /** Absent when the workbook gave none. Never invented. */
  expected: z.string().min(1).optional(),
});
export type TestStep = z.infer<typeof TestStep>;

export const TestCase = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  module: z.string().optional(),
  preconditions: z.string().optional(),
  steps: z.array(TestStep),
  expectedResult: z.string().optional(),
  priority: z.string().optional(),
  severity: z.string().optional(),
  testType: z.string().optional(),
  userRole: z.string().optional(),
  tags: z.array(z.string()).default([]),
  dependsOn: z.array(z.string()).default([]),
  readiness: AutomationReadiness.default('needs-clarification'),
  source: SourceRef,
  /** The project it is filed under, from the database. A run uses that project's address and sign-in. */
  projectId: z.number().int().optional(),
  projectName: z.string().optional(),
  /**
   * Filing hints for a new case: the suite and project version a person chose on the Test Design page or for an
   * Azure DevOps import. The API honours them only when it first creates the case; afterwards filing is its own.
   */
  testSuiteId: z.number().int().positive().optional(),
  projectVersionId: z.number().int().positive().optional(),
  // `projectId` above doubles as a hint for a new case: with no suite chosen, its module becomes a suite of that project.
});
export type TestCase = z.infer<typeof TestCase>;
