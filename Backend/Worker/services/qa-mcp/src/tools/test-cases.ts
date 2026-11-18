import { z } from 'zod';
import { confirmDelete } from '../confirm.js';
import { DESTRUCTIVE, enc, guard, q, READ, REPLACE, WRITE, type ToolContext } from '../result.js';

interface TestCase {
  id: string;
  title: string;
  description?: string | null;
  module?: string | null;
  preconditions?: string | null;
  steps: { order: number; action: string; expected?: string | null }[];
  expectedResult?: string | null;
  priority?: string | null;
  severity?: string | null;
  testType?: string | null;
  userRole?: string | null;
  tags: string[];
  readiness: string;
  testSuiteId: number;
  testSuiteName: string;
  projectId: number;
  projectName: string;
  projectVersionId?: number | null;
  projectVersionName?: string | null;
  rowVersion: string;
}
interface Page {
  total: number;
  page: number;
  pageSize: number;
  items: TestCase[];
}

const CaseId = z.string().trim().min(1).max(200);
const CaseIds = z.array(CaseId).min(1).max(500);
const Text = (max: number) => z.string().max(max);

/** The fields of a written (manual) test case, shared by create and update. */
const content = {
  title: z.string().trim().min(1).max(500),
  description: Text(4000).optional(),
  module: Text(200).optional(),
  preconditions: Text(4000).optional(),
  steps: z
    .array(
      z.object({
        action: z.string().trim().min(1).max(2000).describe('What the tester does'),
        expected: Text(2000)
          .optional()
          .describe('What should happen, when this step checks something'),
      }),
    )
    .max(200)
    .optional()
    .describe('Written steps in order. Plain language, not automation.'),
  expectedResult: Text(4000).optional(),
  priority: Text(50).optional().describe('Such as High, Medium or Low'),
  severity: Text(50).optional(),
  testType: Text(100).optional(),
  userRole: Text(200).optional(),
  tags: z.array(z.string().trim().min(1).max(100)).max(30).optional(),
};

/** A short line per case for lists, so a page of results stays small. */
const summary = (c: TestCase) => ({
  id: c.id,
  title: c.title,
  module: c.module ?? undefined,
  priority: c.priority ?? undefined,
  readiness: c.readiness,
  suite: c.testSuiteName,
  project: c.projectName,
  version: c.projectVersionName ?? undefined,
});

/** Written test cases: what to test, in plain language. Automation lives apart, in scenarios. */
export function registerTestCaseTools(ctx: ToolContext): void {
  const { server, api, toolsets } = ctx;

  server.registerTool(
    'search_test_cases',
    {
      title: 'Search test cases',
      description:
        'Find test cases by words in their ID or title, and by project, suite, version, module or priority. Returns one page of short summaries; use get_test_case for the full case.',
      inputSchema: {
        query: z.string().max(200).optional().describe('Words to look for; empty lists everything'),
        projectId: z.number().int().positive().optional(),
        suiteId: z.number().int().positive().optional(),
        versionId: z.number().int().positive().optional(),
        module: z.string().max(200).optional(),
        priority: Text(50).optional().describe('Such as High, Medium or Low'),
        page: z.number().int().min(1).optional(),
        limit: z.number().int().min(1).max(100).optional(),
      },
      annotations: READ,
    },
    (i) =>
      guard(async () => {
        const r = (await api.get(
          `/api/test-cases${q({
            projectId: i.projectId ?? ctx.defaultProjectId,
            testSuiteId: i.suiteId,
            projectVersionId: i.versionId,
            q: i.query,
            module: i.module,
            priority: i.priority,
            page: i.page,
            pageSize: i.limit ?? 25,
          })}`,
        )) as Page;
        return {
          total: r.total,
          page: r.page,
          items: r.items.map(summary),
          ...(r.page * r.pageSize < r.total && { nextPage: r.page + 1 }),
        };
      }),
  );

  server.registerTool(
    'get_test_case',
    {
      title: 'Get a test case',
      description:
        'The full written test case: preconditions, steps, expected result, tags, suite and version.',
      inputSchema: { id: CaseId },
      annotations: READ,
    },
    ({ id }) => guard(() => api.get(`/api/test-cases/${enc(id)}`)),
  );

  server.registerTool(
    'get_next_case_id',
    {
      title: 'Next free test case ID',
      description: "The ID the next new test case gets in the project's own format, such as TC_42.",
      annotations: READ,
    },
    () => guard(() => api.get('/api/test-cases/next-id')),
  );

  if (toolsets.has('author')) {
    server.registerTool(
      'create_test_case',
      {
        title: 'Create a test case',
        description:
          'Add one written test case to a suite. Leave id out to get the next free ID. To create several from a requirement, propose_test_cases is usually better.',
        inputSchema: {
          suiteId: z.number().int().positive(),
          versionId: z.number().int().positive().optional(),
          id: CaseId.optional(),
          ...content,
        },
        annotations: WRITE,
      },
      ({ suiteId, versionId, steps, ...rest }) =>
        guard(() =>
          api.send('POST', '/api/test-cases', {
            ...rest,
            testSuiteId: suiteId,
            ...(versionId !== undefined && { projectVersionId: versionId }),
            ...(steps && { writtenSteps: steps }),
          }),
        ),
    );

    server.registerTool(
      'update_test_case',
      {
        title: 'Update a test case',
        description:
          'Change a written test case. Only the fields you pass change; steps, when passed, replace all steps. The automation (scenario) is not touched.',
        inputSchema: {
          id: CaseId,
          suiteId: z.number().int().positive().optional().describe('Move it to this suite'),
          ...content,
          title: content.title.optional(),
        },
        annotations: REPLACE,
      },
      ({ id, suiteId, steps, ...change }) =>
        guard(async () => {
          const c = (await api.get(`/api/test-cases/${enc(id)}`)) as TestCase;
          const keep = <T>(next: T | undefined, now: T | null | undefined) => next ?? now ?? null;
          return api.send('PUT', `/api/test-cases/${enc(id)}`, {
            title: change.title ?? c.title,
            description: keep(change.description, c.description),
            module: keep(change.module, c.module),
            preconditions: keep(change.preconditions, c.preconditions),
            expectedResult: keep(change.expectedResult, c.expectedResult),
            priority: keep(change.priority, c.priority),
            severity: keep(change.severity, c.severity),
            testType: keep(change.testType, c.testType),
            userRole: keep(change.userRole, c.userRole),
            tags: change.tags ?? c.tags,
            // Left out, the API keeps the current steps.
            ...(steps && { writtenSteps: steps }),
            testSuiteId: suiteId ?? c.testSuiteId,
            rowVersion: c.rowVersion,
          });
        }),
    );

    server.registerTool(
      'move_test_cases',
      {
        title: 'Move test cases',
        description: 'Move test cases to another suite.',
        inputSchema: { ids: CaseIds, suiteId: z.number().int().positive() },
        annotations: REPLACE,
      },
      ({ ids, suiteId }) =>
        guard(() => api.send('POST', '/api/test-cases/move', { ids, testSuiteId: suiteId })),
    );

    server.registerTool(
      'reorder_test_cases',
      {
        title: 'Reorder test cases',
        description:
          'Set the order of test cases within their suite: the IDs in the order they should appear.',
        inputSchema: { ids: CaseIds },
        annotations: REPLACE,
      },
      ({ ids }) => guard(() => api.send('POST', '/api/test-cases/reorder', { ids })),
    );

    server.registerTool(
      'assign_test_cases_version',
      {
        title: 'Assign a version to test cases',
        description: 'File test cases under a project version, or leave versionId out to clear it.',
        inputSchema: { ids: CaseIds, versionId: z.number().int().positive().optional() },
        annotations: REPLACE,
      },
      ({ ids, versionId }) =>
        guard(() =>
          api.send('POST', '/api/test-cases/assign-version', {
            ids,
            projectVersionId: versionId ?? null,
          }),
        ),
    );
  }

  if (toolsets.has('admin')) {
    server.registerTool(
      'delete_test_cases',
      {
        title: 'Delete test cases',
        description:
          'Permanently delete test cases and their automation. confirm must be the IDs joined with ", " in the same order.',
        inputSchema: { ids: z.array(CaseId).min(1).max(50), confirm: z.string().max(12_000) },
        annotations: DESTRUCTIVE,
      },
      ({ ids, confirm }) =>
        guard(async () => {
          const list = ids.join(', ');
          await confirmDelete(server, `test cases ${list}`, list, confirm);
          return api.send('POST', '/api/test-cases/delete', { ids });
        }),
    );
  }
}
