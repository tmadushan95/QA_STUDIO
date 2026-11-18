import { z } from 'zod';
import { enc, guard, q, READ, REPLACE, WRITE, type ToolContext } from '../result.js';

const CaseId = z.string().trim().min(1).max(200);
const Steps = z
  .array(
    z.object({
      action: z.string().min(1).max(100).describe('An action name from list_actions'),
      params: z
        .record(z.string(), z.unknown())
        .default({})
        .describe("The action's parameters, as list_actions describes them"),
    }),
  )
  .min(1)
  .max(200);

/**
 * Automation: the runnable steps (a scenario) linked to a test case. An assistant writes DRAFTS only. Approving,
 * editing an approved scenario in place and restoring old versions stay with a person in the dashboard, so these
 * routes are deliberately not tools.
 */
export function registerScenarioTools(ctx: ToolContext): void {
  const { server, api, toolsets } = ctx;

  server.registerTool(
    'list_actions',
    {
      title: 'List automation actions',
      description:
        'Every action a scenario step may use, with its parameters. A scenario may use ONLY these. Destructive ones delete data and run only when the platform allows it.',
      annotations: READ,
    },
    () =>
      guard(async () => {
        const r = (await api.get('/api/automation')) as { actions?: unknown[] };
        return { items: r.actions ?? [] };
      }),
  );

  server.registerTool(
    'search_knowledge',
    {
      title: 'Search project knowledge',
      description:
        'Search the private index of test cases, scenarios, actions and app pages read earlier. Each hit says where it came from.',
      inputSchema: { query: z.string().min(2).max(300) },
      annotations: READ,
    },
    ({ query }) => guard(() => api.get(`/api/knowledge/search${q({ q: query })}`)),
  );

  server.registerTool(
    'get_scenario',
    {
      title: 'Get the automation for a test case',
      description:
        'The approved scenario that runs for a test case (if any) and any draft waiting for review.',
      inputSchema: { caseId: CaseId },
      annotations: READ,
    },
    ({ caseId }) => guard(() => api.get(`/api/scenarios/${enc(caseId)}`)),
  );

  server.registerTool(
    'get_scenario_history',
    {
      title: 'Scenario history',
      description: "Earlier approved versions of a test case's scenario, newest first.",
      inputSchema: { caseId: CaseId },
      annotations: READ,
    },
    ({ caseId }) => guard(() => api.get(`/api/scenarios/${enc(caseId)}/history`)),
  );

  server.registerTool(
    'validate_scenario',
    {
      title: 'Check scenario steps',
      description:
        'Checks steps against the action registry without saving anything. Returns the problems and warnings of each step. Use it before save_scenario_draft.',
      inputSchema: { steps: Steps },
      annotations: READ,
    },
    ({ steps }) => guard(() => api.send('POST', '/api/scenarios/validate', { steps })),
  );

  if (!toolsets.has('author')) return;

  server.registerTool(
    'save_scenario_draft',
    {
      title: 'Save a scenario draft',
      description:
        'Save automation steps for a test case as a DRAFT. The platform checks every step; the answer lists any problems. A draft never runs: a person must approve it in the dashboard. Use {{data.name}} for environment values; never put real passwords or codes.',
      inputSchema: {
        caseId: CaseId,
        steps: Steps,
        description: z.string().max(500).optional(),
        note: z
          .string()
          .max(2000)
          .optional()
          .describe('Why the steps look this way, for the reviewer'),
      },
      annotations: WRITE,
    },
    ({ caseId, steps, description, note }) =>
      guard(() =>
        api.send('PUT', `/api/scenarios/${enc(caseId)}/draft`, {
          steps,
          ...(description && { description }),
          note: `[via MCP] ${note ?? 'Written by an assistant.'}`,
        }),
      ),
  );

  server.registerTool(
    'discard_scenario_draft',
    {
      title: 'Discard a scenario draft',
      description:
        'Throw away the draft waiting for review. The approved scenario, if any, keeps running unchanged.',
      inputSchema: { caseId: CaseId },
      annotations: REPLACE,
    },
    ({ caseId }) => guard(() => api.send('DELETE', `/api/scenarios/${enc(caseId)}/draft`)),
  );
}
