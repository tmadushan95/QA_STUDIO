import { z } from 'zod';
import { guard, itemsOf, q, READ, type ToolContext } from '../result.js';

interface AuditRow {
  action: string;
  target?: string;
  detail?: string;
}

/** Numbers for coverage questions, and the trail of who changed what. */
export function registerInsightTools(ctx: ToolContext): void {
  const { server, api } = ctx;
  const scope = {
    projectId: z.number().int().positive().optional(),
    versionId: z.number().int().positive().optional(),
  };

  server.registerTool(
    'get_dashboard',
    {
      title: 'Get the dashboard',
      description:
        'Latest results, coverage (cases with approved automation) and the pass-rate trend, for a project and version or for everything.',
      inputSchema: scope,
      annotations: READ,
    },
    ({ projectId, versionId }) =>
      guard(() =>
        api.get(`/api/dashboard${q({ projectId: projectId ?? ctx.defaultProjectId, versionId })}`),
      ),
  );

  server.registerTool(
    'get_insights',
    {
      title: 'Get library insights',
      description:
        'Counts of test cases by module, priority and readiness, and how the library changed over the last days.',
      inputSchema: { ...scope, days: z.number().int().min(1).max(365).optional() },
      annotations: READ,
    },
    ({ projectId, versionId, days }) =>
      guard(() =>
        api.get(
          `/api/insights${q({ projectId: projectId ?? ctx.defaultProjectId, versionId, days })}`,
        ),
      ),
  );

  server.registerTool(
    'list_audit',
    {
      title: 'List the audit trail',
      description:
        'Recent changes, newest first: action, target and detail. Changes made through MCP say "via mcp". Filter by action prefix, such as "inventory." or "azure-devops.defect".',
      inputSchema: {
        limit: z.number().int().min(1).max(500).optional(),
        action: z.string().max(100).optional().describe('Only actions starting with this'),
      },
      annotations: READ,
    },
    ({ limit, action }) =>
      guard(async () => {
        const rows = itemsOf<AuditRow>(
          await api.get(`/api/audit${q({ limit: action ? 500 : (limit ?? 50) })}`),
        );
        const matching = action ? rows.filter((r) => r.action.startsWith(action)) : rows;
        return { items: matching.slice(0, limit ?? 50) };
      }),
  );
}
