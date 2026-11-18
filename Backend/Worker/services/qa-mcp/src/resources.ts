import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ListResourcesResult, ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';
import { enc, itemsOf, q, type ToolContext } from './result.js';

interface Named {
  id: string | number;
  name?: string;
  code?: string;
  title?: string;
  status?: string;
  createdAt?: string;
}

/** Where the step format guide lives in the repository. Missing in a package installed on its own: then no resource. */
const STEP_FORMAT = fileURLToPath(new URL('../../../../../docs/STEP-FORMAT.md', import.meta.url));
/** Suggestions a completion request returns at most. */
const MAX_COMPLETIONS = 20;

const json = (uri: URL, value: unknown): ReadResourceResult => ({
  contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(value, null, 2) }],
});
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';
/**
 * A listing that cannot reach its source lists nothing rather than failing: the client asks for every listing at
 * once, so one stopped service (the worker, say) would otherwise hide all the others.
 */
const softly =
  (list: () => Promise<ListResourcesResult>) => async (): Promise<ListResourcesResult> => {
    try {
      return await list();
    } catch {
      return { resources: [] };
    }
  };

/**
 * Read-only context a client can attach to a conversation, or an agent can read, without calling a tool. Each one
 * reads the platform when it is asked for, so it is never stale.
 */
export function registerResources(ctx: ToolContext): void {
  const { server, api } = ctx;
  const projects = async () => itemsOf<Named>(await api.get('/api/projects'));

  server.registerResource(
    'actions',
    'qa://actions',
    {
      title: 'Automation actions',
      description: 'Every action a scenario step may use, with its parameters.',
      mimeType: 'application/json',
    },
    async (uri) =>
      json(uri, ((await api.get('/api/automation')) as { actions?: unknown[] }).actions ?? []),
  );

  if (existsSync(STEP_FORMAT)) {
    server.registerResource(
      'step-format',
      'qa://docs/step-format',
      {
        title: 'Step format guide',
        description:
          'How scenario steps are written: actions, parameters, {{data.name}} values and pages.',
        mimeType: 'text/markdown',
      },
      (uri) => ({
        contents: [
          { uri: uri.href, mimeType: 'text/markdown', text: readFileSync(STEP_FORMAT, 'utf8') },
        ],
      }),
    );
  }

  server.registerResource(
    'project',
    new ResourceTemplate('qa://projects/{projectId}', {
      list: softly(async () => ({
        resources: (await projects()).map((p) => ({
          uri: `qa://projects/${p.id}`,
          name: `${p.code ?? p.id} ${p.name ?? ''}`.trim(),
          mimeType: 'application/json',
        })),
      })),
      complete: {
        projectId: async (value) =>
          (await projects())
            .map((p) => String(p.id))
            .filter((id) => id.startsWith(value))
            .slice(0, MAX_COMPLETIONS),
      },
    }),
    {
      title: 'Project',
      description: 'A project with its versions and test suites.',
      mimeType: 'application/json',
    },
    async (uri, { projectId }) => {
      const id = Number(first(projectId));
      return json(uri, {
        project: await api.get(`/api/projects/${id}`),
        versions: itemsOf(await api.get(`/api/project-versions${q({ projectId: id })}`)),
        suites: itemsOf(await api.get(`/api/test-suites${q({ projectId: id })}`)),
      });
    },
  );

  server.registerResource(
    'test-case',
    new ResourceTemplate('qa://test-cases/{caseId}', {
      // Too many to list; clients find them through completion or search_test_cases.
      list: undefined,
      complete: {
        caseId: async (value) =>
          itemsOf<Named>(
            await api.get(`/api/test-cases${q({ q: value, pageSize: MAX_COMPLETIONS })}`),
          ).map((c) => String(c.id)),
      },
    }),
    { title: 'Test case', description: 'A written test case.', mimeType: 'application/json' },
    async (uri, { caseId }) => json(uri, await api.get(`/api/test-cases/${enc(first(caseId))}`)),
  );

  server.registerResource(
    'run-report',
    new ResourceTemplate('qa://runs/{runId}/report', {
      list: softly(async () => ({
        resources: itemsOf<Named>(await api.get('/api/runs'))
          .slice(0, MAX_COMPLETIONS)
          .map((r) => ({
            uri: `qa://runs/${r.id}/report`,
            name: `Run ${String(r.id).slice(0, 8)} (${r.status ?? ''}, ${r.createdAt ?? ''})`,
            mimeType: 'application/json',
          })),
      })),
    }),
    {
      title: 'Run report',
      description: 'The full report of one run.',
      mimeType: 'application/json',
    },
    async (uri, { runId }) =>
      json(uri, await api.get(`/api/runs/${enc(first(runId))}/report.json`)),
  );
}
