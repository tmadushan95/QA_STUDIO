/**
 * A fake API for UI tests: answers `fetch` by method and path from a small in-memory state, and records every call,
 * so tests check what the UI sent (for example "only the changed values were saved").
 */
import { vi } from 'vitest';
import type { TestCase } from '@qa-studio/shared';

export interface Call {
  method: string;
  path: string;
  /** The query string, such as `?projectId=1`, or ''. */
  query: string;
  body: unknown;
}

export type Handler = (body: unknown, url: URL) => unknown;

export const tc = (id: string, over: Partial<TestCase> = {}): TestCase => ({
  schemaVersion: 1,
  id,
  title: `Title ${id}`,
  module: 'Projects',
  priority: 'High',
  steps: [{ order: 1, action: 'Click Delete' }],
  tags: [],
  dependsOn: [],
  readiness: 'needs-clarification',
  source: { workbook: 'plan.xlsx', worksheet: 'Cases', rowNumber: 2 },
  // Every case the API returns is filed in a project; pages show the cases of the project in the header.
  projectId: 1,
  ...over,
});

/** The step actions the editor offers, as the server describes them. */
export const ACTIONS = [
  {
    // Written for one application; the server derives its form from the parameter schema.
    name: 'roles.assert-permission',
    description: 'Assert a permission is listed.',
    destructive: false,
    source: 'app-source',
    ui: {
      label: 'Roles: assert permission',
      group: 'Application',
      summary: 'Roles: assert permission',
      fields: [
        { name: 'role', label: 'Role', kind: 'text', required: true },
        { name: 'resource', label: 'Resource', kind: 'text', required: true },
        { name: 'action', label: 'Action', kind: 'text', required: true },
      ],
    },
  },
  {
    // A step the General project defined for itself (Project settings › Custom steps).
    name: 'custom.1.check-permission',
    description: 'Check a permission.',
    destructive: false,
    source: 'example',
    projectId: 1,
    ui: {
      label: 'Check a permission',
      group: 'Custom',
      summary: 'Check a permission',
      fields: [{ name: 'role', label: 'Role', kind: 'text', required: true }],
    },
  },
  {
    name: 'custom.2.other-project',
    description: 'Belongs to another project.',
    destructive: false,
    source: 'example',
    projectId: 2,
    ui: { label: 'Other project step', group: 'Custom', summary: 'x', fields: [] },
  },
  {
    name: 'click',
    description: 'Click',
    destructive: false,
    source: 'generic',
    ui: {
      label: 'Click',
      group: 'Interact',
      summary: 'Click {target}',
      fields: [
        { name: 'target', label: 'Element', kind: 'target', required: true },
        { name: 'destructive', label: 'Changes or deletes data', kind: 'boolean' },
      ],
    },
  },
  {
    name: 'fill',
    description: 'Fill',
    destructive: false,
    source: 'generic',
    ui: {
      label: 'Fill field',
      group: 'Interact',
      summary: 'Fill {target} with {value}',
      fields: [
        { name: 'target', label: 'Field', kind: 'target', required: true },
        { name: 'value', label: 'Value', kind: 'text', required: true },
      ],
    },
  },
  {
    name: 'assert-text',
    description: 'Check text',
    destructive: false,
    source: 'generic',
    ui: {
      label: 'Check text is shown',
      group: 'Check',
      summary: 'Check “{text}” is shown',
      fields: [{ name: 'text', label: 'Text', kind: 'text', required: true }],
    },
  },
];

/** The one project and suite tests start with. */
export const PROJECT = {
  id: 1,
  code: 'GENERAL',
  name: 'General',
  isActive: true,
  suiteCount: 1,
  testCaseCount: 2,
  rowVersion: 'AAA=',
};
export const CONNECTION = {
  projectId: 1,
  envName: 'qa',
  appUrl: 'https://qa.example.com',
  login: { strategy: 'none', path: '/login', signedInMarker: '' },
  ready: true,
};
export const SUITE = {
  id: 7,
  projectId: 1,
  projectName: 'General',
  name: 'Projects',
  sortOrder: 0,
  isActive: true,
  testCaseCount: 2,
  rowVersion: 'AAA=',
};

/** The one project version tests start with. */
export const VERSION = {
  id: 3,
  projectId: 1,
  projectName: 'General',
  name: '1.0',
  isCurrent: true,
  isActive: true,
  testCaseCount: 1,
  rowVersion: 'AAA=',
};

/** Default answers; a test overrides any route with `routes`. */
export function defaults(cases: TestCase[] = [tc('TC_1'), tc('TC_2')]): Record<string, Handler> {
  return {
    'GET /api/auth/status': () => ({ required: false, authenticated: true }),
    'GET /api/automation': () => ({
      runsAvailable: true,
      environment: 'qa',
      loginRequired: false,
      workers: 1,
      scenarioCount: 1,
      actions: ACTIONS,
      capabilities: ['api-parameters', 'azure-devops', 'ai-case-steps', 'custom-steps'],
    }),
    'GET /api/custom-steps/1': () => ({ items: [] }),
    'GET /api/pages': () => ({
      items: [{ name: 'Projects', route: '/projects', marker: 'Projects' }],
    }),
    'GET /api/test-cases': () => ({ total: cases.length, page: 1, pageSize: 200, items: cases }),
    'GET /api/projects': () => ({ items: [PROJECT] }),
    'GET /api/project-connections': () => ({ items: [CONNECTION], allowedEnvs: ['qa', 'uat'] }),
    'POST /api/project-connections/check': () => undefined,
    'GET /api/accounts': () => ({ items: [] }),
    'POST /api/runs/plan': (b) => ({
      workers: 1,
      groups: [
        {
          projectId: 1,
          projectName: 'General',
          caseCount: (b as { caseIds: string[] }).caseIds.length,
          environment: 'qa',
          appUrl: 'https://qa.example.com',
          loginRequired: false,
          available: true,
          accounts: [],
        },
      ],
    }),
    'GET /api/test-suites': () => ({ items: [SUITE] }),
    'GET /api/scenarios': () => ({
      items: cases.map((c, i) =>
        i === 0
          ? { caseId: c.id, state: 'approved', version: 1, steps: 1, hasDraft: false }
          : { caseId: c.id, state: 'none', hasDraft: false },
      ),
    }),
    'GET /api/scenarios/TC_1': () => ({
      approved: {
        caseId: 'TC_1',
        scenario: {
          steps: [{ action: 'click', params: { target: { role: 'button', name: 'Delete' } } }],
        },
        status: 'approved',
        origin: 'manual',
        version: 1,
        updatedAt: '2026-01-01T00:00:00Z',
        issues: [],
        warnings: [],
      },
    }),
    'POST /api/scenarios/validate': (b) => ({
      steps: ((b as { steps: unknown[] }).steps ?? []).map((_, index) => ({
        index,
        issues: [],
        warnings: [],
      })),
    }),
    'GET /api/parameters': () => ({
      items: [{ caseId: 'TC_1', needed: 2, missing: ['project'] }],
    }),
    'GET /api/parameters/TC_1': () => ({
      caseId: 'TC_1',
      items: [
        { name: 'project', value: '', source: 'missing', used: true },
        { name: 'role', value: 'Admin', source: 'case', used: true },
      ],
      missing: ['project'],
    }),
    'GET /api/parameters/common/1': () => ({
      projectId: 1,
      items: [{ name: 'project', value: '', usedBy: 2, overriddenBy: 0 }],
    }),
    'GET /api/ai/jobs': () => ({ items: [] }),
    'GET /api/ai/explore': () => ({ defaultPaths: ['/projects'], max: 10 }),
    'GET /api/project-versions': () => ({ items: [VERSION] }),
    'GET /api/ai': () => ({ provider: 'none', ready: false, reason: 'Choose a provider.' }),
    'GET /api/insights': () => ({
      totalCases: cases.length,
      totalProjects: 1,
      totalSuites: 1,
      totalVersions: 1,
      byProject: [{ key: '1', label: 'General', count: cases.length }],
      byVersion: [{ key: '3', label: 'General · 1.0', count: 1 }],
      bySuite: [{ key: '7', label: 'Projects', count: cases.length }],
      byPriority: [{ key: 'High', label: 'High', count: cases.length }],
      byReadiness: [],
      addedPerDay: [],
    }),
    'GET /api/conversions': () => ({ items: [] }),
    'GET /api/runs': () => ({ items: [] }),
    'GET /api/dashboard': () => ({
      totals: { cases: cases.length, withScenario: 1, withoutScenario: cases.length - 1 },
      latest: { passed: 0, failed: 0, blocked: 0, notRun: cases.length, passRate: null },
      modules: [],
      trend: [],
      recentRuns: [],
      highPriorityFailures: [],
      definitions: ['Pass rate = passed / (passed + failed).'],
    }),
  };
}

/** Install the fake `fetch`. Unknown routes answer 404 so a missing route fails loudly in the test. */
export function fakeServer(routes: Record<string, Handler> = {}) {
  const calls: Call[] = [];
  const all = { ...defaults(), ...routes };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input, 'http://app.test');
      const method = init?.method ?? 'GET';
      let body: unknown;
      try {
        body = typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body;
      } catch {
        body = init?.body;
      }
      calls.push({ method, path: url.pathname, query: url.search, body });
      const h = all[`${method} ${url.pathname}`];
      if (!h)
        return new Response(
          JSON.stringify({ error: { message: `No fake for ${method} ${url.pathname}` } }),
          { status: 404 },
        );
      try {
        const out = h(body, url);
        if (out instanceof Response) return out;
        return new Response(JSON.stringify(out ?? {}), { status: method === 'POST' ? 200 : 200 });
      } catch (e) {
        return new Response(JSON.stringify({ error: { message: String(e) } }), { status: 500 });
      }
    }),
  );
  return {
    calls,
    sent: (method: string, path: string) =>
      calls.filter((c) => c.method === method && c.path === path),
  };
}

/** An error answer with the server's error shape. */
export const httpError = (
  status: number,
  message: string,
  code = '',
  fields?: Record<string, string>,
) =>
  new Response(JSON.stringify({ error: { message, code, ...(fields && { fields }) } }), { status });
