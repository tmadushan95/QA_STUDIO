/**
 * Azure DevOps Test Plans integration.
 *
 * - **Connect**: organization URL, project and a Personal Access Token (scopes: Test Management read & write, Work
 *   Items read). The token is encrypted with the same key as account passwords and is never sent back to a browser.
 * - **Import**: the test cases of a plan's suite become QA Studio test cases (`ADO-<work item id>`), filed under the
 *   chosen suite and version. Their written steps come from the work item's Steps field. Importing again updates them.
 * - **Automate end to end**: import → convert the written steps into runnable steps → approve the ones that check out →
 *   fill missing parameters → run → publish each result back to Azure DevOps as a test run on the plan's test points.
 *   Every stage is a step of one job with live progress, and a stage that cannot go on stops the job with a reason.
 *
 * The pipeline drives the same HTTP routes a person uses (through `PipelineHost`), so every safety rule of a manual
 * run (allowed environments, project readiness, accounts, destructive steps) applies unchanged.
 */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { SCHEMA_VERSION, type Run, type TestCase } from '@qa-studio/shared';
import { HttpError } from './errors.js';

/** Config block with the connection and pipeline defaults (no secret). */
export const CONFIG_KEY = 'azure-devops';
/** Config block with the encrypted Personal Access Token. */
export const PAT_KEY = 'azure-devops-pat';
/** `source.workbook` of every imported case; `source.rowNumber` holds the work item ID. */
export const SOURCE_NAME = 'azure-devops';

const API = 'api-version=7.1';
const BATCH = 200;
const MAX_JOBS_KEPT = 20;
const FIELDS = [
  'System.Title',
  'System.Description',
  'System.Tags',
  'System.AreaPath',
  'Microsoft.VSTS.TCM.Steps',
  'Microsoft.VSTS.Common.Priority',
] as const;

const Https = z
  .string()
  .trim()
  .url('Enter the organization URL, such as https://dev.azure.com/contoso.')
  .refine((u) => u.startsWith('https://'), 'Use an https:// address.')
  .transform((u) => u.replace(/\/+$/, ''));

const Config = z.object({
  orgUrl: Https,
  project: z.string().trim().min(1, 'Enter the Azure DevOps project.').max(200),
  /** QA Studio project imported cases belong to; with no suite, each Azure suite becomes a suite of this project. */
  projectId: z.number().int().positive().optional(),
  /** QA Studio suite that imported cases are filed under. */
  testSuiteId: z.number().int().positive().optional(),
  /** QA Studio project version that imported cases are written for. */
  projectVersionId: z.number().int().positive().optional(),
  /** Default Azure DevOps test plan and suite for the automated pipeline. */
  planId: z.number().int().positive().optional(),
  suiteId: z.number().int().positive().optional(),
  /** Test accounts the automated run signs in as. */
  accountIds: z.array(z.string().min(1)).max(20).default([]),
  autoApprove: z.boolean().default(true),
  autoParameters: z.boolean().default(true),
  publishResults: z.boolean().default(true),
});
export type AzureDevOpsConfig = z.infer<typeof Config>;

const Target = z.object({
  planId: z.number().int().positive(),
  suiteId: z.number().int().positive(),
  projectId: z.number().int().positive().optional(),
  testSuiteId: z.number().int().positive().optional(),
  projectVersionId: z.number().int().positive().optional(),
});

/** What the settings page shows. The token itself never leaves the server. */
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

export interface SuiteItem {
  id: number;
  name: string;
  parentId?: number;
}

export interface ImportOutcome {
  added: number;
  updated: number;
  caseIds: string[];
}

export type PipelineStage = 'import' | 'convert' | 'approve' | 'parameters' | 'run' | 'publish';

export interface PipelineStep {
  stage: PipelineStage;
  status: 'pending' | 'running' | 'done' | 'skipped' | 'failed';
  message?: string;
}

export interface PipelineJob {
  id: string;
  status: 'running' | 'done' | 'failed';
  startedAt: string;
  endedAt?: string;
  planId: number;
  suiteId: number;
  steps: PipelineStep[];
  caseIds: string[];
  runId?: string;
  /** The Azure DevOps test run that received the results. */
  azureRunId?: number;
  azureRunUrl?: string;
  error?: string;
}

/** The QA Studio operations the pipeline needs, provided by the HTTP layer so it reuses every route's checks. */
export interface PipelineHost {
  /** Convert written steps into runnable steps and wait for the job to finish. */
  convert(caseIds: string[]): Promise<{ ready: number; needsReview: number }>;
  /** Approve the validated drafts; returns how many were approved. */
  approve(caseIds: string[]): Promise<number>;
  /** Cases that can run now (they have approved steps). */
  runnable(caseIds: string[]): string[];
  /** Fill missing parameters; returns cases still missing a value. */
  configure(caseIds: string[]): Promise<number>;
  /** Start a run and wait for it to finish. */
  run(caseIds: string[], accountIds: string[]): Promise<Run>;
}

export interface AzureDevOpsDeps {
  store: { loadConfig(key: string): unknown; saveConfig(key: string, value: unknown): void };
  box: { encrypt(plain: string): string; decrypt(token: string): string | undefined };
  inventory: Map<string, TestCase>;
  audit(action: string, target: string, detail: string): void;
  /** Tells open pages a job moved on. */
  publish?(job: PipelineJob): void;
  fetch?: typeof fetch;
  now?: () => Date;
}

const XML_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

/** Decode XML/HTML character references. */
function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code =
        e[1]?.toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return XML_ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Turn an Azure DevOps rich-text value (HTML) into one line of plain text. */
export function plainText(html: string | undefined): string {
  if (!html) return '';
  return decodeEntities(
    html
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<\/(p|div|li)>/gi, ' ')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parse the Steps field of a Test Case work item:
 * `<steps><step type="ActionStep"><parameterizedString>action</parameterizedString><parameterizedString>expected</parameterizedString></step></steps>`.
 * Each string is HTML encoded inside XML, so it is decoded twice. Shared steps (`<compref>`) are listed as one step that
 * names them, so the reviewer sees there is more to the case.
 */
export function parseSteps(xml: string | undefined): { action: string; expected?: string }[] {
  if (!xml) return [];
  const out: { action: string; expected?: string }[] = [];
  const token = /<step\b[^>]*>([\s\S]*?)<\/step>|<compref\b[^>]*\bref="(\d+)"[^>]*>/gi;
  for (const m of xml.matchAll(token)) {
    if (m[2]) {
      out.push({ action: `Run the shared steps of work item ${m[2]}` });
      continue;
    }
    const strings = [
      ...(m[1] ?? '').matchAll(/<parameterizedString\b[^>]*>([\s\S]*?)<\/parameterizedString>/gi),
    ].map((s) => plainText(decodeEntities(s[1] ?? '')));
    const action = strings[0] ?? '';
    if (!action) continue;
    const expected = strings[1];
    out.push({ action, ...(expected ? { expected } : {}) });
  }
  return out;
}

/** Azure DevOps priority 1 is the highest; QA Studio's dashboard reads "High" as high priority. */
function priorityOf(value: unknown): string | undefined {
  const n = Number(value);
  if (n === 1) return 'High';
  if (n === 2) return 'Medium';
  if (n >= 3) return 'Low';
  return undefined;
}

/** QA Studio result → Azure DevOps test outcome. */
export function outcomeOf(status: string): 'Passed' | 'Failed' | 'Blocked' | 'NotExecuted' {
  if (status === 'passed') return 'Passed';
  if (status === 'failed') return 'Failed';
  if (status === 'blocked') return 'Blocked';
  return 'NotExecuted';
}

/** A case run as several accounts reports its worst result, the same rule as the dashboard. */
const RANK: Record<string, number> = { failed: 4, blocked: 3, cancelled: 2, skipped: 2, passed: 1 };

export class AzureDevOpsService {
  private readonly jobs: PipelineJob[] = [];
  private active: PipelineJob | undefined;

  constructor(private readonly d: AzureDevOpsDeps) {}

  // ---------- configuration ----------

  private config(): AzureDevOpsConfig | undefined {
    const p = Config.safeParse(this.d.store.loadConfig(CONFIG_KEY));
    return p.success ? p.data : undefined;
  }

  private token(): string | undefined {
    const enc = this.d.store.loadConfig(PAT_KEY);
    return typeof enc === 'string' ? this.d.box.decrypt(enc) : undefined;
  }

  view(): AzureDevOpsView {
    const raw = this.d.store.loadConfig(CONFIG_KEY);
    const config = this.config();
    const hasToken = this.token() !== undefined;
    const reason = !config
      ? 'Enter the organization URL and project.'
      : !hasToken
        ? 'Add a Personal Access Token.'
        : undefined;
    return {
      config: config ?? (raw && typeof raw === 'object' ? (raw as Partial<AzureDevOpsConfig>) : {}),
      hasToken,
      ready: reason === undefined,
      ...(reason && { reason }),
    };
  }

  update(body: unknown): AzureDevOpsView {
    const p = Config.safeParse(body);
    if (!p.success) {
      throw new HttpError(
        400,
        'invalid-azure-devops',
        'Some settings need attention.',
        Object.fromEntries(p.error.issues.map((i) => [i.path.join('.'), i.message])),
      );
    }
    this.d.store.saveConfig(CONFIG_KEY, p.data);
    this.d.audit('azure-devops.update', p.data.project, 'Azure DevOps settings saved.');
    return this.view();
  }

  setToken(body: unknown): AzureDevOpsView {
    const p = z
      .object({
        token: z.string().trim().min(20, 'Paste the whole Personal Access Token.').max(500),
      })
      .safeParse(body);
    if (!p.success) {
      const message = p.error.issues[0]?.message ?? 'Paste the token.';
      throw new HttpError(400, 'invalid-token', message, { token: message });
    }
    this.d.store.saveConfig(PAT_KEY, this.d.box.encrypt(p.data.token));
    this.d.audit('azure-devops.token', 'azure-devops', 'Personal Access Token saved.');
    return this.view();
  }

  removeToken(): AzureDevOpsView {
    this.d.store.saveConfig(PAT_KEY, null);
    this.d.audit('azure-devops.token', 'azure-devops', 'Personal Access Token removed.');
    return this.view();
  }

  // ---------- REST ----------

  private async call<T>(
    method: string,
    path: string,
    body?: unknown,
    contentType = 'application/json',
  ): Promise<T> {
    const config = this.config();
    const token = this.token();
    if (!config || !token)
      throw new HttpError(
        409,
        'azure-devops-not-configured',
        this.view().reason ?? 'Connect Azure DevOps first.',
      );
    const url = `${config.orgUrl}/${encodeURIComponent(config.project)}/_apis/${path}${path.includes('?') ? '&' : '?'}${API}`;
    const doFetch = this.d.fetch ?? fetch;
    let res: Response;
    try {
      res = await doFetch(url, {
        method,
        headers: {
          Authorization: `Basic ${Buffer.from(`:${token}`).toString('base64')}`,
          Accept: 'application/json',
          ...(body !== undefined && { 'Content-Type': contentType }),
        },
        ...(body !== undefined && { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw new HttpError(
        502,
        'azure-devops-unreachable',
        'Azure DevOps could not be reached. Check the organization URL and the network.',
      );
    }
    if (res.status === 401 || res.status === 403) {
      throw new HttpError(
        400,
        'azure-devops-auth',
        'Azure DevOps refused the token. Check it has not expired and has Test Management and Work Items scopes.',
      );
    }
    if (res.status === 404)
      throw new HttpError(
        404,
        'azure-devops-not-found',
        'Azure DevOps has no such project, plan or suite.',
      );
    if (!res.ok)
      throw new HttpError(502, 'azure-devops-failed', `Azure DevOps answered ${res.status}.`);
    // Some PATCH answers are empty.
    const text = await res.text();
    return (text ? JSON.parse(text) : {}) as T;
  }

  /** Checks the address, project and token with one cheap read. */
  async test(): Promise<{ ok: boolean; message: string }> {
    try {
      const plans = await this.plans();
      return {
        ok: true,
        message: `Connected. ${plans.length} test plan${plans.length === 1 ? '' : 's'} found.`,
      };
    } catch (e) {
      return {
        ok: false,
        message: e instanceof HttpError ? e.message : 'The connection could not be checked.',
      };
    }
  }

  async plans(): Promise<PlanItem[]> {
    const r = await this.call<{ value?: { id: number; name: string; state?: string }[] }>(
      'GET',
      'testplan/plans',
    );
    return (r.value ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      ...(p.state && { state: p.state }),
    }));
  }

  async suites(planId: number): Promise<SuiteItem[]> {
    const r = await this.call<{
      value?: { id: number; name: string; parentSuite?: { id: number } }[];
    }>('GET', `testplan/Plans/${planId}/suites`);
    return (r.value ?? []).map((s) => ({
      id: s.id,
      name: s.name,
      ...(s.parentSuite?.id && { parentId: s.parentSuite.id }),
    }));
  }

  /** Work item IDs of the test cases in a plan's suite. */
  private async caseIdsOf(planId: number, suiteId: number): Promise<number[]> {
    const r = await this.call<{ value?: { workItem?: { id: number } }[] }>(
      'GET',
      `testplan/Plans/${planId}/Suites/${suiteId}/TestCase`,
    );
    return [...new Set((r.value ?? []).flatMap((v) => (v.workItem?.id ? [v.workItem.id] : [])))];
  }

  // ---------- import ----------

  /** Import (or refresh) a suite's test cases. Their filing hints place new cases under the chosen suite and version. */
  async importCases(body: unknown): Promise<ImportOutcome> {
    const p = Target.safeParse(body);
    if (!p.success) throw new HttpError(400, 'invalid-request', 'Choose a test plan and suite.');
    const config = this.config();
    const t = {
      ...p.data,
      projectId: p.data.projectId ?? config?.projectId,
      testSuiteId: p.data.testSuiteId ?? config?.testSuiteId,
      projectVersionId: p.data.projectVersionId ?? config?.projectVersionId,
    };
    const suiteName = (await this.suites(t.planId)).find((s) => s.id === t.suiteId)?.name;
    const ids = await this.caseIdsOf(t.planId, t.suiteId);
    let added = 0;
    let updated = 0;
    const caseIds: string[] = [];
    for (let i = 0; i < ids.length; i += BATCH) {
      const r = await this.call<{ value?: { id: number; fields: Record<string, unknown> }[] }>(
        'POST',
        'wit/workitemsbatch',
        {
          ids: ids.slice(i, i + BATCH),
          fields: FIELDS,
        },
      );
      for (const wi of r.value ?? []) {
        const f = wi.fields;
        const id = `ADO-${wi.id}`;
        const steps = parseSteps(
          typeof f['Microsoft.VSTS.TCM.Steps'] === 'string'
            ? f['Microsoft.VSTS.TCM.Steps']
            : undefined,
        );
        const title = plainText(String(f['System.Title'] ?? '')) || `Work item ${wi.id}`;
        const description = plainText(
          typeof f['System.Description'] === 'string' ? f['System.Description'] : undefined,
        );
        const priority = priorityOf(f['Microsoft.VSTS.Common.Priority']);
        const tags = String(f['System.Tags'] ?? '')
          .split(';')
          .map((s) => s.trim())
          .filter(Boolean);
        const existing = this.d.inventory.get(id);
        const tc: TestCase = {
          schemaVersion: SCHEMA_VERSION,
          id,
          title: title.slice(0, 500),
          ...(description && { description }),
          ...(suiteName && { module: suiteName }),
          steps: steps.map((s, n) => ({
            order: n + 1,
            action: s.action.slice(0, 2000),
            ...(s.expected && { expected: s.expected.slice(0, 2000) }),
          })),
          ...(priority && { priority }),
          tags,
          dependsOn: [],
          readiness: existing?.readiness ?? 'needs-clarification',
          source: {
            workbook: SOURCE_NAME,
            worksheet: `Plan ${t.planId} / Suite ${t.suiteId}`,
            rowNumber: wi.id,
          },
          // An existing case keeps the project people filed it under; a new one is filed in the chosen project.
          ...(existing?.projectId !== undefined
            ? { projectId: existing.projectId, projectName: existing.projectName }
            : t.projectId !== undefined && { projectId: t.projectId }),
          ...(t.testSuiteId && { testSuiteId: t.testSuiteId }),
          ...(t.projectVersionId && { projectVersionId: t.projectVersionId }),
        };
        if (existing) updated++;
        else added++;
        this.d.inventory.set(id, tc);
        caseIds.push(id);
      }
    }
    this.d.audit(
      'azure-devops.import',
      `plan ${t.planId}`,
      `Imported ${added} and updated ${updated} test cases from suite ${t.suiteId}.`,
    );
    return { added, updated, caseIds };
  }

  // ---------- publish results ----------

  /** Report a finished QA Studio run back to Azure DevOps as a test run on the suite's test points. */
  async publishResults(
    body: unknown,
  ): Promise<{ azureRunId: number; url?: string; published: number }> {
    const p = z
      .object({
        planId: z.number().int().positive(),
        suiteId: z.number().int().positive(),
        run: z.custom<Run>((v) => typeof v === 'object' && v !== null),
      })
      .parse(body);
    const run = p.run;
    // Worst result per work item, across accounts.
    const byItem = new Map<number, { status: string; message?: string; ms: number }>();
    for (const c of run.cases) {
      const tc = this.d.inventory.get(c.caseId);
      if (tc?.source.workbook !== SOURCE_NAME) continue;
      const wi = tc.source.rowNumber;
      const prev = byItem.get(wi);
      if (!prev || (RANK[c.status] ?? 0) > (RANK[prev.status] ?? 0)) {
        byItem.set(wi, {
          status: c.status,
          ...(c.failure?.message && { message: c.failure.message }),
          ms: c.steps.reduce((n, s) => n + (s.durationMs ?? 0), 0),
        });
      }
    }
    if (byItem.size === 0)
      throw new HttpError(
        400,
        'nothing-to-publish',
        'This run has no test cases imported from Azure DevOps.',
      );
    const points = await this.call<{
      value?: { id: number; testCaseReference?: { id: number } }[];
    }>('GET', `testplan/Plans/${p.planId}/Suites/${p.suiteId}/TestPoint`);
    const pointIds = (points.value ?? [])
      .filter((pt) => pt.testCaseReference && byItem.has(pt.testCaseReference.id))
      .map((pt) => pt.id);
    if (pointIds.length === 0)
      throw new HttpError(
        409,
        'no-test-points',
        'The suite has no test points for these test cases.',
      );
    const azureRun = await this.call<{ id: number; webAccessUrl?: string }>('POST', 'test/runs', {
      name: `QA Studio run ${run.id.slice(0, 8)}`,
      plan: { id: String(p.planId) },
      pointIds,
      automated: true,
      comment: `Results of QA Studio run ${run.id}.`,
    });
    const results = await this.call<{ value?: { id: number; testCase?: { id: string } }[] }>(
      'GET',
      `test/Runs/${azureRun.id}/results`,
    );
    const updates = (results.value ?? []).flatMap((r) => {
      const outcome = byItem.get(Number(r.testCase?.id));
      if (!outcome) return [];
      return [
        {
          id: r.id,
          state: 'Completed',
          outcome: outcomeOf(outcome.status),
          durationInMs: outcome.ms,
          ...(outcome.message && { errorMessage: outcome.message.slice(0, 1000) }),
        },
      ];
    });
    if (updates.length > 0) await this.call('PATCH', `test/Runs/${azureRun.id}/results`, updates);
    await this.call('PATCH', `test/runs/${azureRun.id}`, { state: 'Completed' });
    this.d.audit(
      'azure-devops.publish',
      `run ${run.id}`,
      `Published ${updates.length} results to Azure DevOps run ${azureRun.id}.`,
    );
    return {
      azureRunId: azureRun.id,
      ...(azureRun.webAccessUrl && { url: azureRun.webAccessUrl }),
      published: updates.length,
    };
  }

  // ---------- automated pipeline ----------

  jobsList(): PipelineJob[] {
    return [...this.jobs].reverse();
  }

  /**
   * Start the full pipeline as a background job. One at a time: a second start while one runs is refused, because two
   * pipelines would race for the same cases and runs execute one at a time anyway.
   */
  startPipeline(body: unknown, host: PipelineHost): PipelineJob {
    if (this.active?.status === 'running') {
      throw new HttpError(
        409,
        'pipeline-running',
        'An Azure DevOps pipeline is already running. Wait for it to finish.',
      );
    }
    const config = this.config();
    const p = z
      .object({
        planId: z.number().int().positive().optional(),
        suiteId: z.number().int().positive().optional(),
        accountIds: z.array(z.string().min(1)).max(20).optional(),
      })
      .parse(body ?? {});
    const planId = p.planId ?? config?.planId;
    const suiteId = p.suiteId ?? config?.suiteId;
    if (!config || !this.token())
      throw new HttpError(
        409,
        'azure-devops-not-configured',
        this.view().reason ?? 'Connect Azure DevOps first.',
      );
    if (!planId || !suiteId)
      throw new HttpError(400, 'invalid-request', 'Choose the test plan and suite to automate.');
    const stages: PipelineStage[] = [
      'import',
      'convert',
      'approve',
      'parameters',
      'run',
      'publish',
    ];
    const job: PipelineJob = {
      id: randomUUID(),
      status: 'running',
      startedAt: (this.d.now?.() ?? new Date()).toISOString(),
      planId,
      suiteId,
      steps: stages.map((stage) => ({ stage, status: 'pending' })),
      caseIds: [],
    };
    this.jobs.push(job);
    if (this.jobs.length > MAX_JOBS_KEPT) this.jobs.shift();
    this.active = job;
    void this.execute(job, config, p.accountIds ?? config.accountIds, host);
    return job;
  }

  private step(
    job: PipelineJob,
    stage: PipelineStage,
    status: PipelineStep['status'],
    message?: string,
  ): void {
    const s = job.steps.find((x) => x.stage === stage)!;
    s.status = status;
    if (message !== undefined) s.message = message;
    this.d.publish?.(job);
  }

  private async execute(
    job: PipelineJob,
    config: AzureDevOpsConfig,
    accountIds: string[],
    host: PipelineHost,
  ): Promise<void> {
    let stage: PipelineStage = 'import';
    try {
      this.step(job, stage, 'running');
      const imported = await this.importCases({ planId: job.planId, suiteId: job.suiteId });
      job.caseIds = imported.caseIds;
      this.step(job, stage, 'done', `${imported.added} added, ${imported.updated} updated.`);
      if (job.caseIds.length === 0) throw new Error('The suite has no test cases.');

      stage = 'convert';
      this.step(job, stage, 'running');
      const converted = await host.convert(job.caseIds);
      this.step(
        job,
        stage,
        'done',
        `${converted.ready} ready, ${converted.needsReview} need review.`,
      );

      stage = 'approve';
      if (config.autoApprove) {
        this.step(job, stage, 'running');
        const approved = await host.approve(job.caseIds);
        this.step(job, stage, 'done', `${approved} approved.`);
      } else
        this.step(
          job,
          stage,
          'skipped',
          'Automatic approval is off: approve drafts on the Test Design page.',
        );

      const runnable = host.runnable(job.caseIds);
      stage = 'parameters';
      if (config.autoParameters && runnable.length > 0) {
        this.step(job, stage, 'running');
        const missing = await host.configure(runnable);
        this.step(
          job,
          stage,
          'done',
          missing === 0
            ? 'Every parameter has a value.'
            : `${missing} cases still miss a value and will be blocked.`,
        );
      } else this.step(job, stage, 'skipped');

      stage = 'run';
      if (runnable.length === 0)
        throw new Error('No test case is ready to run. Review the drafts on the Test Design page.');
      this.step(job, stage, 'running', `${runnable.length} test cases.`);
      const run = await host.run(runnable, accountIds);
      job.runId = run.id;
      const passed = run.cases.filter((c) => c.status === 'passed').length;
      this.step(job, stage, 'done', `${passed} of ${run.cases.length} passed.`);

      stage = 'publish';
      if (config.publishResults) {
        this.step(job, stage, 'running');
        const published = await this.publishResults({
          planId: job.planId,
          suiteId: job.suiteId,
          run,
        });
        job.azureRunId = published.azureRunId;
        if (published.url) job.azureRunUrl = published.url;
        this.step(job, stage, 'done', `${published.published} results published.`);
      } else this.step(job, stage, 'skipped');
      job.status = 'done';
    } catch (e) {
      const message = e instanceof Error ? e.message : 'The pipeline stopped.';
      this.step(job, stage, 'failed', message);
      for (const s of job.steps) if (s.status === 'pending') s.status = 'skipped';
      job.status = 'failed';
      job.error = message;
    } finally {
      job.endedAt = (this.d.now?.() ?? new Date()).toISOString();
      this.d.audit(
        'azure-devops.pipeline',
        job.id,
        `Pipeline ${job.status}${job.error ? `: ${job.error}` : ''}.`,
      );
      this.d.publish?.(job);
    }
  }
}
