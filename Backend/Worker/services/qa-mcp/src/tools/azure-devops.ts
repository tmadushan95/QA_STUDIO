import { z } from 'zod';
import { EXTERNAL, guard, itemsOf, q, READ, type ToolContext } from '../result.js';

interface PipelineJob {
  id: string;
}
interface AuditRow {
  action: string;
}

/** The audit action every filed or updated bug is recorded under (see azure-devops.ts in qa-api). */
export const DEFECT_AUDIT_ACTION = 'azure-devops.defect';

/**
 * Azure DevOps through the platform's stored connection: the agent never sees the token. Reading a story is part of
 * `read`; the import-to-publish pipeline is `operate`; filing bugs is the separate `defects` set.
 */
export function registerAzureDevOpsTools(ctx: ToolContext): void {
  const { server, api, toolsets } = ctx;

  server.registerTool(
    'get_work_item',
    {
      title: 'Get an Azure DevOps work item',
      description:
        'A user story, bug or other work item: type, state, title, description and acceptance criteria as plain text. Use it to write test cases for a story.',
      inputSchema: { workItemId: z.number().int().positive() },
      annotations: READ,
    },
    ({ workItemId }) => guard(() => api.get(`/api/azure-devops/work-items/${workItemId}`)),
  );

  server.registerTool(
    'get_azure_devops_job',
    {
      title: 'Get an Azure DevOps pipeline job',
      description:
        'The stages of an import-to-publish job (import, convert, approve, parameters, run, publish) with their status. Without jobId, lists recent jobs.',
      inputSchema: { jobId: z.string().min(1).max(100).optional() },
      annotations: READ,
    },
    ({ jobId }) =>
      guard(async () => {
        const jobs = itemsOf<PipelineJob>(await api.get('/api/azure-devops/jobs'));
        if (!jobId) return { items: jobs.slice(0, 10) };
        const job = jobs.find((j) => j.id === jobId);
        if (!job) throw new Error(`There is no Azure DevOps job ${jobId}.`);
        return job;
      }),
  );

  if (toolsets.has('operate')) {
    server.registerTool(
      'start_azure_devops_pipeline',
      {
        title: 'Run the Azure DevOps pipeline',
        description:
          "Starts the platform's own job for an Azure DevOps test plan suite: import its test cases, convert the written steps, approve the drafts that pass every check, fill parameters, run, and publish results to Test Plans. Uses the plan and suite from settings when left out. Follow it with get_azure_devops_job.",
        inputSchema: {
          planId: z.number().int().positive().optional(),
          suiteId: z.number().int().positive().optional(),
          accountIds: z.array(z.string().min(1)).max(20).optional(),
        },
        annotations: EXTERNAL,
      },
      (input) => guard(() => api.send('POST', '/api/azure-devops/pipeline', input)),
    );
  }

  if (!toolsets.has('defects')) return;

  server.registerTool(
    'report_defect',
    {
      title: 'Report a defect in Azure DevOps',
      description:
        'Files a Bug for a case that failed in a run, built by the platform from the run\'s evidence. It is refused unless the case also failed in an earlier run and diagnose_failed_case said "likely-defect" for this run. If an open bug already has the same failure, a comment is added instead. Capped per run.',
      inputSchema: {
        runId: z.string().min(1).max(100),
        caseId: z.string().trim().min(1).max(200),
        account: z.string().max(200).optional(),
        storyId: z
          .number()
          .int()
          .positive()
          .optional()
          .describe('The work item to link the bug to'),
      },
      annotations: EXTERNAL,
    },
    (input) => guard(() => api.send('POST', '/api/azure-devops/defects', input)),
  );

  server.registerTool(
    'list_reported_defects',
    {
      title: 'List reported defects',
      description: 'Bugs the platform filed or commented on, newest first, from the audit trail.',
      inputSchema: { limit: z.number().int().min(1).max(100).optional() },
      annotations: READ,
    },
    ({ limit }) =>
      guard(async () => {
        const rows = itemsOf<AuditRow>(await api.get(`/api/audit${q({ limit: 500 })}`));
        return {
          items: rows.filter((r) => r.action === DEFECT_AUDIT_ACTION).slice(0, limit ?? 20),
        };
      }),
  );
}
