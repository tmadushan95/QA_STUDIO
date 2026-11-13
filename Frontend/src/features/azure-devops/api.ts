/**
 * Requests of the Azure DevOps feature: the connection (the token is write-only), test plans and suites, importing a
 * suite's test cases, publishing a run's results, and the automated pipeline with its live progress.
 */
import { get, send } from '../../shared/api/http.js';

/** Connection and pipeline defaults, as saved. */
export interface AzureDevOpsConfig {
  orgUrl: string;
  project: string;
  /** The QA Studio project new cases are filed in (the one in the header). */
  projectId?: number | undefined;
  testSuiteId?: number | undefined;
  projectVersionId?: number | undefined;
  planId?: number | undefined;
  suiteId?: number | undefined;
  accountIds: string[];
  autoApprove: boolean;
  autoParameters: boolean;
  publishResults: boolean;
}

/** What the page shows; the token itself is never sent back. */
export interface AzureDevOpsView {
  config: Partial<AzureDevOpsConfig>;
  hasToken: boolean;
  ready: boolean;
  reason?: string;
}

export interface PlanItem {
  id: number;
  name: string;
  state?: string;
}

export interface AdoSuiteItem {
  id: number;
  name: string;
  parentId?: number;
}

export type PipelineStage = 'import' | 'convert' | 'approve' | 'parameters' | 'run' | 'publish';

export interface PipelineJob {
  id: string;
  status: 'running' | 'done' | 'failed';
  startedAt: string;
  endedAt?: string;
  planId: number;
  suiteId: number;
  steps: {
    stage: PipelineStage;
    status: 'pending' | 'running' | 'done' | 'skipped' | 'failed';
    message?: string;
  }[];
  caseIds: string[];
  runId?: string;
  azureRunId?: number;
  azureRunUrl?: string;
  error?: string;
}

export const fetchAzureDevOps = () => get<AzureDevOpsView>('/api/azure-devops');

export const saveAzureDevOps = (c: AzureDevOpsConfig) =>
  send<AzureDevOpsView>('/api/azure-devops', c, 'PUT');

export const saveToken = (token: string) =>
  send<AzureDevOpsView>('/api/azure-devops/token', { token }, 'PUT');

export const removeToken = () =>
  send<AzureDevOpsView>('/api/azure-devops/token', undefined, 'DELETE');

export const testConnection = () =>
  send<{ ok: boolean; message: string }>('/api/azure-devops/test');

export async function fetchPlans(): Promise<PlanItem[]> {
  const r = await get<{ items?: PlanItem[] }>('/api/azure-devops/plans');
  return Array.isArray(r?.items) ? r.items : [];
}

export async function fetchAdoSuites(planId: number): Promise<AdoSuiteItem[]> {
  const r = await get<{ items?: AdoSuiteItem[] }>(`/api/azure-devops/plans/${planId}/suites`);
  return Array.isArray(r?.items) ? r.items : [];
}

export const importFromAzure = (target: {
  planId: number;
  suiteId: number;
  projectId?: number;
  testSuiteId?: number;
  projectVersionId?: number;
}) =>
  send<{ added: number; updated: number; caseIds: string[] }>('/api/azure-devops/import', target);

export const publishToAzure = (runId: string, planId: number, suiteId: number) =>
  send<{ azureRunId: number; url?: string; published: number }>('/api/azure-devops/publish', {
    runId,
    planId,
    suiteId,
  });

export async function fetchPipelineJobs(): Promise<PipelineJob[]> {
  const r = await get<{ items?: PipelineJob[] }>('/api/azure-devops/jobs');
  return Array.isArray(r?.items) ? r.items : [];
}

export const startPipeline = (
  body: { planId?: number; suiteId?: number; accountIds?: string[] } = {},
) => send<PipelineJob>('/api/azure-devops/pipeline', body);
