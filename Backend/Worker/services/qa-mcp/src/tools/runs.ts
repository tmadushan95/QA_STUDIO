import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import type { ServerNotification, ServerRequest } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { Api } from '../client.js';
import { enc, EXTERNAL, guard, itemsOf, q, READ, REPLACE, type ToolContext } from '../result.js';

interface RunCase {
  caseId: string;
  account?: string;
  status: string;
  durationMs?: number;
  failure?: unknown;
  steps?: { index: number; action: string; description?: string; status: string }[];
}
interface Run {
  id: string;
  status: string;
  environment?: string;
  createdAt?: string;
  summary?: unknown;
  cases: RunCase[];
}
type Extra = RequestHandlerExtra<ServerRequest, ServerNotification>;

const RunId = z.string().trim().min(1).max(100);
const CaseIds = z.array(z.string().min(1)).min(1).max(25);
const AccountIds = z
  .array(z.string().min(1))
  .max(10)
  .optional()
  .describe('Test accounts to sign in as, when sign-in is on');
const FINISHED = new Set(['passed', 'failed', 'cancelled']);
/** How often a wait asks for news. Runs take seconds to minutes, so this keeps the API quiet. */
export const POLL_MS = 3000;

/** One run, cut down to what an agent needs to decide its next step: each case and where it failed. */
export function summariseRun(r: Run) {
  return {
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
        ...(failed
          ? {
              failedStep: {
                index: failed.index,
                action: failed.action,
                ...(failed.description && { description: failed.description }),
              },
            }
          : {}),
      };
    }),
  };
}

/**
 * Asks `read` until `isDone` says so or the time is up, telling the client how far it got when it asked for progress.
 * Stops early when the client cancels the call.
 */
export async function follow<T>(
  read: () => Promise<T>,
  isDone: (value: T) => boolean,
  progress: (value: T) => { progress: number; total?: number; message: string },
  extra: Extra,
  timeoutSeconds: number,
  pollMs = POLL_MS,
): Promise<{ value: T; finished: boolean }> {
  const token = extra._meta?.progressToken;
  const until = Date.now() + timeoutSeconds * 1000;
  for (;;) {
    const value = await read();
    if (token !== undefined) {
      await extra.sendNotification({
        method: 'notifications/progress',
        params: { progressToken: token, ...progress(value) },
      });
    }
    if (isDone(value)) return { value, finished: true };
    if (Date.now() + pollMs > until || extra.signal.aborted) return { value, finished: false };
    await new Promise((r) => setTimeout(r, pollMs));
  }
}

async function startRun(api: Api, caseIds: string[], accountIds: string[] | undefined) {
  const r = (await api.send('POST', '/api/runs', { caseIds, accountIds: accountIds ?? [] })) as {
    id: string;
    status: string;
  };
  return { runId: r.id, status: r.status };
}

/** Results of runs, and (with `operate`) running approved scenarios in real browsers. */
export function registerRunTools(ctx: ToolContext, pollMs = POLL_MS): void {
  const { server, api, toolsets } = ctx;
  const getRun = async (runId: string) => (await api.get(`/api/runs/${enc(runId)}`)) as Run;

  server.registerTool(
    'list_runs',
    {
      title: 'List recent runs',
      description: 'Recent test runs with their status and counts, newest first.',
      inputSchema: {
        limit: z.number().int().min(1).max(50).optional(),
        projectId: z.number().int().positive().optional(),
        versionId: z.number().int().positive().optional(),
      },
      annotations: READ,
    },
    ({ limit, projectId, versionId }) =>
      guard(async () => {
        const runs = itemsOf<Run>(
          await api.get(
            `/api/runs${q({ projectId: projectId ?? ctx.defaultProjectId, versionId })}`,
          ),
        );
        return {
          items: runs.slice(0, limit ?? 10).map((x) => ({
            id: x.id,
            status: x.status,
            environment: x.environment,
            createdAt: x.createdAt,
            summary: x.summary,
          })),
        };
      }),
  );

  server.registerTool(
    'get_run',
    {
      title: 'Get a run',
      description:
        'Results of one run: each case, its status, the failing step and the failure message.',
      inputSchema: { runId: RunId },
      annotations: READ,
    },
    ({ runId }) => guard(async () => summariseRun(await getRun(runId))),
  );

  server.registerTool(
    'get_run_report',
    {
      title: 'Get a run report',
      description:
        'The full machine-readable report of a run: every step of every case, timings and evidence file names. Large; use get_run first.',
      inputSchema: { runId: RunId },
      annotations: READ,
    },
    ({ runId }) => guard(() => api.get(`/api/runs/${enc(runId)}/report.json`)),
  );

  server.registerTool(
    'wait_for_run',
    {
      title: 'Wait for a run to finish',
      description:
        'Waits until a run has finished (or the time is up) and returns its results like get_run. Sends progress when the client asks for it.',
      inputSchema: {
        runId: RunId,
        timeoutSeconds: z.number().int().min(5).max(900).optional().describe('Default 300'),
      },
      annotations: READ,
    },
    ({ runId, timeoutSeconds }, extra) =>
      guard(async () => {
        const { value, finished } = await follow(
          () => getRun(runId),
          (r) => FINISHED.has(r.status),
          (r) => {
            const done = r.cases.filter((c) => !['queued', 'running'].includes(c.status)).length;
            return {
              progress: done,
              total: r.cases.length,
              message: `${r.status}: ${done}/${r.cases.length} cases`,
            };
          },
          extra,
          timeoutSeconds ?? 300,
          pollMs,
        );
        return { finished, ...summariseRun(value) };
      }),
  );

  if (!toolsets.has('operate')) return;

  server.registerTool(
    'plan_run',
    {
      title: 'Plan a run',
      description:
        'What running these cases needs, grouped by project: whether the project is ready, which test accounts it can sign in as, and what is blocked. Starts nothing.',
      inputSchema: { caseIds: z.array(z.string().min(1)).min(1).max(500) },
      annotations: READ,
    },
    ({ caseIds }) => guard(() => api.send('POST', '/api/runs/plan', { caseIds })),
  );

  server.registerTool(
    'start_run',
    {
      title: 'Run test cases',
      description:
        'Run approved scenarios against the configured QA environment in real browsers. Cases without an approved scenario are reported as blocked. Steps that delete data run only if the platform allows it. Returns the run ID; use wait_for_run or get_run to follow it.',
      inputSchema: { caseIds: CaseIds, accountIds: AccountIds },
      annotations: EXTERNAL,
    },
    ({ caseIds, accountIds }) => guard(() => startRun(api, caseIds, accountIds)),
  );

  server.registerTool(
    'rerun_failed_cases',
    {
      title: 'Run the failed cases again',
      description:
        'Starts a new run of the cases that failed in a finished run (up to 25). Use it before reporting a defect: a case that passes the second time was flaky, not broken. Pass the same accountIds as the first run when sign-in is on.',
      inputSchema: { runId: RunId, accountIds: AccountIds },
      annotations: EXTERNAL,
    },
    ({ runId, accountIds }) =>
      guard(async () => {
        const run = await getRun(runId);
        if (!FINISHED.has(run.status)) {
          throw new Error(`Run ${runId} is still ${run.status}; wait for it first.`);
        }
        const caseIds = [
          ...new Set(run.cases.filter((c) => c.status === 'failed').map((c) => c.caseId)),
        ];
        if (caseIds.length === 0)
          return { message: `No case failed in run ${runId}.`, failedCaseIds: [] };
        // Run results name accounts by label only, so the agent passes the account IDs again.
        return {
          ...(await startRun(api, caseIds.slice(0, 25), accountIds)),
          failedCaseIds: caseIds,
        };
      }),
  );

  server.registerTool(
    'cancel_run',
    {
      title: 'Cancel a run',
      description: 'Stop a queued or running run. Cases already finished keep their results.',
      inputSchema: { runId: RunId },
      annotations: REPLACE,
    },
    ({ runId }) => guard(() => api.send('POST', `/api/runs/${enc(runId)}/cancel`, {})),
  );
}
