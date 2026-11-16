import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import multipart from '@fastify/multipart';
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import { z } from 'zod';
import type { ActionRegistry } from '@qa-studio/automation-core';
import type { CaseJob, RunManager } from '@qa-studio/execution-engine';
import { buildReport, renderExcel, renderHtml } from '@qa-studio/reporting';
import {
  RunMode,
  SCHEMA_VERSION,
  summarizeRun,
  type Scenario,
  type TestCase,
} from '@qa-studio/shared';
import {
  buildErrorWorkbook,
  buildInventoryWorkbook,
  buildScope,
  buildTemplate,
  DEFAULT_LIMITS,
  defaultSelection,
  FIELDS,
  ImportError,
  parseWorkbook,
  selectCases,
} from '@qa-studio/test-case-import';
import type { AccountView } from './accounts.js';
import type { Hit } from '@qa-studio/knowledge';
import type { AiView } from './ai-service.js';
import type { VoiceSession, VoiceView } from './voice-service.js';
import { DEFAULT_EXPLORE_PATHS, MAX_EXPLORE, type AiTasks } from './ai-tasks.js';
import type { ScenarioService } from './scenario-service.js';
import type { SkillView } from './skills.js';
import { HttpError } from './errors.js';
import { EventBus, registerEvents } from './events.js';
import { registerSecurity, type SecurityOptions } from './security.js';
import type { ProjectConnectionView } from './project-connections.js';
import type { SettingsView } from './settings.js';
import type { ParameterApi } from './parameter-client.js';
import type { CustomStepView } from './custom-steps.js';
import type { AzureDevOpsService, PipelineHost } from './azure-devops.js';
import { nextCaseId } from './case-ids.js';
import type { BackupSummary } from './backups.js';
import type { ConversionJob } from './conversions.js';
import type { AuditRow } from './sqlite-storage.js';
import { MemoryStore, type ImportSession } from './store.js';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const summarize = (s: ImportSession) => ({
  id: s.id,
  fileName: s.result.fileName,
  defaultSelection: defaultSelection(s.result),
  sheets: s.result.sheets.map((sh) => ({
    name: sh.name,
    status: sh.status,
    message: sh.message,
    headerRow: sh.headerRow,
    columnCount: sh.columnCount,
    sample: sh.sample,
    mapping: sh.mapping,
    autoHeaderRow: sh.autoHeaderRow,
    autoMapping: sh.autoMapping,
    detectedCount: sh.detectedCount,
    rejectedCount: sh.rejected.length,
    warningCount: sh.warnings.length,
  })),
});

const Selection = z.object({
  sheet: z.union([z.string(), z.array(z.string())]).optional(),
  all: z.enum(['true', 'false']).optional(),
});
const Filters = z.object({
  q: z.string().max(200).optional(),
  module: z.string().max(200).optional(),
  priority: z.string().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});
const IdList = z.object({ id: z.union([z.string(), z.array(z.string())]).optional() });

const toList = (v: string | string[] | undefined): string[] =>
  v === undefined ? [] : Array.isArray(v) ? v : [v];

function resolveSelection(query: unknown): string[] | 'all' | undefined {
  const s = Selection.parse(query);
  if (s.all === 'true') return 'all';
  const sheets = toList(s.sheet);
  return sheets.length > 0 ? sheets : undefined;
}

function filterCases(cases: TestCase[], f: z.infer<typeof Filters>): TestCase[] {
  const q = f.q?.toLowerCase();
  return cases.filter(
    (c) =>
      (!q || [c.id, c.title, c.module ?? ''].some((v) => v.toLowerCase().includes(q))) &&
      (!f.module || c.module === f.module) &&
      (!f.priority || c.priority === f.priority),
  );
}

function page(cases: TestCase[], f: z.infer<typeof Filters>) {
  const start = (f.page - 1) * f.pageSize;
  return {
    total: cases.length,
    page: f.page,
    pageSize: f.pageSize,
    items: cases.slice(start, start + f.pageSize),
  };
}

const facets = (cases: TestCase[]) => ({
  modules: [...new Set(cases.map((c) => c.module).filter((m): m is string => !!m))].sort(),
  priorities: [...new Set(cases.map((c) => c.priority).filter((m): m is string => !!m))].sort(),
});

function sendXlsx(reply: FastifyReply, name: string, body: Buffer) {
  return reply
    .header('Content-Type', XLSX)
    .header('Content-Disposition', `attachment; filename="${name}"`)
    .send(body);
}

/** What the API needs from the settings. Implemented by SettingsService; tests may supply a small fake. */
export interface SettingsProvider {
  view(): SettingsView;
  /** Validate and save. Throws an HttpError naming each wrong field. */
  update(patch: unknown): SettingsView;
  availability(): { available: boolean; reason?: string };
  runDefaults(): { environment: string; browser: string; workers: number; loginRequired: boolean };
}

/** Where one project's cases run, and whether they can. */
export interface RunTarget {
  projectId?: number;
  projectName?: string;
  environment: string;
  appUrl?: string;
  loginRequired: boolean;
  available: boolean;
  reason?: string;
}

/** What the API needs from the project connections. Implemented by ProjectConnectionService. */
export interface ConnectionsProvider {
  list(): { items: ProjectConnectionView[]; allowedEnvs: string[] };
  /** Validate without saving. Throws an HttpError naming each wrong field. */
  check(input: unknown): void;
  save(projectId: number, input: unknown): ProjectConnectionView;
  target(projectId: number | undefined, projectName?: string): RunTarget;
  availability(): { available: boolean; reason?: string };
  /** For the top bar: the environments set up, and whether any project signs in. */
  summary(): { environment: string; loginRequired: boolean };
}

/** What the API needs from the test accounts. Implemented by AccountService. */
export interface AccountsProvider {
  list(): AccountView[];
  create(input: unknown): AccountView;
  update(id: string, input: unknown): AccountView;
  remove(id: string): void;
  refs(ids: string[]): { id: string; label: string; projectId?: number }[];
  test(id: string): Promise<{ ok: boolean; message: string }>;
  /** Sign in by hand in a visible window and keep the session (for SSO with a second factor). */
  captureSession?(id: string): Promise<AccountView>;
  clearSession?(id: string): AccountView;
}

/** What the API needs from the AI configuration. Implemented by AiService; keys are write-only. */
export interface AiProvider {
  view(): AiView;
  update(patch: unknown): AiView;
  setKey(provider: string, key: unknown): AiView;
  removeKey(provider: string): AiView;
  test(
    provider?: string,
  ): Promise<{ ok: boolean; message: string; provider: string; model: string; ms: number }>;
}

/** What the API needs from voice control. Implemented by VoiceService; LiveKit keys never leave the server. */
export interface VoiceProvider {
  view(): VoiceView;
  update(patch: unknown): VoiceView;
  startSession(): Promise<VoiceSession>;
}

/** What the API needs from the knowledge index. */
export interface KnowledgeProvider {
  stats(): Record<string, number>;
  reindex(): Record<string, number>;
  search(query: string): Hit[];
}

/** Run-time automation wiring. Everything is optional so the app can start (and show history) while unconfigured. */
export interface Automation {
  runs?: RunManager;
  registry?: ActionRegistry;
  scenarios?: Map<string, Scenario>;
  scenarioErrors?: { file: string; message: string }[];
  artifactsDir?: string;
  frameworkVersion?: string;
  settings?: SettingsProvider;
  accounts?: AccountsProvider;
  /** Per-project addresses and sign-in. Without it, every case uses the single set of settings. */
  connections?: ConnectionsProvider;
  ai?: AiProvider;
  /** Voice control (Settings › Voice) and LiveKit sessions. */
  voice?: VoiceProvider;
  knowledge?: KnowledgeProvider;
  scenarioService?: ScenarioService;
  /**
   * Parameter values (`{{data.name}}` in steps) are saved and read by the .NET API. This is how the worker reaches them: for
   * a run's values, for backups, for clearing all data, and for the Azure DevOps pipeline's auto-fill.
   */
  parameters?: ParameterApi;
  /** Steps a project defines for itself (Project settings › Custom steps). Implemented by CustomStepService. */
  customSteps?: {
    list(projectId: number): CustomStepView[];
    save(projectId: number, body: unknown): CustomStepView[];
  };
  /** Azure DevOps Test Plans: import, automated pipeline, result publishing. */
  azureDevOps?: AzureDevOpsService;
  /** Turns imported test cases into steps in the background. Implemented by ConversionService. */
  conversions?: {
    start(body: unknown): ConversionJob;
    list(): ConversionJob[];
    get(id: string): ConversionJob;
    cancel(id: string): ConversionJob;
  };
  /** Snapshots taken before clearing, so a clear can be undone. Implemented by BackupService. */
  backups?: {
    take(reason: string): Promise<string>;
    list(): BackupSummary[];
    restore(id: string): Promise<BackupSummary>;
  };
  aiTasks?: AiTasks;
  /** Saved AI skills (AI Assistant › Skills). Implemented by SkillService. */
  skills?: {
    list(): SkillView[];
    save(name: string, body: unknown): SkillView;
    remove(name: string): void;
  };
  audit?: {
    list(limit: number): AuditRow[];
    /** Record a change. Never pass secrets. */
    add?(action: string, target: string, detail: string): void;
  };
  /** Live updates for open dashboards. Run changes are published by the server; API changes by the app itself. */
  events?: EventBus;
}

/**
 * Features this worker build offers. The web app compares them with what it needs and, when one is missing, tells the
 * person the worker is out of date (started before an update) instead of failing one request at a time. Add a name
 * whenever a release adds routes the web app depends on; never remove one while the web app still uses it.
 */
export const WORKER_CAPABILITIES = [
  // Parameter values come from the API when a run starts, and the API can ask the worker for AI suggestions.
  'api-parameters',
  'azure-devops',
  'ai-case-steps',
  'custom-steps',
  // Saved AI skills, called with /skill-name when generating test cases.
  'ai-skills',
  // Settings › Voice, voice sessions and clarifying questions for generated cases.
  'voice',
] as const;

/** Error code of a request for a route this worker does not have (usually a worker older than the web app). */
export const ROUTE_NOT_FOUND = 'route-not-found';

/** The most test-case runs one request may start (cases x accounts). */
const MAX_JOBS = 500;

export function createApp(
  store = new MemoryStore(),
  automation: Automation = {},
  auth: SecurityOptions = {},
): FastifyInstance {
  const app = Fastify({ logger: false });
  registerSecurity(app, auth); // first, so the checks cover every route below
  void app.register(multipart, { limits: { fileSize: DEFAULT_LIMITS.maxBytes, files: 1 } });

  app.setErrorHandler(
    (
      err: { code?: string; message: string; issues?: unknown; statusCode?: number },
      _req,
      reply,
    ) => {
      if (err instanceof HttpError) {
        return reply.code(err.status).send({
          error: {
            code: err.code,
            message: err.message,
            ...(err.fields && { fields: err.fields }),
          },
        });
      }
      if (err instanceof ImportError) {
        return reply
          .code(err.code === 'too-large' ? 413 : err.code === 'unknown-worksheet' ? 404 : 400)
          .send({
            error: { code: err.code, message: err.message },
          });
      }
      if (err instanceof z.ZodError) {
        return reply.code(400).send({
          error: {
            code: 'invalid-request',
            message: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
          },
        });
      }
      if (err.code === 'FST_REQ_FILE_TOO_LARGE') {
        return reply
          .code(413)
          .send({ error: { code: 'too-large', message: 'File exceeds the upload size limit.' } });
      }
      // A request the framework itself rejected (malformed JSON, wrong content type, body too large) is the
      // caller's mistake, not a server fault. Say so without echoing the framework's wording or any input.
      if (typeof err.statusCode === 'number' && err.statusCode >= 400 && err.statusCode < 500) {
        return reply.code(err.statusCode).send({
          error: {
            code: 'bad-request',
            message: 'The request could not be read. Check it is valid JSON of the expected shape.',
          },
        });
      }
      // Do not leak internals to the client.
      return reply
        .code(500)
        .send({ error: { code: 'internal', message: 'Unexpected server error.' } });
    },
  );

  const session = (id: string): ImportSession => {
    const s = store.sessions.get(id);
    if (!s)
      throw new ImportError(
        'unknown-worksheet',
        'Import session not found. Upload the workbook again.',
      );
    return s;
  };

  registerEvents(app, automation.events ?? new EventBus());

  app.get('/api/health', () => ({ status: 'ok' }));

  app.get('/api/template.xlsx', async (_req, reply) =>
    sendXlsx(reply, 'qa-test-case-template.xlsx', await buildTemplate()),
  );

  app.post('/api/imports', async (req, reply) => {
    const file = await req.file();
    if (!file) throw new ImportError('empty-file', 'No file was uploaded.');
    const bytes = new Uint8Array(await file.toBuffer());
    const result = await parseWorkbook({ name: file.filename, bytes });
    const s: ImportSession = {
      id: randomUUID(),
      fileName: result.fileName,
      bytes,
      overrides: {},
      result,
      createdAt: new Date().toISOString(),
    };
    store.addSession(s);
    return reply.code(201).send(summarize(s));
  });

  app.get<{ Params: { id: string } }>('/api/imports/:id', (req) =>
    summarize(session(req.params.id)),
  );

  const Mapping = z.object({
    sheet: z.string().min(1),
    headerRow: z.number().int().min(1).max(1000),
    mapping: z.partialRecord(z.enum(FIELDS), z.number().int().min(1).max(DEFAULT_LIMITS.maxCols)),
  });
  app.put<{ Params: { id: string } }>('/api/imports/:id/mapping', async (req) => {
    const s = session(req.params.id);
    const body = Mapping.parse(req.body);
    if (!s.result.sheets.some((sh) => sh.name === body.sheet)) {
      throw new ImportError('unknown-worksheet', `Worksheet "${body.sheet}" does not exist.`);
    }
    const overrides = {
      ...s.overrides,
      [body.sheet]: { headerRow: body.headerRow, mapping: body.mapping },
    };
    s.result = await parseWorkbook({ name: s.fileName, bytes: s.bytes }, { overrides });
    s.overrides = overrides;
    return summarize(s);
  });

  app.get<{ Params: { id: string } }>('/api/imports/:id/cases', (req) => {
    const s = session(req.params.id);
    const scope = buildScope(s.result, resolveSelection(req.query));
    const f = Filters.parse(req.query);
    return {
      scope: { mode: scope.mode, worksheets: scope.worksheets },
      rejectedCount: scope.rejected.length,
      warnings: scope.warnings,
      ...facets(scope.cases),
      ...page(filterCases(scope.cases, f), f),
    };
  });

  app.get<{ Params: { id: string } }>('/api/imports/:id/errors.xlsx', async (req, reply) => {
    const scope = buildScope(session(req.params.id).result, resolveSelection(req.query));
    return sendXlsx(reply, 'rejected-rows.xlsx', await buildErrorWorkbook(scope.rejected));
  });

  const Commit = z.object({
    sheets: z.union([z.literal('all'), z.array(z.string())]).optional(),
    ids: z.array(z.string()).optional(),
    /** Delete the existing test cases first, so the inventory holds only what this import brings. */
    replace: z.boolean().optional(),
    /**
     * Where new cases are filed. With a project and no suite, each module becomes a suite of that project; with neither,
     * of the General project.
     */
    projectId: z.number().int().positive().optional(),
    testSuiteId: z.number().int().positive().optional(),
    projectVersionId: z.number().int().positive().optional(),
  });
  app.post<{ Params: { id: string } }>('/api/imports/:id/commit', (req) => {
    const s = session(req.params.id);
    const body = Commit.parse(req.body ?? {});
    let scope = buildScope(s.result, body.sheets);
    let missing: string[] = [];
    if (body.ids) ({ scope, missing } = selectCases(scope, body.ids));
    // Replace only after the selection resolved without error, so a bad request never empties the inventory.
    const removed = body.replace ? store.inventory.size : 0;
    if (body.replace) store.inventory.clear();
    let added = 0;
    let updated = 0;
    for (const c of scope.cases) {
      if (store.inventory.has(c.id)) updated++;
      else added++;
      store.inventory.set(c.id, {
        ...c,
        ...(body.projectId && { projectId: body.projectId }),
        ...(body.testSuiteId && { testSuiteId: body.testSuiteId }),
        ...(body.projectVersionId && { projectVersionId: body.projectVersionId }),
      });
    }
    if (body.replace) {
      automation.audit?.add?.(
        'inventory.replace',
        'test cases',
        `Replaced ${removed} existing test case${removed === 1 ? '' : 's'} with ${added} from the import.`,
      );
    }
    return {
      mode: scope.mode,
      worksheets: scope.worksheets,
      added,
      updated,
      removed,
      /** How many test cases exist after this import. */
      total: store.inventory.size,
      rejected: scope.rejected.length,
      missing,
      /** The imported test case IDs, so the client can start converting them into steps. */
      caseIds: scope.cases.map((c) => c.id),
    };
  });

  // Create one test case by hand. The ID is optional: when it is left out the server takes the next free one, at
  // the moment of creating, so two people creating cases at once never get the same ID.
  const NewCase = z.object({
    id: z
      .string()
      .trim()
      .max(100)
      .regex(/^[\w.-]*$/, 'Use letters, digits, ., - or _.')
      .optional()
      .transform((v) => v || undefined),
    title: z.string().trim().min(1).max(500),
    module: z.string().trim().max(200).optional(),
    priority: z.string().trim().max(50).optional(),
    preconditions: z.string().trim().max(4000).optional(),
    steps: z.array(z.string().trim().min(1).max(2000)).max(200).default([]),
    expectedResult: z.string().trim().max(4000).optional(),
  });
  // The ID a new case would get now, to show in the "New test case" form.
  app.get('/api/inventory/next-id', () => ({ id: nextCaseId(store.inventory.keys()) }));
  app.post('/api/inventory', (req, reply) => {
    const p = NewCase.safeParse(req.body ?? {});
    if (!p.success) {
      throw new HttpError(
        400,
        'invalid-case',
        'Some fields need attention.',
        Object.fromEntries(p.error.issues.map((i) => [i.path.join('.'), i.message])),
      );
    }
    const b = p.data;
    const id = b.id ?? nextCaseId(store.inventory.keys());
    if (store.inventory.has(id)) {
      throw new HttpError(409, 'duplicate-id', `There is already a test case "${id}".`, {
        id: 'This ID is already used.',
      });
    }
    const tc: TestCase = {
      schemaVersion: SCHEMA_VERSION,
      id,
      title: b.title,
      ...(b.module && { module: b.module }),
      ...(b.priority && { priority: b.priority }),
      ...(b.preconditions && { preconditions: b.preconditions }),
      steps: b.steps.map((action, i) => ({ order: i + 1, action })),
      ...(b.expectedResult && { expectedResult: b.expectedResult }),
      tags: [],
      dependsOn: [],
      readiness: 'needs-clarification',
      source: { workbook: 'Created in the app', worksheet: '-', rowNumber: 1 },
    };
    store.inventory.set(tc.id, tc);
    automation.audit?.add?.('inventory.create', tc.id, 'Test case created in the app.');
    return reply.code(201).send(tc);
  });

  const inventory = (query: unknown) => {
    const f = Filters.parse(query);
    const all = [...store.inventory.values()];
    return { all, f, filtered: filterCases(all, f) };
  };

  app.get('/api/inventory', (req) => {
    const { all, f, filtered } = inventory(req.query);
    return { ...facets(all), ...page(filtered, f) };
  });

  app.get('/api/inventory/export.xlsx', async (req, reply) => {
    const { filtered } = inventory(req.query);
    const ids = new Set(toList(IdList.parse(req.query).id));
    const cases = ids.size > 0 ? filtered.filter((c) => ids.has(c.id)) : filtered;
    return sendXlsx(reply, 'test-inventory.xlsx', await buildInventoryWorkbook(cases));
  });

  // Remove chosen test cases. A POST with a list, because a DELETE body is not reliably carried by proxies.
  const DeleteCases = z.object({ ids: z.array(z.string().min(1)).min(1).max(5000) });
  app.post('/api/inventory/delete', (req) => {
    const { ids } = DeleteCases.parse(req.body);
    const unique = [...new Set(ids)];
    const deleted = unique.filter((id) => store.inventory.delete(id));
    if (deleted.length > 0) {
      automation.audit?.add?.(
        'inventory.delete',
        'test cases',
        `Removed ${deleted.length} test case${deleted.length === 1 ? '' : 's'}.`,
      );
    }
    return { deleted: deleted.length, notFound: unique.length - deleted.length };
  });

  // Start fresh: remove every test case together with its scenario and its
  // parameters, and optionally the run history. A snapshot is taken first so the clear can be undone. Settings and test
  // accounts are never touched, and evidence files on disk are left alone.
  app.delete('/api/inventory', async (req) => {
    const q = req.query as { runs?: string; scenarios?: string; parameters?: string };
    const withRuns = q.runs === 'true';
    // Scenarios and parameters belong to the test cases, so they go too unless the caller says to keep them.
    const withScenarios = q.scenarios !== 'false';
    const withParameters = q.parameters !== 'false';
    if (withRuns && automation.runs?.hasActiveRun()) {
      throw new HttpError(
        409,
        'run-in-progress',
        'A run is in progress. Cancel it or wait for it to finish before deleting run history.',
      );
    }
    const backupId = await automation.backups?.take('Before clearing all data');
    const deletedCases = store.inventory.size;
    store.inventory.clear();
    store.sessions.clear(); // uploaded workbooks held in memory for the import screen
    const deletedRuns = withRuns ? (automation.runs?.clearHistory() ?? 0) : 0;
    const cleared =
      withScenarios && automation.scenarioService
        ? automation.scenarioService.clearAll()
        : { scenarios: 0, files: 0 };
    const clearedValues = withParameters ? ((await automation.parameters?.clear()) ?? 0) : 0;
    automation.audit?.add?.(
      'inventory.clear',
      'test cases',
      `Removed ${deletedCases} test case${deletedCases === 1 ? '' : 's'}${withRuns ? ` and ${deletedRuns} run${deletedRuns === 1 ? '' : 's'}` : ''}.`,
    );
    return {
      deletedCases,
      deletedRuns,
      deletedScenarios: cleared.scenarios,
      deletedFiles: cleared.files,
      clearedValues,
      ...(backupId && { backupId }),
    };
  });

  // ---- Conversion of imported cases, and approving many drafts at once (the page list is edited through the .NET API) ----

  const conversionsOr404 = () => {
    if (!automation.conversions) {
      throw new HttpError(404, 'conversions-unavailable', 'Conversion is not available.');
    }
    return automation.conversions;
  };
  app.post('/api/conversions', (req, reply) =>
    reply.code(202).send(conversionsOr404().start(req.body)),
  );
  app.get('/api/conversions', () => ({ items: conversionsOr404().list() }));
  app.get<{ Params: { id: string } }>('/api/conversions/:id', (req) =>
    conversionsOr404().get(req.params.id),
  );
  app.post<{ Params: { id: string } }>('/api/conversions/:id/cancel', (req) =>
    conversionsOr404().cancel(req.params.id),
  );

  // Approve every checked draft among the given cases in one go (for "Approve all ready" after an import).
  app.post('/api/scenarios/approve', (req) => {
    const ids = z
      .object({ caseIds: z.array(z.string().min(1)).min(1).max(2000) })
      .parse(req.body ?? {}).caseIds;
    const svc = scenariosOr404();
    let approved = 0;
    const skipped: string[] = [];
    for (const id of ids) {
      if (svc.get(id).draft?.status === 'validated') {
        svc.approve(id);
        approved++;
      } else skipped.push(id);
    }
    return { approved, skipped };
  });

  const backupsOr404 = () => {
    if (!automation.backups)
      throw new HttpError(404, 'backups-unavailable', 'Backups are not available.');
    return automation.backups;
  };
  app.get('/api/backups', () => ({ items: backupsOr404().list() }));
  // Undo a clear: put the snapshot's test cases, scenarios and parameters back.
  app.post<{ Params: { id: string } }>('/api/backups/:id/restore', async (req) =>
    backupsOr404().restore(req.params.id),
  );

  // ---- Automation: actions, runs, evidence ----
  // Whether runs can start is decided per request from the current settings, so a change in the app applies at once.
  // The run manager may exist even when runs are unavailable, so persisted history stays readable.
  const availability = (): { available: boolean; reason?: string } =>
    automation.runs && automation.settings
      ? (automation.connections ?? automation.settings).availability()
      : { available: false, reason: 'No environment is configured. Open Settings to set one up.' };

  /** Where a case runs: its project's connection, or the single set of settings when there are none. */
  const targetOf = (tc: TestCase): RunTarget => {
    if (automation.connections) return automation.connections.target(tc.projectId, tc.projectName);
    const d = automation.settings?.runDefaults();
    return {
      environment: d?.environment ?? '',
      loginRequired: d?.loginRequired ?? false,
      available: true,
    };
  };

  const assertKnownCases = (ids: string[]) => {
    const unknown = ids.filter((id) => !store.inventory.has(id));
    if (unknown.length > 0) {
      throw new HttpError(
        404,
        'unknown-test-case',
        `Not in the inventory: ${unknown.slice(0, 10).join(', ')}.`,
      );
    }
  };

  app.get('/api/automation', () => {
    const a = availability();
    const d = automation.connections?.summary() ?? automation.settings?.runDefaults();
    return {
      runsAvailable: a.available,
      reason: a.reason,
      environment: d?.environment || undefined,
      loginRequired: d?.loginRequired ?? false,
      workers: automation.settings?.runDefaults().workers,
      accountCount: automation.accounts?.list().length ?? 0,
      scenarioCount: automation.scenarios?.size ?? 0,
      scenarioErrors: automation.scenarioErrors ?? [],
      actions: automation.registry?.list() ?? [],
      capabilities: WORKER_CAPABILITIES,
    };
  });

  const StartRun = z.object({
    caseIds: z.array(z.string().min(1)).min(1).max(MAX_JOBS),
    workers: z.number().int().min(1).max(16).optional(),
    /** Test accounts to sign in as. Every chosen case runs once as each account. */
    accountIds: z.array(z.string().min(1)).max(20).optional(),
    /** How the cases share browsers and sign-ins; `clean` when left out. */
    mode: RunMode.optional(),
    /**
     * Concurrent runs only: how many browsers each chosen account signs in to at the same time ("same user in several
     * browsers"). Every case then runs that many times at once as each account. 1 (or left out) is one browser per user.
     */
    browsersPerUser: z.number().int().min(1).max(8).optional(),
  });

  // What a chosen set of cases needs before it can start, grouped by project, so the start dialog can ask for
  // the right accounts and say which project still needs setting up.
  const RunPlan = z.object({ caseIds: z.array(z.string().min(1)).min(1).max(MAX_JOBS) });
  app.post('/api/runs/plan', (req) => {
    const ids = [...new Set(RunPlan.parse(req.body).caseIds)];
    assertKnownCases(ids);
    const groups = new Map<string, RunTarget & { caseCount: number; accounts: AccountView[] }>();
    for (const id of ids) {
      const target = targetOf(store.inventory.get(id)!);
      const key = String(target.projectId);
      const group = groups.get(key) ?? {
        ...target,
        caseCount: 0,
        accounts: target.loginRequired
          ? (automation.accounts?.list() ?? []).filter(
              (a) => !automation.connections || a.projectId === target.projectId,
            )
          : [],
      };
      group.caseCount++;
      groups.set(key, group);
    }
    return { groups: [...groups.values()], workers: automation.settings?.runDefaults().workers };
  });

  app.post('/api/runs', async (req, reply) => {
    const body = StartRun.parse(req.body);
    const a = availability();
    if (!a.available || !automation.runs || !automation.settings) {
      return reply.code(409).send({
        error: {
          code: 'environment-not-configured',
          message: a.reason ?? 'No environment is configured.',
        },
      });
    }
    const ids = [...new Set(body.caseIds)];
    assertKnownCases(ids);
    const copies = body.browsersPerUser ?? 1;
    if (copies > 1 && body.mode !== 'concurrent') {
      throw new HttpError(
        400,
        'browsers-per-user-needs-concurrent',
        'Several browsers per user can only be used with "Concurrent users".',
      );
    }

    const defaults = automation.settings.runDefaults();
    const targets = new Map(ids.map((id) => [id, targetOf(store.inventory.get(id)!)]));
    const notReady = [...targets.values()].find((t) => !t.available);
    if (notReady) {
      throw new HttpError(
        409,
        'project-not-ready',
        notReady.reason ?? 'A chosen test case belongs to a project that is not set up.',
      );
    }
    const signsIn = [...targets.values()].some((t) => t.loginRequired);
    const accountIds = [...new Set(body.accountIds ?? [])];
    if (signsIn && accountIds.length === 0) {
      throw new HttpError(
        400,
        'account-required',
        automation.connections
          ? 'Choose at least one test account to sign in as. Add accounts on the project.'
          : 'Choose at least one test account to sign in as. Add accounts in Settings.',
      );
    }
    const chosen = signsIn ? (automation.accounts?.refs(accountIds) ?? []) : [];
    if (signsIn && chosen.length === 0) {
      throw new HttpError(
        400,
        'account-required',
        'Choose at least one test account to sign in as.',
      );
    }

    // A case runs only as accounts of its own project: an account's password means nothing to another application.
    const accountsFor = (t: RunTarget) => {
      if (!t.loginRequired) return [];
      const own = automation.connections
        ? chosen.filter((a) => a.projectId === t.projectId)
        : chosen;
      if (own.length === 0) {
        throw new HttpError(
          400,
          'account-required',
          `Choose a test account for ${t.projectName ?? 'each project'}.`,
        );
      }
      return own;
    };

    // The values each case reads come from the API, asked now, so a run never uses a copy that could be out of date. If they
    // cannot be had the run is refused: running with missing or old values would give a wrong result.
    const values = automation.parameters ? await automation.parameters.effective(ids) : undefined;

    // One job per case per account (times the browsers per user, in a concurrent same-user run); with no sign-in
    // required there is one job per case, since without an account there is no "same user" to repeat.
    const jobs: CaseJob[] = ids.flatMap((id) => {
      const tc = store.inventory.get(id)!;
      const target = targets.get(id)!;
      const accounts = accountsFor(target);
      const base = {
        caseId: id,
        ...(target.projectId !== undefined && { projectId: target.projectId }),
        title: tc.title,
        module: tc.module,
        priority: tc.priority,
        source: tc.source,
        scenario: automation.scenarios?.get(id),
        ...(values && { data: values[id] ?? {} }),
      };
      if (accounts.length === 0) return [base];
      return accounts.flatMap((account) =>
        copies === 1
          ? [{ ...base, account }]
          : // Each browser is labelled, so results and evidence of the copies stay apart.
            Array.from({ length: copies }, (_, i) => ({
              ...base,
              account: { ...account, label: `${account.label} (browser ${i + 1})` },
              session: i + 1,
            })),
      );
    });
    if (jobs.length > MAX_JOBS) {
      throw new HttpError(
        400,
        'too-many-runs',
        `That would start ${jobs.length} test runs (${ids.length} cases x ${chosen.length} accounts${copies > 1 ? ` x ${copies} browsers each` : ''}). The limit is ${MAX_JOBS}. Choose fewer cases or accounts.`,
      );
    }
    const environments = [...new Set([...targets.values()].map((t) => t.environment))];
    const run = automation.runs.start(jobs, {
      environment: environments.filter(Boolean).join(', ') || 'unknown',
      browser: defaults.browser,
      workers: body.workers ?? defaults.workers,
      mode: body.mode,
    });
    return reply.code(202).send({ ...run, summary: summarizeRun(run) });
  });

  // The run history (the list and one run) is read from the database by the .NET API. What is left here needs the worker:
  // starting and cancelling runs, and the reports and evidence of a run.
  const runOr404 = (id: string) => {
    const run = automation.runs?.get(id);
    if (!run) throw new ImportError('unknown-worksheet', 'Run not found.');
    return run;
  };
  app.post<{ Params: { id: string } }>('/api/runs/:id/cancel', (req) => {
    runOr404(req.params.id);
    return { cancelled: automation.runs!.cancel(req.params.id) };
  });

  // Only files that the run itself reported as artifacts can be fetched; the client never supplies a path to the disk.
  app.get<{ Params: { id: string }; Querystring: { path?: string } }>(
    '/api/runs/:id/artifact',
    (req, reply) => {
      const run = runOr404(req.params.id);
      const rel = req.query.path ?? '';
      if (!run.cases.some((c) => c.artifacts.includes(rel)) || !automation.artifactsDir) {
        return reply
          .code(404)
          .send({ error: { code: 'not-found', message: 'Artifact not found.' } });
      }
      const base = path.resolve(automation.artifactsDir, run.id);
      const file = path.resolve(base, rel);
      if (!file.startsWith(base + path.sep) || !fs.existsSync(file)) {
        return reply
          .code(404)
          .send({ error: { code: 'not-found', message: 'Artifact not found.' } });
      }
      const type = file.endsWith('.png')
        ? 'image/png'
        : file.endsWith('.zip')
          ? 'application/zip'
          : file.endsWith('.txt')
            ? 'text/plain; charset=utf-8'
            : 'application/octet-stream';
      return reply
        .header('Content-Type', type)
        .header('X-Content-Type-Options', 'nosniff')
        .send(fs.createReadStream(file));
    },
  );

  // Reports: one machine-readable, one for people, one for spreadsheets. All built from the same RunReport.
  app.get<{ Params: { id: string; format: string } }>(
    '/api/runs/:id/report.:format',
    async (req, reply) => {
      const run = runOr404(req.params.id);
      const report = buildReport({
        run,
        frameworkVersion: automation.frameworkVersion ?? 'unknown',
        actionSources: Object.fromEntries(
          (automation.registry?.list() ?? []).map((a) => [a.name, a.source]),
        ),
        configIssues: (automation.scenarioErrors ?? []).map(
          (e) => `Scenario file ${e.file} was not loaded: ${e.message}`,
        ),
      });
      const name = `qa-run-${run.id.slice(0, 8)}-report`;
      const send = (type: string, ext: string, body: string | Buffer) =>
        reply
          .header('Content-Type', type)
          .header('Content-Disposition', `attachment; filename="${name}.${ext}"`)
          .header('X-Content-Type-Options', 'nosniff')
          .header(
            'Content-Security-Policy',
            "default-src 'none'; style-src 'unsafe-inline'; sandbox",
          )
          .send(body);
      switch (req.params.format) {
        case 'json':
          return send('application/json', 'json', JSON.stringify(report, null, 2));
        case 'html':
          return send('text/html; charset=utf-8', 'html', renderHtml(report));
        case 'xlsx':
          return send(XLSX, 'xlsx', await renderExcel(report));
        default:
          return reply.code(404).send({
            error: {
              code: 'not-found',
              message: 'Unknown report format. Use json, html or xlsx.',
            },
          });
      }
    },
  );

  // ---- Settings, test accounts and the audit trail of changes ----
  const settingsOr404 = (): SettingsProvider => {
    if (!automation.settings) throw new HttpError(404, 'not-found', 'Settings are not available.');
    return automation.settings;
  };
  const accountsOr404 = (): AccountsProvider => {
    if (!automation.accounts) throw new HttpError(404, 'not-found', 'Accounts are not available.');
    return automation.accounts;
  };

  app.get('/api/settings', () => settingsOr404().view());
  app.put('/api/settings', (req) => settingsOr404().update(req.body));

  const aiOr404 = () => {
    if (!automation.ai)
      throw new HttpError(404, 'ai-unavailable', 'AI settings are not available.');
    return automation.ai;
  };
  app.get('/api/ai', () => aiOr404().view());
  app.put('/api/ai', (req) => aiOr404().update(req.body));
  app.put<{ Params: { provider: string } }>('/api/ai/keys/:provider', (req) =>
    aiOr404().setKey(req.params.provider, (req.body as { key?: unknown } | null)?.key),
  );
  app.delete<{ Params: { provider: string } }>('/api/ai/keys/:provider', (req) =>
    aiOr404().removeKey(req.params.provider),
  );
  app.post('/api/ai/test', (req) =>
    aiOr404().test((req.body as { provider?: string } | null)?.provider),
  );

  const voiceOr404 = () => {
    if (!automation.voice)
      throw new HttpError(404, 'voice-unavailable', 'Voice control is not available.');
    return automation.voice;
  };
  app.get('/api/voice', () => voiceOr404().view());
  app.put('/api/voice', (req) => voiceOr404().update(req.body));
  app.post('/api/voice/session', () => voiceOr404().startSession());

  const tasksOr404 = () => {
    if (!automation.aiTasks)
      throw new HttpError(404, 'ai-unavailable', 'AI generation is not available.');
    return automation.aiTasks;
  };
  app.post('/api/ai/generate', (req, reply) =>
    reply
      .code(202)
      .send(tasksOr404().startGeneration((req.body as { caseIds?: unknown } | null)?.caseIds)),
  );
  app.get('/api/ai/jobs', () => ({ items: tasksOr404().jobs() }));
  app.get<{ Params: { id: string } }>('/api/ai/jobs/:id', (req) => {
    const job = tasksOr404().job(req.params.id);
    if (!job) throw new HttpError(404, 'unknown-job', 'There is no such generation job.');
    return job;
  });
  app.delete<{ Params: { id: string } }>('/api/ai/jobs/:id', (req) => ({
    cancelled: tasksOr404().cancel(req.params.id),
  }));
  app.post('/api/ai/diagnose', (req) => tasksOr404().diagnose(req.body));
  // Proposes revised steps for review; nothing is saved until the tester saves them in the editor.
  app.post('/api/ai/steps/revise', (req) => tasksOr404().reviseSteps(req.body));
  app.get('/api/ai/explore', () => ({ defaultPaths: DEFAULT_EXPLORE_PATHS, max: MAX_EXPLORE }));
  app.post('/api/ai/explore', async (req) => ({ items: await tasksOr404().explore(req.body) }));
  app.post('/api/ai/cases/preview', async (req) => {
    const body = (req.body ?? {}) as { prompt?: unknown; projectId?: unknown; options?: unknown };
    // The project decides which page names the AI may use in steps.
    const projectId = z.number().int().positive().optional().parse(body.projectId);
    return tasksOr404().previewCases(body.prompt, projectId, body.options);
  });
  // Same as preview, but the model may answer with clarifying questions instead (the voice conversation uses it).
  app.post('/api/ai/cases/ask', async (req) => {
    const body = (req.body ?? {}) as { prompt?: unknown; projectId?: unknown; options?: unknown };
    const projectId = z.number().int().positive().optional().parse(body.projectId);
    return tasksOr404().askOrPreviewCases(body.prompt, projectId, body.options);
  });
  // Saved skills: `/skill-name` in a generation prompt applies one. The change is announced by the hook on writes.
  const skillsOr404 = () => {
    if (!automation.skills)
      throw new HttpError(404, 'skills-unavailable', 'Skills are not available.');
    return automation.skills;
  };
  app.get('/api/ai/skills', () => ({ items: skillsOr404().list() }));
  app.put<{ Params: { name: string } }>('/api/ai/skills/:name', (req) =>
    skillsOr404().save(req.params.name, req.body),
  );
  app.delete<{ Params: { name: string } }>('/api/ai/skills/:name', (req, reply) => {
    skillsOr404().remove(req.params.name);
    return reply.code(204).send();
  });
  app.post('/api/ai/cases', (req, reply) => {
    const body = (req.body ?? {}) as {
      cases?: unknown;
      projectId?: unknown;
      testSuiteId?: unknown;
      projectVersionId?: unknown;
    };
    const hints = z
      .object({
        projectId: z.number().int().positive().optional(),
        testSuiteId: z.number().int().positive().optional(),
        projectVersionId: z.number().int().positive().optional(),
      })
      .parse({
        projectId: body.projectId,
        testSuiteId: body.testSuiteId,
        projectVersionId: body.projectVersionId,
      });
    return reply.code(201).send({ items: tasksOr404().addCases(body.cases, hints) });
  });

  const scenariosOr404 = () => {
    if (!automation.scenarioService) {
      throw new HttpError(404, 'scenarios-unavailable', 'Scenario review is not available.');
    }
    return automation.scenarioService;
  };
  app.get('/api/scenarios', () => ({ items: scenariosOr404().list() }));
  app.get<{ Params: { caseId: string } }>('/api/scenarios/:caseId', (req) =>
    scenariosOr404().get(req.params.caseId),
  );
  app.put<{ Params: { caseId: string } }>('/api/scenarios/:caseId/draft', (req) => {
    const b = (req.body ?? {}) as { steps?: unknown; description?: unknown; note?: unknown };
    // Drafts sent through the API are manual; only the AI agents inside the server can mark one as AI-written.
    return scenariosOr404().saveDraft(req.params.caseId, { ...b, origin: 'manual' });
  });
  app.post<{ Params: { caseId: string } }>('/api/scenarios/:caseId/approve', (req) =>
    scenariosOr404().approve(req.params.caseId),
  );
  app.delete<{ Params: { caseId: string } }>('/api/scenarios/:caseId/draft', (req) => ({
    discarded: scenariosOr404().discardDraft(req.params.caseId),
  }));
  app.delete<{ Params: { caseId: string } }>('/api/scenarios/:caseId/approved', (req) => ({
    revoked: scenariosOr404().revoke(req.params.caseId),
  }));
  // Check steps while they are being edited, without saving: one list of problems and warnings per step.
  app.post('/api/scenarios/validate', (req) => {
    const b = z
      .object({
        steps: z
          .array(
            z.object({ action: z.string(), params: z.record(z.string(), z.unknown()).default({}) }),
          )
          .max(200),
      })
      .parse(req.body ?? {});
    const svc = scenariosOr404();
    return {
      steps: b.steps.map((step, i) => {
        if (!step.action) return { index: i, issues: ['Choose an action.'], warnings: [] };
        const r = svc.validate({ schemaVersion: 1, caseId: 'check', steps: [step] });
        // The service numbers steps from 1 within the one-step scenario; drop that prefix for the editor.
        const strip = (m: string) => m.replace(/^Step 1 \([^)]*\): /, '');
        return { index: i, issues: r.issues.map(strip), warnings: r.warnings.map(strip) };
      }),
    };
  });

  // A person saving steps in the editor: valid steps run from now on.
  app.put<{ Params: { caseId: string } }>('/api/scenarios/:caseId', (req) => {
    const b = (req.body ?? {}) as {
      steps?: unknown;
      description?: unknown;
      expectedVersion?: unknown;
    };
    return scenariosOr404().saveEdit(req.params.caseId, b);
  });
  app.get<{ Params: { caseId: string } }>('/api/scenarios/:caseId/history', (req) => ({
    items: scenariosOr404().history(req.params.caseId),
  }));
  app.post<{ Params: { caseId: string; version: string } }>(
    '/api/scenarios/:caseId/restore/:version',
    (req) => scenariosOr404().restore(req.params.caseId, Number(req.params.version)),
  );

  const knowledgeOr404 = () => {
    if (!automation.knowledge) {
      throw new HttpError(404, 'knowledge-unavailable', 'The knowledge index is not available.');
    }
    return automation.knowledge;
  };
  app.get('/api/knowledge', () => knowledgeOr404().stats());
  app.post('/api/knowledge/reindex', () => knowledgeOr404().reindex());
  app.get('/api/knowledge/search', (req) => {
    const q = String((req.query as { q?: string }).q ?? '').slice(0, 300);
    return { items: knowledgeOr404().search(q) };
  });

  const connectionsOr404 = (): ConnectionsProvider => {
    if (!automation.connections)
      throw new HttpError(404, 'not-found', 'Project connections are not available.');
    return automation.connections;
  };
  app.get('/api/project-connections', () => connectionsOr404().list());
  app.post('/api/project-connections/check', (req, reply) => {
    connectionsOr404().check(req.body);
    return reply.code(204).send();
  });
  app.put<{ Params: { projectId: string } }>('/api/project-connections/:projectId', (req) => {
    const projectId = z.coerce.number().int().positive().safeParse(req.params.projectId);
    if (!projectId.success) throw new HttpError(400, 'invalid-project', 'Unknown project.');
    return connectionsOr404().save(projectId.data, req.body);
  });

  app.get('/api/accounts', () => ({ items: accountsOr404().list() }));
  app.post('/api/accounts', (req, reply) => reply.code(201).send(accountsOr404().create(req.body)));
  app.put<{ Params: { id: string } }>('/api/accounts/:id', (req) =>
    accountsOr404().update(req.params.id, req.body),
  );
  app.delete<{ Params: { id: string } }>('/api/accounts/:id', (req, reply) => {
    accountsOr404().remove(req.params.id);
    return reply.code(204).send();
  });
  app.post<{ Params: { id: string } }>('/api/accounts/:id/test', (req) =>
    accountsOr404().test(req.params.id),
  );
  // The session itself is never returned: only when it was saved.
  app.post<{ Params: { id: string } }>('/api/accounts/:id/session', (req) => {
    const a = accountsOr404();
    if (!a.captureSession)
      throw new HttpError(404, 'capture-unavailable', 'Signing in by hand is not available.');
    return a.captureSession(req.params.id);
  });
  app.delete<{ Params: { id: string } }>('/api/accounts/:id/session', (req) => {
    const a = accountsOr404();
    if (!a.clearSession)
      throw new HttpError(404, 'capture-unavailable', 'Saved sessions are not available.');
    return a.clearSession(req.params.id);
  });

  // ---- Test case parameters ----
  // Reading, saving, suggesting and auto-filling parameter values are served by the .NET API (/api/parameters…), which stores
  // them. The worker takes part in two ways: a run asks the API for its values (see POST /api/runs below), and the API asks
  // the worker for the AI's suggestions (POST /internal/parameters/ai-suggest, in internal-sync.ts).

  // ---- Custom steps (project-defined, reusable recipes of generic steps) ----
  const ProjectParam = z.coerce.number().int().positive();
  const customStepsOr404 = () => {
    if (!automation.customSteps) {
      throw new HttpError(404, 'custom-steps-unavailable', 'Custom steps are not available.');
    }
    return automation.customSteps;
  };
  app.get<{ Params: { projectId: string } }>('/api/custom-steps/:projectId', (req) => ({
    items: customStepsOr404().list(ProjectParam.parse(req.params.projectId)),
  }));
  app.put<{ Params: { projectId: string } }>('/api/custom-steps/:projectId', (req) => {
    // The change is announced to open pages by the hook on every changing request.
    return { items: customStepsOr404().save(ProjectParam.parse(req.params.projectId), req.body) };
  });

  // ---- Azure DevOps ----
  const adoOr404 = () => {
    if (!automation.azureDevOps) {
      throw new HttpError(404, 'azure-devops-unavailable', 'Azure DevOps is not available.');
    }
    return automation.azureDevOps;
  };
  const PlanParam = z.coerce.number().int().positive();
  app.get('/api/azure-devops', () => adoOr404().view());
  app.put('/api/azure-devops', (req) => adoOr404().update(req.body));
  app.put('/api/azure-devops/token', (req) => adoOr404().setToken(req.body));
  app.delete('/api/azure-devops/token', () => adoOr404().removeToken());
  app.post('/api/azure-devops/test', () => adoOr404().test());
  app.get('/api/azure-devops/plans', async () => ({ items: await adoOr404().plans() }));
  app.get<{ Params: { planId: string } }>(
    '/api/azure-devops/plans/:planId/suites',
    async (req) => ({
      items: await adoOr404().suites(PlanParam.parse(req.params.planId)),
    }),
  );
  app.post('/api/azure-devops/import', (req) => adoOr404().importCases(req.body));
  app.post('/api/azure-devops/publish', (req) => {
    const b = z
      .object({
        runId: z.string().min(1),
        planId: z.number().int().positive(),
        suiteId: z.number().int().positive(),
      })
      .parse(req.body ?? {});
    const run = automation.runs?.get(b.runId);
    if (!run) throw new HttpError(404, 'unknown-run', 'There is no such run.');
    return adoOr404().publishResults({ planId: b.planId, suiteId: b.suiteId, run });
  });
  app.get('/api/azure-devops/jobs', () => ({ items: adoOr404().jobsList() }));
  app.post('/api/azure-devops/pipeline', (req, reply) => {
    // The pipeline drives the same routes a person uses, so every check of a manual run applies unchanged.
    const call = async <T>(method: 'GET' | 'POST', url: string, payload?: unknown): Promise<T> => {
      const res = await app.inject({
        method,
        url,
        ...(payload !== undefined && { payload: payload as object }),
      });
      const json = res.json<T & { error?: { message?: string } }>();
      if (res.statusCode >= 400)
        throw new Error(json.error?.message ?? `Step failed (${res.statusCode}).`);
      return json;
    };
    const host: PipelineHost = {
      convert: async (caseIds) => {
        const job = await call<ConversionJob>('POST', '/api/conversions', { caseIds });
        let current = job;
        // A conversion is a background job: wait for it, bounded so a stuck job cannot hold the pipeline forever.
        for (let i = 0; i < 600 && current.status === 'running'; i++) {
          await new Promise((r) => setTimeout(r, 1000));
          current = await call<ConversionJob>('GET', `/api/conversions/${job.id}`);
        }
        return {
          ready: current.counts.ready,
          needsReview: current.counts['needs-review'] + current.counts.failed,
        };
      },
      approve: async (caseIds) =>
        (await call<{ approved: number }>('POST', '/api/scenarios/approve', { caseIds })).approved,
      runnable: (caseIds) => caseIds.filter((id) => automation.scenarios?.has(id)),
      configure: async (caseIds) => {
        if (!automation.parameters) return 0;
        return (await automation.parameters.autoConfigure(caseIds, true)).stillMissing.length;
      },
      run: async (caseIds, accountIds) => {
        const started = await call<{ id: string }>('POST', '/api/runs', { caseIds, accountIds });
        const done = await automation.runs?.whenDone(started.id);
        if (!done) throw new Error('The run could not be followed.');
        return done;
      },
    };
    return reply.code(202).send(adoOr404().startPipeline(req.body, host));
  });

  app.get('/api/audit', () => ({ items: automation.audit?.list(100) ?? [] }));

  // The API forwards every /api route it does not implement here, so an unknown route almost always means the worker
  // is an older build than the web app (it was started before an update and not restarted). Say so, with the route,
  // instead of a bare "Not found" that reads like missing data.
  app.setNotFoundHandler((req, reply) =>
    reply.code(404).send({
      error: {
        code: ROUTE_NOT_FOUND,
        message: `This server has no ${req.method} ${req.url.split('?')[0] ?? ''}. The worker may be older than the web app: restart QA Studio (npm start in Backend/Worker) so both run the same version.`,
      },
    }),
  );

  return app;
}
