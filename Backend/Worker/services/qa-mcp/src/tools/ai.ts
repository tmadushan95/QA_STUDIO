import { z } from 'zod';
import { enc, guard, itemsOf, READ, REPLACE, WRITE, type ToolContext } from '../result.js';
import { follow, POLL_MS } from './runs.js';

interface AiJob {
  id: string;
  status: string;
  counts?: Record<string, number>;
}

const CaseId = z.string().trim().min(1).max(200);
const JobId = z.string().trim().min(1).max(100);

/** A case as propose_test_cases returns it; add_test_cases takes the ones to keep, edited or not. */
const ProposedCase = z.object({
  title: z.string().trim().min(3).max(200),
  module: z.string().trim().max(100).optional(),
  priority: z.enum(['High', 'Medium', 'Low']).optional(),
  category: z.string().max(50).optional(),
  manualCheck: z.boolean().optional(),
  preconditions: z.string().trim().max(1000).optional(),
  steps: z.array(z.string().trim().min(1).max(500)).min(1).max(30),
  expectedResult: z.string().trim().min(3).max(1000),
});

const Attachment = z.object({
  name: z.string().trim().min(1).max(200),
  mediaType: z
    .enum(['text/plain', 'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf'])
    .describe('text/plain for text; the others are base64'),
  data: z.string().min(1).max(5_600_000).describe('The text itself, or the file as base64'),
});

/**
 * The platform's AI features. Every one follows the platform's rules: proposals are only returned, generated
 * automation is a draft for review, and no secret is sent to a model.
 */
export function registerAiTools(ctx: ToolContext, pollMs = POLL_MS): void {
  const { server, api, toolsets } = ctx;
  const getJob = async (jobId: string) => (await api.get(`/api/ai/jobs/${enc(jobId)}`)) as AiJob;

  server.registerTool(
    'list_ai_jobs',
    {
      title: 'List AI jobs',
      description: 'Background AI jobs (automation drafts being generated), newest first.',
      annotations: READ,
    },
    () => guard(async () => ({ items: itemsOf(await api.get('/api/ai/jobs')) })),
  );

  server.registerTool(
    'get_ai_job',
    {
      title: 'Get an AI job',
      description: 'One AI job: its status and how many drafts it made, skipped or could not make.',
      inputSchema: { jobId: JobId },
      annotations: READ,
    },
    ({ jobId }) => guard(() => getJob(jobId)),
  );

  server.registerTool(
    'wait_for_ai_job',
    {
      title: 'Wait for an AI job',
      description: 'Waits until an AI job is no longer running (or the time is up) and returns it.',
      inputSchema: {
        jobId: JobId,
        timeoutSeconds: z.number().int().min(5).max(900).optional().describe('Default 300'),
      },
      annotations: READ,
    },
    ({ jobId, timeoutSeconds }, extra) =>
      guard(async () => {
        const { value, finished } = await follow(
          () => getJob(jobId),
          (j) => j.status !== 'running',
          (j) => {
            const done = Object.values(j.counts ?? {}).reduce((a, b) => a + b, 0);
            return { progress: done, message: `${j.status}: ${done} cases handled` };
          },
          extra,
          timeoutSeconds ?? 300,
          pollMs,
        );
        return { finished, ...value };
      }),
  );

  server.registerTool(
    'list_skills',
    {
      title: 'List AI skills',
      description:
        'Saved instructions that shape generated test cases. Put /skill-name in a propose_test_cases prompt to apply one.',
      annotations: READ,
    },
    () => guard(async () => ({ items: itemsOf(await api.get('/api/ai/skills')) })),
  );

  if (!toolsets.has('author')) return;

  server.registerTool(
    'propose_test_cases',
    {
      title: 'Propose test cases from a requirement',
      description:
        "The platform's AI proposes written test cases from a requirement, user story or description, one per checklist category. Saves NOTHING: show them, then pass the ones to keep to add_test_cases.",
      inputSchema: {
        prompt: z
          .string()
          .trim()
          .min(3)
          .max(20_000)
          .describe('The requirement or story, with its acceptance criteria'),
        projectId: z
          .number()
          .int()
          .positive()
          .optional()
          .describe('Decides which page names steps may use'),
        coverage: z.enum(['smoke', 'standard', 'thorough']).optional(),
        format: z.enum(['steps', 'gherkin']).optional(),
        attachments: z.array(Attachment).max(5).optional(),
      },
      annotations: READ,
    },
    ({ prompt, projectId, coverage, format, attachments }) =>
      guard(() =>
        api.send('POST', '/api/ai/cases/preview', {
          prompt,
          projectId: projectId ?? ctx.defaultProjectId,
          options: { ...(coverage && { coverage }), ...(format && { format }) },
          ...(attachments && { attachments }),
        }),
      ),
  );

  server.registerTool(
    'add_test_cases',
    {
      title: 'Add proposed test cases',
      description:
        'Adds test cases (usually from propose_test_cases) to a suite. They get the next free IDs and the ai-generated tag.',
      inputSchema: {
        cases: z.array(ProposedCase).min(1).max(20),
        projectId: z.number().int().positive().optional(),
        suiteId: z.number().int().positive().optional(),
        versionId: z.number().int().positive().optional(),
      },
      annotations: WRITE,
    },
    ({ cases, projectId, suiteId, versionId }) =>
      guard(() =>
        api.send('POST', '/api/ai/cases', {
          cases,
          projectId: projectId ?? ctx.defaultProjectId,
          testSuiteId: suiteId,
          projectVersionId: versionId,
        }),
      ),
  );

  server.registerTool(
    'generate_scenario_drafts',
    {
      title: 'Generate automation drafts',
      description:
        'Starts a background AI job that writes automation steps for each test case as a DRAFT for review. Returns the job; use wait_for_ai_job to follow it.',
      inputSchema: { caseIds: z.array(CaseId).min(1).max(100) },
      annotations: WRITE,
    },
    ({ caseIds }) => guard(() => api.send('POST', '/api/ai/generate', { caseIds })),
  );

  server.registerTool(
    'revise_scenario_steps',
    {
      title: 'Revise automation steps',
      description:
        'The AI changes steps the way the instruction says and checks them. Returns the revised steps only; save them with save_scenario_draft.',
      inputSchema: {
        caseId: CaseId,
        steps: z
          .array(
            z.object({
              action: z.string().min(1).max(100),
              params: z.record(z.string(), z.unknown()).default({}),
            }),
          )
          .max(60),
        instruction: z.string().trim().min(1).max(2000),
      },
      annotations: READ,
    },
    (input) => guard(() => api.send('POST', '/api/ai/steps/revise', input)),
  );

  server.registerTool(
    'diagnose_failed_case',
    {
      title: 'Diagnose a failed case',
      description:
        'Asks the AI why a case failed in a run. verdict "test-fix" means the test is out of date: a corrected draft is saved for review. verdict "likely-defect" means the app probably did not do what the case expects: nothing changes, and report_defect may file a bug.',
      inputSchema: {
        runId: z.string().min(1).max(100),
        caseId: CaseId,
        account: z
          .string()
          .max(200)
          .optional()
          .describe('The account label, when the case ran as several'),
      },
      annotations: WRITE,
    },
    (input) => guard(() => api.send('POST', '/api/ai/diagnose', input)),
  );

  server.registerTool(
    'cancel_ai_job',
    {
      title: 'Cancel an AI job',
      description: 'Stops an AI job. Drafts it already saved stay.',
      inputSchema: { jobId: JobId },
      annotations: REPLACE,
    },
    ({ jobId }) => guard(() => api.send('DELETE', `/api/ai/jobs/${enc(jobId)}`)),
  );
}
