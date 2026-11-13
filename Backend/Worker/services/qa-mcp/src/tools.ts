import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Api } from './client.js';

const text = (value: unknown) => ({
  content: [
    {
      type: 'text' as const,
      text: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
    },
  ],
});
const fail = (e: unknown) => ({
  content: [
    { type: 'text' as const, text: e instanceof Error ? e.message : 'The request failed.' },
  ],
  isError: true,
});
const q = (params: Record<string, string | number | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') p.set(k, String(v));
  return p.toString();
};
const enc = encodeURIComponent;

interface RunCase {
  caseId: string;
  account?: string;
  status: string;
  durationMs?: number;
  failure?: unknown;
  steps?: { index: number; action: string; status: string; failure?: { message?: string } }[];
}

/**
 * The platform as MCP tools, for an AI assistant (Claude Code, Claude Desktop, any MCP client).
 *
 * What it can do: look things up, write scenario DRAFTS, and start runs of approved scenarios.
 * What it cannot do, on purpose: approve a scenario, delete anything, change settings, or see any secret.
 * Approval stays a human decision in the dashboard.
 */
export function createMcpServer(api: Api): McpServer {
  const server = new McpServer({ name: 'qa-studio', version: '0.1.0' });
  const readOnly = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };

  server.registerTool(
    'search_test_cases',
    {
      title: 'Search test cases',
      description:
        'Find imported test cases by words in their ID, title or module. Returns IDs, titles, modules and priorities.',
      inputSchema: {
        query: z.string().max(200).optional().describe('Words to look for; empty lists everything'),
        module: z.string().max(100).optional(),
        limit: z.number().int().min(1).max(100).optional(),
      },
      annotations: readOnly,
    },
    async ({ query, module, limit }) => {
      try {
        const r = (await api.get(
          `/api/inventory?${q({ q: query, module, pageSize: limit ?? 25 })}`,
        )) as {
          total: number;
          items: { id: string; title: string; module?: string; priority?: string }[];
        };
        return text({
          total: r.total,
          items: r.items.map((c) => ({
            id: c.id,
            title: c.title,
            module: c.module,
            priority: c.priority,
          })),
        });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'get_test_case',
    {
      title: 'Get a test case',
      description:
        'The full manual test case: preconditions, steps, expected result and where it came from.',
      inputSchema: { id: z.string().min(1).max(200) },
      annotations: readOnly,
    },
    async ({ id }) => {
      try {
        const r = (await api.get(`/api/inventory?${q({ q: id, pageSize: 50 })}`)) as {
          items: { id: string }[];
        };
        const found = r.items.find((c) => c.id === id);
        return found ? text(found) : fail(new Error(`There is no test case "${id}".`));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'list_actions',
    {
      title: 'List automation actions',
      description:
        'Every action a scenario step may use, with its parameters. A scenario may use ONLY these. Destructive ones delete data and run only when the platform allows it.',
      annotations: readOnly,
    },
    async () => {
      try {
        const r = (await api.get('/api/automation')) as { actions?: unknown[] };
        return text(r.actions ?? []);
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'search_knowledge',
    {
      title: 'Search project knowledge',
      description:
        'Search the private index of test cases, scenarios, actions and app pages read earlier. Each hit says where it came from.',
      inputSchema: { query: z.string().min(2).max(300) },
      annotations: readOnly,
    },
    async ({ query }) => {
      try {
        return text(await api.get(`/api/knowledge/search?${q({ q: query })}`));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'get_scenario',
    {
      title: 'Get the automation for a test case',
      description:
        'The approved scenario that runs for a test case (if any) and any draft waiting for review.',
      inputSchema: { caseId: z.string().min(1).max(200) },
      annotations: readOnly,
    },
    async ({ caseId }) => {
      try {
        return text(await api.get(`/api/scenarios/${enc(caseId)}`));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'save_scenario_draft',
    {
      title: 'Save a scenario draft',
      description:
        'Save automation steps for a test case as a DRAFT. The platform checks every step; the answer lists any problems. A draft never runs: a person must approve it in the dashboard. Use {{data.name}} for environment values; never put real passwords or codes.',
      inputSchema: {
        caseId: z.string().min(1).max(200),
        steps: z
          .array(
            z.object({
              action: z.string().min(1),
              params: z.record(z.string(), z.unknown()).default({}),
            }),
          )
          .min(1)
          .max(200),
        description: z.string().max(500).optional(),
        note: z
          .string()
          .max(2000)
          .optional()
          .describe('Why the steps look this way, for the reviewer'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ caseId, steps, description, note }) => {
      try {
        const r = await api.send('PUT', `/api/scenarios/${enc(caseId)}/draft`, {
          steps,
          ...(description && { description }),
          note: `[via MCP] ${note ?? 'Written by an assistant.'}`,
        });
        return text(r);
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'list_runs',
    {
      title: 'List recent runs',
      description: 'Recent test runs with their status and counts.',
      inputSchema: { limit: z.number().int().min(1).max(50).optional() },
      annotations: readOnly,
    },
    async ({ limit }) => {
      try {
        const r = (await api.get('/api/runs')) as {
          items: {
            id: string;
            status: string;
            environment: string;
            createdAt: string;
            summary: unknown;
          }[];
        };
        return text(
          r.items.slice(0, limit ?? 10).map((x) => ({
            id: x.id,
            status: x.status,
            environment: x.environment,
            createdAt: x.createdAt,
            summary: x.summary,
          })),
        );
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'get_run',
    {
      title: 'Get a run',
      description:
        'Results of one run: each case, its status, the failing step and the failure message.',
      inputSchema: { runId: z.string().min(1).max(100) },
      annotations: readOnly,
    },
    async ({ runId }) => {
      try {
        const r = (await api.get(`/api/runs/${enc(runId)}`)) as {
          id: string;
          status: string;
          summary: unknown;
          cases: RunCase[];
        };
        return text({
          id: r.id,
          status: r.status,
          summary: r.summary,
          cases: r.cases.map((c) => {
            const failed = c.steps?.find((s) => s.status === 'failed');
            return {
              caseId: c.caseId,
              account: c.account,
              status: c.status,
              durationMs: c.durationMs,
              ...(c.failure ? { failure: c.failure } : {}),
              ...(failed ? { failedStep: { index: failed.index, action: failed.action } } : {}),
            };
          }),
        });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'start_run',
    {
      title: 'Run test cases',
      description:
        'Run approved scenarios against the configured QA environment in real browsers. Cases without an approved scenario are reported as blocked. Steps that delete data run only if the platform allows it. Returns the run ID; use get_run to follow it.',
      inputSchema: {
        caseIds: z.array(z.string().min(1)).min(1).max(25),
        accountIds: z
          .array(z.string().min(1))
          .max(10)
          .optional()
          .describe('Test accounts to sign in as, when sign-in is on'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ caseIds, accountIds }) => {
      try {
        const r = (await api.send('POST', '/api/runs', {
          caseIds,
          accountIds: accountIds ?? [],
        })) as { id: string; status: string };
        return text({ runId: r.id, status: r.status });
      } catch (e) {
        return fail(e);
      }
    },
  );

  return server;
}
