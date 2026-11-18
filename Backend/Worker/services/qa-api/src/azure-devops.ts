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
 * - **Report defects**: a case that failed twice and was diagnosed as a likely defect becomes a Bug, built from the
 *   run's own evidence (never from model text), with a duplicate check and a cap per run. Needs Work Items write.
 *
 * The pipeline drives the same HTTP routes a person uses (through `PipelineHost`), so every safety rule of a manual
 * run (allowed environments, project readiness, accounts, destructive steps) applies unchanged.
 */
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { redact, SCHEMA_VERSION, type Run, type TestCase } from '@qa-studio/shared';
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
  /** Where filed bugs go; Azure DevOps uses the project's defaults when left out. */
  bugAreaPath: z.string().trim().max(400).optional(),
  bugIterationPath: z.string().trim().max(400).optional(),
  /** Such as "3 - Medium". */
  bugSeverity: z.string().trim().max(50).optional(),
  /** New bugs one run may file; the rest are left for a person. */
  maxBugsPerRun: z.number().int().min(1).max(50).optional(),
});
export type AzureDevOpsConfig = z.infer<typeof Config>;
/** Settings only an API call sets for now; see `update`. */
const BUG_SETTINGS = ['bugAreaPath', 'bugIterationPath', 'bugSeverity', 'maxBugsPerRun'] as const;

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

/** A work item as an assistant reads it: plain text, line breaks kept. */
export interface WorkItemView {
  id: number;
  type: string;
  state: string;
  title: string;
  description: string;
  acceptanceCriteria: string;
  tags: string[];
  areaPath?: string;
  iterationPath?: string;
  url: string;
}

/** Everything the HTTP layer knows about the failure being reported. */
export interface DefectInput {
  run: Run;
  caseId: string;
  account?: string | undefined;
  /** The work item (usually the story under test) to link the bug to. */
  storyId?: number | undefined;
  /** Verdict of the latest diagnosis of this case in this run, if any. */
  verdict: string | undefined;
  /** Whether the same case also failed in another run, so a flaky failure is not reported. */
  failedBefore: boolean;
  /** The failure screenshot, when the run kept one. */
  screenshot?: { name: string; data: Buffer } | undefined;
}

export interface DefectOutcome {
  action: 'filed' | 'commented';
  bugId: number;
  url: string;
  signature: string;
}

/** New bugs one run may file when the settings do not say. */
export const DEFAULT_MAX_BUGS_PER_RUN = 5;
/** Largest screenshot attached to a bug. */
const MAX_SCREENSHOT_BYTES = 4 * 1024 * 1024;
/** States in which a bug no longer counts as open for the duplicate check. */
const CLOSED_STATES = ['Closed', 'Done', 'Removed', 'Resolved'];
const PATCH_JSON = 'application/json-patch+json';

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

/** Rich text (HTML) to plain text that keeps paragraphs and list items on their own lines. */
export function multilineText(html: string | undefined): string {
  if (!html) return '';
  return decodeEntities(
    html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<li[^>]*>/gi, '- ')
      .replace(/<\/(p|div|li|h\d)>/gi, '\n')
      .replace(/<[^>]+>/g, ''),
  )
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * What makes two failures "the same bug": the case, the failing step and the message with its numbers taken out (so
 * a changed count or timeout does not make a new bug). Stored on the bug as a tag.
 */
export function defectSignature(caseId: string, action: string, message: string): string {
  const normalised = message
    .toLowerCase()
    .replace(/\d+/g, '#')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
  const hash = createHash('sha256').update(`${caseId}|${action}|${normalised}`).digest('hex');
  return `qa-sig-${hash.slice(0, 12)}`;
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
  /** New bugs filed per run, for the cap. In memory: after a restart the count starts again. */
  private readonly filed = new Map<string, number>();

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
    // The Settings page does not show the bug settings yet, so a save that leaves them out keeps the current ones.
    const current = this.config();
    const kept = Object.fromEntries(
      BUG_SETTINGS.flatMap((k) =>
        current?.[k] !== undefined && p.data[k] === undefined ? [[k, current[k]]] : [],
      ),
    );
    this.d.store.saveConfig(CONFIG_KEY, { ...kept, ...p.data });
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
        // Raw bytes (an attachment) go as they are; everything else is JSON.
        ...(body !== undefined && {
          body: body instanceof Uint8Array ? body : JSON.stringify(body),
        }),
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

  // ---------- work items and defects ----------

  /** A work item (a story, usually) with its acceptance criteria. Needs only Work Items read. */
  async workItem(id: number): Promise<WorkItemView> {
    const r = await this.call<{ id: number; fields?: Record<string, unknown> }>(
      'GET',
      `wit/workitems/${id}?fields=System.WorkItemType,System.State,System.Title,System.Description,Microsoft.VSTS.Common.AcceptanceCriteria,System.Tags,System.AreaPath,System.IterationPath`,
    );
    const f = r.fields ?? {};
    const text = (key: string) => {
      const v = f[key];
      return typeof v === 'string' ? v : undefined;
    };
    const areaPath = text('System.AreaPath');
    const iterationPath = text('System.IterationPath');
    return {
      id: r.id,
      type: text('System.WorkItemType') ?? '',
      state: text('System.State') ?? '',
      title: plainText(text('System.Title')),
      description: multilineText(text('System.Description')),
      acceptanceCriteria: multilineText(text('Microsoft.VSTS.Common.AcceptanceCriteria')),
      tags: (text('System.Tags') ?? '')
        .split(';')
        .map((t) => t.trim())
        .filter(Boolean),
      ...(areaPath && { areaPath }),
      ...(iterationPath && { iterationPath }),
      url: this.editUrl(r.id),
    };
  }

  /**
   * File a Bug for a failed case, or comment on the open bug that already has the same failure. Refused unless the
   * case failed twice and its diagnosis says the app is likely wrong, so a flaky or out-of-date test never becomes a
   * bug. The content comes from the test case and the run, never from model text.
   */
  async reportDefect(input: DefectInput): Promise<DefectOutcome> {
    const { run, caseId } = input;
    const result = run.cases.find(
      (c) => c.caseId === caseId && (input.account === undefined || c.account === input.account),
    );
    if (!result) throw new HttpError(404, 'unknown-case', `Run has no result for ${caseId}.`);
    this.assertReportable(caseId, result.status, input);

    const failedStep = result.steps.find((s) => s.status === 'failed');
    const failure = this.failureOf(result.failure ?? failedStep?.failure);
    const action = failedStep?.action ?? 'unknown step';
    const signature = defectSignature(caseId, action, failure.message);
    const runLabel = `run ${run.id.slice(0, 8)}${result.account ? ` as ${result.account}` : ''}`;

    const duplicate = await this.openBugWith(signature);
    if (duplicate !== undefined) {
      // Same failure already reported and still open: add the new evidence there instead of filing again.
      await this.call(
        'PATCH',
        `wit/workitems/${duplicate}`,
        [
          {
            op: 'add',
            path: '/fields/System.History',
            value: `Failed again in QA Studio ${escapeHtml(runLabel)} (${escapeHtml(run.createdAt)}): ${escapeHtml(failure.message)}`,
          },
        ],
        PATCH_JSON,
      );
      this.d.audit(
        'azure-devops.defect',
        caseId,
        `Bug ${duplicate} commented: failed again in ${runLabel}.`,
      );
      return { action: 'commented', bugId: duplicate, url: this.editUrl(duplicate), signature };
    }

    const config = this.config();
    const cap = config?.maxBugsPerRun ?? DEFAULT_MAX_BUGS_PER_RUN;
    const count = this.filed.get(run.id) ?? 0;
    if (count >= cap) {
      throw new HttpError(
        429,
        'defect-cap',
        `This run already filed ${count} bugs (the limit is ${cap}). List the remaining failures for a person instead.`,
      );
    }

    const testCase = this.d.inventory.get(caseId);
    const title = `[QA Studio] ${caseId} ${testCase?.title ?? result.title ?? ''}: ${action}`
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 255);
    const steps = (testCase?.steps ?? [])
      .map(
        (s) =>
          `<li>${escapeHtml(s.action)}${s.expected ? ` <i>Expected: ${escapeHtml(s.expected)}</i>` : ''}</li>`,
      )
      .join('');
    const repro = [
      `<p>Found by QA Studio in ${escapeHtml(runLabel)} on ${escapeHtml(run.environment)} (${escapeHtml(run.browser)}), ${escapeHtml(run.createdAt)}. It failed again after a rerun and was diagnosed as a likely defect.</p>`,
      testCase?.preconditions
        ? `<p><b>Preconditions:</b> ${escapeHtml(testCase.preconditions)}</p>`
        : '',
      steps ? `<p><b>Steps:</b></p><ol>${steps}</ol>` : '',
      `<p><b>Failing step:</b> ${escapeHtml(failedStep?.description ?? action)}</p>`,
      `<p><b>Expected:</b> ${escapeHtml(failure.expected ?? testCase?.expectedResult ?? 'see the test case')}</p>`,
      `<p><b>Actual:</b> ${escapeHtml(failure.actual ?? failure.message)}</p>`,
      `<p><b>Evidence:</b> QA Studio › Runs › ${escapeHtml(run.id)}${result.artifacts.length ? ` (${result.artifacts.map(escapeHtml).join(', ')})` : ''}</p>`,
    ].join('');

    const field = (path: string, value: string | undefined) =>
      value ? [{ op: 'add', path: `/fields/${path}`, value }] : [];
    const link = (rel: string, url: string) => [
      { op: 'add', path: '/relations/-', value: { rel, url } },
    ];
    const workItemUrl = (id: number) => `${config?.orgUrl ?? ''}/_apis/wit/workItems/${id}`;
    const testCaseWorkItem = /^ADO-(\d+)$/.exec(caseId)?.[1];
    const attachment = await this.uploadScreenshot(input.screenshot);

    const bug = await this.call<{ id: number }>(
      'POST',
      'wit/workitems/$Bug',
      [
        ...field('System.Title', title),
        ...field('Microsoft.VSTS.TCM.ReproSteps', repro),
        ...field('System.Tags', `qa-studio; ai-filed; ${signature}`),
        ...field('Microsoft.VSTS.Common.Severity', config?.bugSeverity),
        ...field('System.AreaPath', config?.bugAreaPath),
        ...field('System.IterationPath', config?.bugIterationPath),
        ...(testCaseWorkItem
          ? link('Microsoft.VSTS.Common.TestedBy-Forward', workItemUrl(Number(testCaseWorkItem)))
          : []),
        ...(input.storyId ? link('System.LinkTypes.Related', workItemUrl(input.storyId)) : []),
        ...(attachment ? link('AttachedFile', attachment) : []),
      ],
      PATCH_JSON,
    );
    this.filed.set(run.id, count + 1);
    this.d.audit('azure-devops.defect', caseId, `Bug ${bug.id} filed from ${runLabel}.`);
    return { action: 'filed', bugId: bug.id, url: this.editUrl(bug.id), signature };
  }

  /** The rules that keep flaky and out-of-date tests out of the bug tracker. */
  private assertReportable(caseId: string, status: string, input: DefectInput): void {
    if (status !== 'failed') {
      throw new HttpError(
        409,
        'not-failed',
        `${caseId} did not fail in this run; there is nothing to report.`,
      );
    }
    if (!input.failedBefore) {
      throw new HttpError(
        409,
        'not-confirmed',
        `${caseId} has failed only once. Run it again (rerun_failed_cases); a bug is filed only for a case that fails twice.`,
      );
    }
    if (input.verdict !== 'likely-defect') {
      throw new HttpError(
        409,
        'not-a-defect',
        input.verdict
          ? `The diagnosis of ${caseId} in this run is "${input.verdict}", not a likely defect; no bug is filed.`
          : `Diagnose ${caseId} in this run first (diagnose_failed_case); a bug is filed only for a likely defect.`,
      );
    }
  }

  /** The recorded failure with any token masked, or a placeholder when the run did not record one. */
  private failureOf(raw: unknown): {
    message: string;
    expected?: string | undefined;
    actual?: string | undefined;
  } {
    const f = z
      .object({
        message: z.string(),
        expected: z.string().optional(),
        actual: z.string().optional(),
      })
      .safeParse(redact(raw));
    return f.success ? f.data : { message: 'The run did not record why.' };
  }

  /** The newest open bug carrying this failure signature. */
  private async openBugWith(signature: string): Promise<number | undefined> {
    const states = CLOSED_STATES.map((s) => `'${s}'`).join(', ');
    const r = await this.call<{ workItems?: { id: number }[] }>('POST', 'wit/wiql', {
      query: `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project AND [System.WorkItemType] = 'Bug' AND [System.Tags] CONTAINS '${signature}' AND [System.State] NOT IN (${states}) ORDER BY [System.Id] DESC`,
    });
    return r.workItems?.[0]?.id;
  }

  private editUrl(id: number): string {
    const config = this.config();
    return `${config?.orgUrl ?? ''}/${encodeURIComponent(config?.project ?? '')}/_workitems/edit/${id}`;
  }

  /** Uploads the failure screenshot; a missing, oversized or refused one leaves the bug without it. */
  private async uploadScreenshot(shot: DefectInput['screenshot']): Promise<string | undefined> {
    if (!shot || shot.data.length === 0 || shot.data.length > MAX_SCREENSHOT_BYTES)
      return undefined;
    try {
      const r = await this.call<{ url?: string }>(
        'POST',
        `wit/attachments?fileName=${encodeURIComponent(shot.name)}`,
        shot.data,
        'application/octet-stream',
      );
      return r.url;
    } catch {
      return undefined; // the bug matters more than its picture
    }
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
