import { z } from 'zod';
import { confirmDelete } from '../confirm.js';
import {
  DESTRUCTIVE,
  guard,
  itemsOf,
  q,
  READ,
  REPLACE,
  WRITE,
  type ToolContext,
} from '../result.js';

interface Project {
  id: number;
  code: string;
  name: string;
  description?: string | null;
  isActive: boolean;
  rowVersion: string;
}
interface ProjectVersion {
  id: number;
  projectId: number;
  name: string;
  description?: string | null;
  releaseDate?: string | null;
  isCurrent: boolean;
  isActive: boolean;
  rowVersion: string;
}
interface Suite {
  id: number;
  projectId: number;
  name: string;
  description?: string | null;
  sortOrder: number;
  isActive: boolean;
  rowVersion: string;
}

const Id = z.number().int().positive();
const Name = z.string().trim().min(1).max(200);
const Description = z.string().max(2000);
const ReleaseDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.')
  .describe('Release date, YYYY-MM-DD');

/** Projects, their versions and test suites: the folders every test case lives in. */
export function registerProjectTools(ctx: ToolContext): void {
  const { server, api, toolsets } = ctx;
  const version = async (id: number) => {
    const found = itemsOf<ProjectVersion>(await api.get('/api/project-versions')).find(
      (v) => v.id === id,
    );
    if (!found) throw new Error(`There is no project version ${id}.`);
    return found;
  };

  server.registerTool(
    'list_projects',
    {
      title: 'List projects',
      description:
        'Every project with its code, suite count and test case count. Start here to find the project ID other tools need.',
      annotations: READ,
    },
    () => guard(async () => ({ items: itemsOf(await api.get('/api/projects')) })),
  );

  server.registerTool(
    'get_project',
    {
      title: 'Get a project',
      description: 'One project, with its versions and test suites.',
      inputSchema: { projectId: Id },
      annotations: READ,
    },
    ({ projectId }) =>
      guard(async () => ({
        project: await api.get(`/api/projects/${projectId}`),
        versions: itemsOf(await api.get(`/api/project-versions${q({ projectId })}`)),
        suites: itemsOf(await api.get(`/api/test-suites${q({ projectId })}`)),
      })),
  );

  server.registerTool(
    'list_project_versions',
    {
      title: 'List project versions',
      description:
        'Releases of a project (or of every project). The current one is marked isCurrent.',
      inputSchema: { projectId: Id.optional() },
      annotations: READ,
    },
    ({ projectId }) =>
      guard(async () => ({
        items: itemsOf(
          await api.get(
            `/api/project-versions${q({ projectId: projectId ?? ctx.defaultProjectId })}`,
          ),
        ),
      })),
  );

  server.registerTool(
    'list_test_suites',
    {
      title: 'List test suites',
      description:
        'Test suites of a project (or of every project), with how many cases each holds.',
      inputSchema: { projectId: Id.optional() },
      annotations: READ,
    },
    ({ projectId }) =>
      guard(async () => ({
        items: itemsOf(
          await api.get(`/api/test-suites${q({ projectId: projectId ?? ctx.defaultProjectId })}`),
        ),
      })),
  );

  server.registerTool(
    'get_test_suite',
    {
      title: 'Get a test suite',
      description:
        'One test suite: its project, order, whether it is active and how many cases it holds.',
      inputSchema: { suiteId: Id },
      annotations: READ,
    },
    ({ suiteId }) => guard(() => api.get(`/api/test-suites/${suiteId}`)),
  );

  server.registerTool(
    'list_pages',
    {
      title: 'List app pages',
      description:
        'The named pages of the app under test (name, route, marker). Steps that open a page use these names.',
      inputSchema: { projectId: Id.optional() },
      annotations: READ,
    },
    ({ projectId }) =>
      guard(async () => ({
        items: itemsOf(
          await api.get(`/api/pages${q({ projectId: projectId ?? ctx.defaultProjectId })}`),
        ),
      })),
  );

  if (toolsets.has('author')) {
    server.registerTool(
      'create_project',
      {
        title: 'Create a project',
        description: 'Add a project. The code is short and unique, such as "CRM".',
        inputSchema: {
          code: z.string().trim().min(1).max(20),
          name: Name,
          description: Description.optional(),
        },
        annotations: WRITE,
      },
      (input) => guard(() => api.send('POST', '/api/projects', input)),
    );

    server.registerTool(
      'update_project',
      {
        title: 'Update a project',
        description: 'Change a project. Only the fields you pass change.',
        inputSchema: {
          projectId: Id,
          code: z.string().trim().min(1).max(20).optional(),
          name: Name.optional(),
          description: Description.optional(),
          isActive: z.boolean().optional(),
        },
        annotations: REPLACE,
      },
      ({ projectId, ...change }) =>
        guard(async () => {
          const p = (await api.get(`/api/projects/${projectId}`)) as Project;
          return api.send('PUT', `/api/projects/${projectId}`, {
            code: change.code ?? p.code,
            name: change.name ?? p.name,
            description: change.description ?? p.description ?? null,
            isActive: change.isActive ?? p.isActive,
            rowVersion: p.rowVersion,
          });
        }),
    );

    server.registerTool(
      'create_project_version',
      {
        title: 'Create a project version',
        description:
          'Add a release to a project. isCurrent makes it the version new work is filed under.',
        inputSchema: {
          projectId: Id,
          name: Name,
          description: Description.optional(),
          releaseDate: ReleaseDate.optional(),
          isCurrent: z.boolean().optional(),
        },
        annotations: WRITE,
      },
      (input) => guard(() => api.send('POST', '/api/project-versions', input)),
    );

    server.registerTool(
      'update_project_version',
      {
        title: 'Update a project version',
        description: 'Change a release. Only the fields you pass change.',
        inputSchema: {
          versionId: Id,
          name: Name.optional(),
          description: Description.optional(),
          releaseDate: ReleaseDate.optional(),
          isCurrent: z.boolean().optional(),
          isActive: z.boolean().optional(),
        },
        annotations: REPLACE,
      },
      ({ versionId, ...change }) =>
        guard(async () => {
          const v = await version(versionId);
          return api.send('PUT', `/api/project-versions/${versionId}`, {
            name: change.name ?? v.name,
            description: change.description ?? v.description ?? null,
            releaseDate: change.releaseDate ?? v.releaseDate ?? null,
            isCurrent: change.isCurrent ?? v.isCurrent,
            isActive: change.isActive ?? v.isActive,
            rowVersion: v.rowVersion,
          });
        }),
    );

    server.registerTool(
      'create_test_suite',
      {
        title: 'Create a test suite',
        description: 'Add a test suite (a folder of test cases) to a project.',
        inputSchema: {
          projectId: Id,
          name: Name,
          description: Description.optional(),
          sortOrder: z.number().int().min(0).optional(),
        },
        annotations: WRITE,
      },
      (input) => guard(() => api.send('POST', '/api/test-suites', input)),
    );

    server.registerTool(
      'update_test_suite',
      {
        title: 'Update a test suite',
        description: 'Change a test suite. Only the fields you pass change.',
        inputSchema: {
          suiteId: Id,
          name: Name.optional(),
          description: Description.optional(),
          sortOrder: z.number().int().min(0).optional(),
          isActive: z.boolean().optional(),
        },
        annotations: REPLACE,
      },
      ({ suiteId, ...change }) =>
        guard(async () => {
          const s = (await api.get(`/api/test-suites/${suiteId}`)) as Suite;
          return api.send('PUT', `/api/test-suites/${suiteId}`, {
            name: change.name ?? s.name,
            description: change.description ?? s.description ?? null,
            sortOrder: change.sortOrder ?? s.sortOrder,
            isActive: change.isActive ?? s.isActive,
            rowVersion: s.rowVersion,
          });
        }),
    );
  }

  if (toolsets.has('admin')) {
    const confirm = z.string().max(200).describe('Type the name of what you delete, exactly');

    server.registerTool(
      'delete_project',
      {
        title: 'Delete a project',
        description:
          'Permanently delete a project. confirm must be the project code. The person is asked to confirm when the client supports it.',
        inputSchema: { projectId: Id, confirm },
        annotations: DESTRUCTIVE,
      },
      ({ projectId, confirm: given }) =>
        guard(async () => {
          const p = (await api.get(`/api/projects/${projectId}`)) as Project;
          await confirmDelete(server, `project ${p.code} (${p.name})`, p.code, given);
          await api.send('DELETE', `/api/projects/${projectId}`);
          return { deleted: `project ${p.code}` };
        }),
    );

    server.registerTool(
      'delete_project_version',
      {
        title: 'Delete a project version',
        description: 'Permanently delete a project version. confirm must be the version name.',
        inputSchema: { versionId: Id, confirm },
        annotations: DESTRUCTIVE,
      },
      ({ versionId, confirm: given }) =>
        guard(async () => {
          const v = await version(versionId);
          await confirmDelete(server, `version ${v.name}`, v.name, given);
          await api.send('DELETE', `/api/project-versions/${versionId}`);
          return { deleted: `version ${v.name}` };
        }),
    );

    server.registerTool(
      'delete_test_suite',
      {
        title: 'Delete a test suite',
        description: 'Permanently delete a test suite. confirm must be the suite name.',
        inputSchema: { suiteId: Id, confirm },
        annotations: DESTRUCTIVE,
      },
      ({ suiteId, confirm: given }) =>
        guard(async () => {
          const s = (await api.get(`/api/test-suites/${suiteId}`)) as Suite;
          await confirmDelete(server, `test suite ${s.name}`, s.name, given);
          await api.send('DELETE', `/api/test-suites/${suiteId}`);
          return { deleted: `test suite ${s.name}` };
        }),
    );
  }
}
