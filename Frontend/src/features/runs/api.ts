/**
 * Requests of the Runs feature: start a run (cases × accounts), follow it, cancel it, and read its evidence and
 * reports. Sign-in is done by the run from each project's setup, never by a step.
 */
import type { Run, RunSummary } from '@qa-studio/shared';
import { get, send, seg } from '../../shared/api/http.js';
import type { Account } from '../master-data/api.js';

/** A run as the pages show it. */
export type RunView = Run & { summary: RunSummary };

/** Run statuses that mean the run is still going. */
export const ACTIVE = ['queued', 'running'];

/** One project's share of the cases chosen for a run. */
export interface RunPlanGroup {
  projectId?: number;
  projectName?: string;
  caseCount: number;
  environment: string;
  appUrl?: string;
  loginRequired: boolean;
  /** False when the project is not set up yet, with `reason` saying why. */
  available: boolean;
  reason?: string;
  /** The project's own accounts, when it signs in. Never includes passwords. */
  accounts: Account[];
}

/** What a chosen set of cases needs before it can start. */
export interface RunPlan {
  groups: RunPlanGroup[];
  workers?: number;
}

/** Ask what these cases need before they can start. */
export const planRun = (caseIds: string[]) => send<RunPlan>('/api/runs/plan', { caseIds });

/** The project and version a list is limited to; 0 or absent means all. */
export interface ScopeQuery {
  projectId?: number;
  versionId?: number;
}

/** `?projectId=…&versionId=…` for the parts that are set. */
export function scopeQuery(scope: ScopeQuery = {}): string {
  const q = new URLSearchParams();
  if (scope.projectId) q.set('projectId', String(scope.projectId));
  if (scope.versionId) q.set('versionId', String(scope.versionId));
  const s = q.toString();
  return s ? `?${s}` : '';
}

/** The run history; with a scope, only the results of that project's (and version's) cases. */
export async function fetchRuns(scope?: ScopeQuery): Promise<RunView[]> {
  const r = await get<{ items?: RunView[] }>(`/api/runs${scopeQuery(scope)}`);
  return Array.isArray(r?.items) ? r.items : [];
}

/** One run with its per-case results. */
export const fetchRun = (id: string) => get<RunView>(`/api/runs/${seg(id)}`);

/** Start a run. */
export const startRun = (caseIds: string[], accountIds: string[], workers?: number) =>
  send<RunView>('/api/runs', { caseIds, accountIds, ...(workers !== undefined && { workers }) });

/** Stop a run. */
export const cancelRun = (id: string) =>
  send<{ cancelled: boolean }>(`/api/runs/${seg(id)}/cancel`);

/** Where a run's report downloads from. */
export const reportUrl = (runId: string, format: 'html' | 'xlsx' | 'json') =>
  `/api/runs/${seg(runId)}/report.${format}`;

/** Where one piece of run evidence, such as a screenshot, is served from. */
export const artifactUrl = (runId: string, path: string) =>
  `/api/runs/${seg(runId)}/artifact?path=${encodeURIComponent(path)}`;
