import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import {
  CASE_FORMATS,
  COVERAGE_LEVELS,
  MAX_PROMPT_CHARS,
  MAX_PROPOSED_THOROUGH,
  ProposedCaseSchema,
  diagnoseFailure,
  generateScenario,
  type Diagnosis,
  proposeCases,
  proposeOrAsk,
  resolveSkills,
  toTestCases,
  TooManySkillsError,
  type ActionInfo,
  type ProposeOptions,
  type ProposeOutcome,
  type ProposedCase,
  type Skill,
  type SkillUsage,
  type StepDraft,
} from '@qa-studio/agents';
import type { KnowledgeIndex } from '@qa-studio/knowledge';
import { ATTACHMENT_TYPES, LlmError, completeJson } from '@qa-studio/llm';
import type { ExploredPage } from '@qa-studio/execution-engine';
import type { Run, TestCase } from '@qa-studio/shared';
import type { AiService } from './ai-service.js';
import { HttpError } from './errors.js';
import type { EventBus } from './events.js';
import type { ScenarioService } from './scenario-service.js';

export const MAX_GENERATE = 25;

export type GenerateResultKind = 'drafted' | 'needs-fixing' | 'unmappable' | 'failed' | 'skipped';

export interface GenerateResult {
  caseId: string;
  outcome: GenerateResultKind;
  /** One line for the reviewer: why it could not be automated, what is wrong, or what parameters it needs. */
  message?: string;
}

export interface GenerateJob {
  id: string;
  status: 'running' | 'done' | 'cancelled' | 'failed';
  provider: string;
  model: string;
  total: number;
  done: number;
  startedAt: string;
  /** Every case the job writes steps for, so pages can hold those cases still until it ends. */
  caseIds: string[];
  endedAt?: string;
  results: GenerateResult[];
  /** Set when the whole job stopped early (for example the API key was rejected). */
  stoppedBecause?: string;
}

export interface AiTasksDeps {
  ai: AiService;
  knowledge: KnowledgeIndex;
  scenarios: ScenarioService;
  actions(): ActionInfo[];
  inventory: Map<string, TestCase>;
  events: EventBus;
  audit(action: string, target: string, detail: string): void;
  /** Finished runs, for diagnosing a failure. */
  runs?: { get(id: string): Run | undefined };
  /** Where run evidence is kept (the page text captured at a failure is read from here). */
  artifactsDir?: string;
  /** Page names go-to-page accepts for a project (shared pages plus the project's own). */
  pages?(projectId?: number): string[];
  /** Visit pages of the app read-only and return what they show. */
  explore?: (paths: string[], accountId: string | undefined) => Promise<ExploredPage[]>;
  /** Saved skills a prompt can call with `/skill-name` (AI Assistant › Skills). */
  skills?: () => Skill[];
}

/** Steps the AI proposes after a tester asked for a change. Not saved. */
export interface RevisedSteps {
  steps: StepDraft[];
  /** What the AI based them on, its assumptions, and what needs parameters or a manual check. */
  note: string;
  /** Problems the AI could not fix; the tester sees them on the steps after accepting. */
  issues: string[];
  warnings: string[];
}

/** Proposed cases, and which skills the prompt called. */
export interface CasePreview {
  cases: ProposedCase[];
  skills: SkillUsage;
}

/** Pages worth knowing for this app, offered as the starting list. Taken from the first target application's route table; edit the list in the app for others. */
export const DEFAULT_EXPLORE_PATHS = [
  '/dashboard',
  '/projects/draft-list',
  '/lrp/draft-list',
  '/clubbed/draft-list',
  '/open-projects',
  '/my-projects',
  '/roles-and-permissions',
];
export const MAX_EXPLORE = 10;

const PagePath = z
  .string()
  .trim()
  .max(200)
  .regex(/^\/(?!\/)[^\s\\]*$/, 'Use a path inside the app, such as /projects/draft-list.');

/** One explored page, without its text (that goes to the knowledge index, not back to the browser). */
export type ExploreResult = Omit<ExploredPage, 'snapshot'> & { chars?: number };

export interface DiagnoseResponse {
  verdict: Diagnosis['verdict'];
  explanation: string;
  /** Set when a corrected draft was saved for review. */
  draft?: { version: number; status: string; issues: string[] };
}

/** What a model failure looks like to the person using the page: a plain message, never a stack or a key. */
/** Optional generator tuning sent with a preview request. */
const ProposeOptionsSchema = z.object({
  coverage: z.enum(COVERAGE_LEVELS).optional(),
  format: z.enum(CASE_FORMATS).optional(),
  spoken: z.boolean().optional(),
});

/** Most files one generation request may carry. */
export const MAX_ATTACHMENTS = 5;
/** Largest image or PDF, as base64 (about 4 MB of file); the page scales screenshots down well below this. */
const MAX_ATTACHMENT_BASE64 = 5_600_000;
/** Largest text file, in characters, and all text files together, so the prompt stays within the model's budget. */
const MAX_ATTACHMENT_TEXT = 30_000;
const MAX_ATTACHMENTS_TEXT = 60_000;

/**
 * Files attached to a generation request. Images and PDFs arrive base64-encoded and go to the model as files; text
 * files arrive already read as text (`text/plain`) and go in as quoted data.
 */
const AttachmentsSchema = z
  .array(
    z.discriminatedUnion('mediaType', [
      z.object({
        name: z.string().trim().min(1).max(200),
        mediaType: z.enum(ATTACHMENT_TYPES),
        data: z
          .string()
          .min(1)
          .max(MAX_ATTACHMENT_BASE64, 'A file is too large; attach files up to 4 MB.')
          .regex(/^[A-Za-z0-9+/]+={0,2}$/, 'A file could not be read.'),
      }),
      z.object({
        name: z.string().trim().min(1).max(200),
        mediaType: z.literal('text/plain'),
        data: z.string().max(MAX_ATTACHMENT_TEXT, 'A text file is too long to send.'),
      }),
    ]),
  )
  .max(MAX_ATTACHMENTS, `Attach up to ${MAX_ATTACHMENTS} files.`)
  .refine(
    (list) =>
      list.reduce((n, a) => n + (a.mediaType === 'text/plain' ? a.data.length : 0), 0) <=
      MAX_ATTACHMENTS_TEXT,
    'The attached text files are too long together; attach fewer.',
  );

/** The audit trail's note of attached files: how many, never their content. */
const fileNote = (input: { files?: unknown[]; documents?: unknown[] }) => {
  const n = (input.files?.length ?? 0) + (input.documents?.length ?? 0);
  return n > 0 ? ` Files attached: ${n}.` : '';
};

/** The audit trail's note of which skills a generation used. */
const skillNote = (u: SkillUsage) =>
  u.applied.length > 0 ? ` Skills: ${u.applied.join(', ')}.` : '';

function toHttp(e: unknown): HttpError {
  if (e instanceof HttpError) return e;
  if (e instanceof LlmError) {
    const status =
      e.kind === 'auth' || e.kind === 'budget' ? 400 : e.kind === 'rate-limit' ? 429 : 502;
    return new HttpError(status, `ai-${e.kind}`, e.message);
  }
  return new HttpError(500, 'ai-failed', 'The AI request could not be completed.');
}

/**
 * The AI jobs the dashboard starts: generating automation drafts for test cases, and proposing test cases from a
 * prompt. Everything the model produces lands as a draft or a preview for a person to review; nothing runs, and no
 * approved scenario is touched.
 */
export class AiTasks {
  private current: { job: GenerateJob; abort: AbortController } | undefined;
  private readonly history: GenerateJob[] = [];

  constructor(private readonly d: AiTasksDeps) {}

  private publish(job: GenerateJob): void {
    this.d.events.emit({ type: 'job', id: job.id, status: job.status });
  }

  jobs(): GenerateJob[] {
    return [...(this.current ? [this.current.job] : []), ...[...this.history].reverse()].map((j) =>
      structuredClone(j),
    );
  }

  job(id: string): GenerateJob | undefined {
    return this.jobs().find((j) => j.id === id);
  }

  startGeneration(caseIds: unknown): GenerateJob {
    const ids = z.array(z.string().min(1)).min(1).max(MAX_GENERATE).safeParse(caseIds);
    if (!ids.success) {
      throw new HttpError(
        400,
        'invalid-request',
        `Choose between 1 and ${MAX_GENERATE} test cases to generate for.`,
      );
    }
    const unique = [...new Set(ids.data)];
    const missing = unique.filter((id) => !this.d.inventory.has(id));
    if (missing.length > 0) {
      throw new HttpError(
        404,
        'unknown-case',
        `No such test case: ${missing.slice(0, 3).join(', ')}.`,
      );
    }
    if (this.current) {
      throw new HttpError(
        409,
        'job-running',
        'A generation is already running. Wait for it or cancel it first.',
      );
    }
    // Fail now, with a message that says what to configure, instead of inside the job.
    let info: { provider: string; model: string };
    try {
      info = this.d.ai.gateway().info;
    } catch (e) {
      throw toHttp(e); // AI off or no key: say what to configure, as a normal message
    }
    const { provider, model } = info;
    const job: GenerateJob = {
      id: crypto.randomUUID(),
      status: 'running',
      provider,
      model,
      total: unique.length,
      done: 0,
      startedAt: new Date().toISOString(),
      caseIds: unique,
      results: [],
    };
    const abort = new AbortController();
    this.current = { job, abort };
    this.d.audit(
      'ai.generate',
      'scenarios',
      `Started for ${unique.length} test case(s) with ${provider} ${model}.`,
    );
    this.publish(job);
    void this.run(job, unique, abort);
    return structuredClone(job);
  }

  cancel(id: string): boolean {
    if (this.current?.job.id !== id) return false;
    this.current.abort.abort();
    return true;
  }

  private async run(job: GenerateJob, ids: string[], abort: AbortController): Promise<void> {
    try {
      for (const caseId of ids) {
        if (abort.signal.aborted) break;
        const { result, fatal } = await this.one(caseId, abort.signal);
        job.results.push(result);
        job.done++;
        this.publish(job);
        // A rejected key or a spent quota would fail every remaining case the same way, so stop and say why.
        if (fatal) {
          job.stoppedBecause = result.message ?? 'The provider refused the requests.';
          break;
        }
      }
      for (const caseId of ids.slice(job.results.length)) {
        job.results.push({
          caseId,
          outcome: 'skipped',
          message: abort.signal.aborted ? 'Cancelled.' : 'Not attempted.',
        });
      }
      job.status = abort.signal.aborted ? 'cancelled' : 'done';
    } catch {
      job.status = 'failed';
    } finally {
      job.endedAt = new Date().toISOString();
      const counts = job.results.reduce<Record<string, number>>(
        (m, r) => ((m[r.outcome] = (m[r.outcome] ?? 0) + 1), m),
        {},
      );
      this.d.audit('ai.generate.done', 'scenarios', `${job.status}: ${JSON.stringify(counts)}.`);
      this.history.push(job);
      if (this.history.length > 10) this.history.shift();
      this.current = undefined;
      this.publish(job);
    }
  }

  private async one(
    caseId: string,
    signal: AbortSignal,
  ): Promise<{ result: GenerateResult; fatal?: boolean }> {
    const testCase = this.d.inventory.get(caseId);
    if (!testCase)
      return { result: { caseId, outcome: 'failed', message: 'The test case no longer exists.' } };
    try {
      // A fresh gateway per case, so the call budget is per task and one hard case cannot starve the rest.
      const gateway = this.d.ai.gateway();
      const out = await generateScenario({
        gateway,
        testCase,
        actions: this.d.actions(),
        knowledge: this.d.knowledge,
        signal,
        ...(this.d.pages && { pages: this.d.pages(testCase.projectId) }),
        validate: (steps) => this.d.scenarios.validate({ schemaVersion: 1, caseId, steps }),
      });
      if (out.status === 'unmappable') {
        const missing =
          out.missingCapabilities.length > 0
            ? ` Missing: ${out.missingCapabilities.join('; ')}.`
            : '';
        return { result: { caseId, outcome: 'unmappable', message: `${out.reason}${missing}` } };
      }
      this.d.scenarios.saveDraft(caseId, {
        steps: out.steps,
        ...(out.description && { description: out.description }),
        origin: 'ai',
        note: out.note,
      });
      return {
        result:
          out.status === 'drafted'
            ? {
                caseId,
                outcome: 'drafted',
                ...((out.dataNeeded.length > 0 || out.manualSteps.length > 0) && {
                  message: [
                    out.dataNeeded.length > 0 && `Needs parameters: ${out.dataNeeded.join(', ')}.`,
                    out.manualSteps.length > 0 && `Check by hand: ${out.manualSteps.join('; ')}.`,
                  ]
                    .filter(Boolean)
                    .join(' '),
                }),
              }
            : {
                caseId,
                outcome: 'needs-fixing',
                message: out.issues[0] ?? 'The draft still has problems.',
              },
      };
    } catch (e) {
      return {
        result: { caseId, outcome: 'failed', message: toHttp(e).message },
        fatal: e instanceof LlmError && (e.kind === 'auth' || e.kind === 'rate-limit'),
      };
    }
  }

  /** Ask for test cases from a description. `/skill-name` references apply saved skills. Nothing is saved. */
  async previewCases(
    prompt: unknown,
    projectId?: number,
    options?: unknown,
    attachments?: unknown,
  ): Promise<CasePreview> {
    try {
      const { input, usage } = this.proposeInput(prompt, projectId, options, attachments);
      const proposals = await proposeCases(input);
      this.d.audit(
        'ai.cases.preview',
        'test cases',
        `${proposals.length} proposed.${skillNote(usage)}${fileNote(input)}`,
      );
      return { cases: proposals, skills: usage };
    } catch (e) {
      throw toHttp(e);
    }
  }

  /**
   * Like `previewCases`, but the model may ask up to two clarifying questions first, when the description leaves out
   * something that changes the cases. Used by the voice conversation; nothing is saved either way.
   */
  async askOrPreviewCases(
    prompt: unknown,
    projectId?: number,
    options?: unknown,
    attachments?: unknown,
  ): Promise<ProposeOutcome & { skills: SkillUsage }> {
    try {
      const { input, usage } = this.proposeInput(prompt, projectId, options, attachments);
      const out = await proposeOrAsk(input);
      this.d.audit(
        'ai.cases.preview',
        'test cases',
        (out.kind === 'cases'
          ? `${out.cases.length} proposed.`
          : `${out.questions.length} clarifying question(s).`) +
          skillNote(usage) +
          fileNote(input),
      );
      return { ...out, skills: usage };
    } catch (e) {
      throw toHttp(e);
    }
  }

  /** Validates a generation request, resolves its `/skill-name` references and builds the generator's input. */
  private proposeInput(
    prompt: unknown,
    projectId: number | undefined,
    options: unknown,
    attachments?: unknown,
  ) {
    const p = z
      .string()
      .trim()
      .min(10, 'Describe what to test in a sentence or two.')
      .max(MAX_PROMPT_CHARS, `Keep the description under ${MAX_PROMPT_CHARS} characters.`)
      .safeParse(prompt);
    if (!p.success) {
      const message = p.error.issues[0]?.message ?? 'Describe what to test.';
      throw new HttpError(400, 'invalid-prompt', message, { prompt: message });
    }
    const o = ProposeOptionsSchema.safeParse(options ?? {});
    if (!o.success) {
      throw new HttpError(400, 'invalid-options', 'Coverage or format is not one of the choices.');
    }
    // Only defined values are passed on, so leaving the options out sends exactly the original prompt.
    const tuning: ProposeOptions = {
      ...(o.data.coverage && { coverage: o.data.coverage }),
      ...(o.data.format && { format: o.data.format }),
      ...(o.data.spoken && { spoken: true }),
    };
    const a = AttachmentsSchema.safeParse(attachments ?? []);
    if (!a.success) {
      const message = a.error.issues[0]?.message ?? 'An attached file could not be used.';
      throw new HttpError(400, 'invalid-attachments', message);
    }
    const files = a.data.flatMap((f) =>
      f.mediaType === 'text/plain' ? [] : [{ mediaType: f.mediaType, data: f.data }],
    );
    const documents = a.data.flatMap((f) =>
      f.mediaType === 'text/plain' ? [{ name: f.name, text: f.data }] : [],
    );
    const resolved = this.resolve(p.data);
    return {
      usage: resolved.usage,
      input: {
        gateway: this.d.ai.gateway(),
        prompt: resolved.prompt,
        knowledge: this.d.knowledge,
        ...(this.d.pages && { pages: this.d.pages(projectId) }),
        ...(resolved.skills.length > 0 && { skills: resolved.skills }),
        ...(files.length > 0 && { files }),
        ...(documents.length > 0 && { documents }),
        ...tuning,
      },
    };
  }

  /** Apply saved skills to a prompt. Without a skills store, the prompt is used exactly as written. */
  private resolve(prompt: string) {
    let resolved;
    try {
      resolved = resolveSkills(prompt, this.d.skills?.() ?? []);
    } catch (e) {
      if (e instanceof TooManySkillsError)
        throw new HttpError(400, 'too-many-skills', e.message, { prompt: e.message });
      throw e;
    }
    // A prompt that was only skill names gives the skills nothing to work on.
    if (resolved.skills.length > 0 && resolved.prompt.length < 10) {
      const message = 'Describe what to test after the skill name, in a sentence or two.';
      throw new HttpError(400, 'invalid-prompt', message, { prompt: message });
    }
    return resolved;
  }

  /**
   * Revise a case's steps as a tester asks ("also check the popup title"). The answer goes through the same checks and
   * repairs as new steps, and is only returned: the tester reviews it in the editor and saves it themselves.
   */
  async reviseSteps(input: unknown): Promise<RevisedSteps> {
    const p = z
      .object({
        caseId: z.string().min(1),
        steps: z
          .array(
            z.object({
              action: z.string().min(1).max(100),
              params: z.record(z.string(), z.unknown()).default({}),
            }),
          )
          .max(60),
        instruction: z.string().trim().min(1).max(2000),
      })
      .safeParse(input);
    if (!p.success) {
      const message = 'Say what should change in the steps.';
      throw new HttpError(400, 'invalid-request', message, { instruction: message });
    }
    const { caseId, steps, instruction } = p.data;
    const testCase = this.d.inventory.get(caseId);
    if (!testCase)
      throw new HttpError(404, 'unknown-case', `The test case ${caseId} no longer exists.`);
    let out: Awaited<ReturnType<typeof generateScenario>>;
    try {
      out = await generateScenario({
        gateway: this.d.ai.gateway(),
        testCase,
        actions: this.d.actions(),
        knowledge: this.d.knowledge,
        ...(this.d.pages && { pages: this.d.pages(testCase.projectId) }),
        validate: (s) => this.d.scenarios.validate({ schemaVersion: 1, caseId, steps: s }),
        revise: { steps, instruction },
      });
    } catch (e) {
      throw toHttp(e);
    }
    this.d.audit('ai.steps.revise', caseId, `Revised steps proposed: ${out.status}.`);
    if (out.status === 'unmappable') {
      const missing =
        out.missingCapabilities.length > 0
          ? ` Missing: ${out.missingCapabilities.join('; ')}.`
          : '';
      throw new HttpError(422, 'cannot-revise', `${out.reason}${missing}`);
    }
    return {
      steps: out.steps,
      note: out.note,
      issues: out.status === 'needs-fixing' ? out.issues : [],
      warnings: out.warnings,
    };
  }

  /**
   * Explain a failed case: is the test out of date, or did the app not do what the case expects? A "test-fix" becomes
   * a new draft for review next to the approved scenario; a likely defect is reported as such and nothing changes.
   */
  async diagnose(input: unknown): Promise<DiagnoseResponse> {
    const p = z
      .object({
        runId: z.string().min(1),
        caseId: z.string().min(1),
        account: z.string().optional(),
      })
      .safeParse(input);
    if (!p.success)
      throw new HttpError(400, 'invalid-request', 'Say which run and test case to diagnose.');
    const { runId, caseId, account } = p.data;
    const run = this.d.runs?.get(runId);
    if (!run) throw new HttpError(404, 'unknown-run', 'There is no such run.');
    const result = run.cases.find(
      (c) => c.caseId === caseId && (account === undefined || c.account === account),
    );
    if (!result) throw new HttpError(404, 'unknown-case', `Run has no result for ${caseId}.`);
    if (result.status !== 'failed') {
      throw new HttpError(
        409,
        'not-failed',
        'Only a failed case can be diagnosed. A blocked case already says why.',
      );
    }
    const testCase = this.d.inventory.get(caseId);
    if (!testCase)
      throw new HttpError(404, 'unknown-case', `The test case ${caseId} no longer exists.`);
    const current = this.d.scenarios.get(caseId);
    const scenario = current.approved?.scenario;
    if (!scenario)
      throw new HttpError(409, 'no-scenario', `${caseId} has no approved scenario to diagnose.`);

    const scenarioSteps = result.steps.filter((s) => s.action !== 'auth.sign-in');
    const failedAt = scenarioSteps.findIndex((s) => s.status === 'failed');
    const failure: {
      kind: string;
      message: string;
      expected?: string | undefined;
      actual?: string | undefined;
    } = result.failure ?? {
      kind: 'unknown',
      message: 'The run did not record why.',
    };
    const pageSnapshot = this.readSnapshot(run.id, result.artifacts);

    let diagnosis: Diagnosis;
    try {
      diagnosis = await diagnoseFailure({
        gateway: this.d.ai.gateway(),
        testCase,
        scenarioSteps: scenario.steps,
        failure: {
          ...(failedAt >= 0 && {
            stepNumber: failedAt + 1,
            action: scenarioSteps[failedAt]!.action,
          }),
          kind: failure.kind,
          message: failure.message,
          ...(failure.expected !== undefined && { expected: failure.expected }),
          ...(failure.actual !== undefined && { actual: failure.actual }),
          ...(pageSnapshot && { pageSnapshot }),
        },
        actions: this.d.actions(),
        knowledge: this.d.knowledge,
        validate: (steps) => this.d.scenarios.validate({ schemaVersion: 1, caseId, steps }),
      });
    } catch (e) {
      throw toHttp(e);
    }
    this.d.audit('ai.diagnose', caseId, `Run ${runId.slice(0, 8)}: ${diagnosis.verdict}.`);
    if (diagnosis.verdict !== 'test-fix') return diagnosis;
    const draft = this.d.scenarios.saveDraft(caseId, {
      steps: diagnosis.steps,
      origin: 'ai',
      note: `Proposed after run ${runId.slice(0, 8)} failed: ${diagnosis.explanation}`,
    });
    return {
      verdict: diagnosis.verdict,
      explanation: diagnosis.explanation,
      draft: { version: draft.version, status: draft.status, issues: draft.issues },
    };
  }

  /** The page text captured when the case failed, read only from inside this run's evidence folder. */
  private readSnapshot(runId: string, artifacts: string[]): string | undefined {
    const rel = artifacts.find((a) => a.endsWith('failure-page.txt'));
    if (!rel || !this.d.artifactsDir) return undefined;
    const base = path.resolve(this.d.artifactsDir, runId);
    const file = path.resolve(base, rel);
    if (!file.startsWith(base + path.sep) || !fs.existsSync(file)) return undefined;
    return fs.readFileSync(file, 'utf8').slice(0, 20_000);
  }

  /**
   * Read pages of the app (no clicks, no typing, every non-read request refused) and add what they show to the
   * knowledge index, so generation and diagnosis use the real labels instead of guesses.
   */
  async explore(input: unknown): Promise<ExploreResult[]> {
    if (!this.d.explore)
      throw new HttpError(404, 'explore-unavailable', 'Exploring the app is not available.');
    const p = z
      .object({
        paths: z.array(PagePath).min(1).max(MAX_EXPLORE).optional(),
        accountId: z.string().min(1).optional(),
      })
      .safeParse(input ?? {});
    if (!p.success) {
      const message = p.error.issues[0]?.message ?? 'Check the page list.';
      throw new HttpError(400, 'invalid-paths', message, { paths: message });
    }
    const paths = [...new Set(p.data.paths ?? DEFAULT_EXPLORE_PATHS)];
    let pages: ExploredPage[];
    try {
      pages = await this.d.explore(paths, p.data.accountId);
    } catch (e) {
      throw new HttpError(
        400,
        'explore-failed',
        e instanceof Error ? e.message : 'Could not open the app.',
      );
    }
    const when = new Date().toISOString().slice(0, 16).replace('T', ' ');
    for (const page of pages) {
      if (!page.ok || !page.snapshot) continue;
      this.d.knowledge.upsert({
        id: `page:${page.path}`,
        kind: 'doc',
        title: `Page ${page.path}${page.title ? ` (${page.title})` : ''}`,
        source: `${page.url ?? page.path} · explored ${when}`,
        text: page.snapshot,
      });
    }
    const ok = pages.filter((x) => x.ok).length;
    this.d.audit(
      'ai.explore',
      'app',
      `Read ${ok} of ${pages.length} page(s); nothing was changed.`,
    );
    return pages.map(({ snapshot, ...rest }) => ({
      ...rest,
      ...(snapshot && { chars: snapshot.length }),
    }));
  }

  /**
   * Save the proposals a person chose (after any edits) as test cases, filed under the suite and version chosen on the
   * Test Design page when given.
   */
  addCases(
    proposals: unknown,
    hints: {
      projectId?: number | undefined;
      testSuiteId?: number | undefined;
      projectVersionId?: number | undefined;
    } = {},
  ): TestCase[] {
    const parsed = z
      .array(ProposedCaseSchema)
      .min(1)
      .max(MAX_PROPOSED_THOROUGH)
      .safeParse(proposals);
    if (!parsed.success) {
      throw new HttpError(
        400,
        'invalid-cases',
        'Some of the test cases are not complete.',
        Object.fromEntries(parsed.error.issues.map((i) => [i.path.join('.'), i.message])),
      );
    }
    const made = toTestCases(parsed.data, { existingIds: new Set(this.d.inventory.keys()) }).map(
      (tc): TestCase => ({
        ...tc,
        ...(hints.projectId && { projectId: hints.projectId }),
        ...(hints.testSuiteId && { testSuiteId: hints.testSuiteId }),
        ...(hints.projectVersionId && { projectVersionId: hints.projectVersionId }),
      }),
    );
    for (const tc of made) this.d.inventory.set(tc.id, tc);
    this.d.audit(
      'ai.cases.add',
      'test cases',
      `Added ${made.length}: ${made.map((c) => c.id).join(', ')}.`,
    );
    return made;
  }

  /**
   * Realistic values for a case's missing parameters. The model sees the case's title, written steps and the names
   * only; it never sees test-account credentials (the AI service redacts them), and a person reviews the values.
   */
  async suggestParameters(input: {
    title: string;
    steps: string[];
    names: string[];
  }): Promise<Record<string, string>> {
    const names = input.names.slice(0, 50);
    const schema = z.record(z.string(), z.string().max(500));
    try {
      const { value } = await completeJson(
        this.d.ai.gateway({ maxCalls: 2 }),
        {
          system:
            'You fill test data for automated UI tests. Reply with one JSON object mapping each requested name to a ' +
            'short, realistic, non-secret test value. Never produce passwords, tokens or real personal data. Use ' +
            'example.com for emails and ISO dates.',
          messages: [
            {
              role: 'user',
              content: JSON.stringify({
                testCase: input.title,
                steps: input.steps.slice(0, 30),
                names,
              }),
            },
          ],
          maxTokens: 800,
          temperature: 0.2,
          timeoutMs: 30_000,
        },
        schema,
      );
      this.d.audit('ai.parameters', 'test case', `Suggested ${Object.keys(value).length} values.`);
      return Object.fromEntries(Object.entries(value).filter(([k]) => names.includes(k)));
    } catch (e) {
      throw toHttp(e);
    }
  }
}
