import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  ActionRegistry,
  LEGACY_PAGES,
  registerAppActions,
  registerGenericActions,
  registerDeleteProjectActions,
} from '@qa-studio/automation-core';
import { PlaywrightExecutor, RunManager } from '@qa-studio/execution-engine';
import { allowedEnvsFromEnv, ConfigError, createLogger, type Scenario } from '@qa-studio/shared';
import {
  KnowledgeIndex,
  actionDoc,
  scenarioDoc,
  testCaseDoc,
  type SqlDb,
} from '@qa-studio/knowledge';
import { AccountService } from './accounts.js';
import { AiService } from './ai-service.js';
import { AiTasks } from './ai-tasks.js';
import { VoiceService, liveKitTransport } from './voice-service.js';
import { ScenarioService } from './scenario-service.js';
import { CustomStepService } from './custom-steps.js';
import { SkillService } from './skills.js';
import { ParameterClient } from './parameter-client.js';
import { AzureDevOpsService } from './azure-devops.js';
import { BackupService } from './backups.js';
import { ConversionService } from './conversions.js';
import { PageMapService } from './page-map.js';
import { ProjectConnectionService } from './project-connections.js';
import { createApp } from './app.js';
import { HttpError } from './errors.js';
import { registerInternalSync, registerParameterAi } from './internal-sync.js';
import { RemoteStorage } from './remote-storage.js';
import { EventBus } from './events.js';
import { isLoopbackHost } from './security.js';
import { loadSecretKey, SecretBox } from './secrets.js';
import { SettingsService } from './settings-service.js';
import { MemoryStore } from './store.js';
import { startTelemetry } from './telemetry.js';

const port = Number(process.env['PORT'] ?? 4000);
// Loopback by default. Listening on anything else is refused unless an access token protects the API.
const host = process.env['HOST'] ?? '127.0.0.1';
const log = createLogger((l) => process.stdout.write(`${l}\n`));

try {
  process.loadEnvFile('.env');
} catch {
  // No .env file: rely on the process environment.
}

// Before anything calls fetch, so the first calls to the API are traced too. Undefined (and nothing loaded) unless the
// Aspire AppHost or an operator sets OTEL_EXPORTER_OTLP_ENDPOINT.
const telemetry = await startTelemetry();

const fail = (message: string): never => {
  process.stderr.write(`qa-api cannot start: ${message}\n`);
  process.exit(1);
};

const adminToken = process.env['QA_ADMIN_TOKEN'] || undefined;
if (adminToken !== undefined && adminToken.length < 16) {
  fail('QA_ADMIN_TOKEN must be at least 16 characters.');
}
if (!isLoopbackHost(host) && adminToken === undefined) {
  fail(
    `HOST is ${host}, which is not a loopback address. Set QA_ADMIN_TOKEN (16+ characters) to protect the API, or use HOST=127.0.0.1.`,
  );
}
const csv = (v: string | undefined) =>
  (v ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

const frameworkVersion = (
  JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
    version: string;
  }
).version;

const artifactsDir = path.resolve(process.env['QA_ARTIFACTS_DIR'] ?? 'artifacts');
const DATABASE_LABEL = 'SQL Server, through the QA Studio API';

// This worker keeps no data of its own: SQL Server, behind the .NET API, holds everything. The API is the only way in
// for browsers too, so the worker stays on loopback and answers only what the API forwards.
const internalToken = process.env['QA_INTERNAL_TOKEN'] ?? '';
if (internalToken.length < 16) {
  fail(
    'QA_INTERNAL_TOKEN must be set (16+ characters) and equal Worker:InternalToken in the API settings.',
  );
}
const storage = new RemoteStorage({
  baseUrl: process.env['QA_PERSISTENCE_URL'] ?? 'http://127.0.0.1:5080',
  token: internalToken,
  log,
});
try {
  await storage.connect();
} catch (e) {
  fail(`could not load data from the QA Studio API: ${e instanceof Error ? e.message : String(e)}`);
}
const store = new MemoryStore(storage);
// The key that decrypts account passwords and AI keys stays apart from the database that holds them.
const box = new SecretBox(
  loadSecretKey({
    envKey: process.env['QA_SECRET_KEY'],
    keyFile: path.resolve(process.env['QA_SECRET_KEY_FILE'] ?? 'data/secret.key'),
  }),
);
const audit = (action: string, target: string, detail: string) =>
  storage.addAudit(action, target, detail);

const settings = new SettingsService({
  store: storage,
  env: process.env,
  audit,
  info: {
    paths: {
      database: DATABASE_LABEL,
      artifacts: artifactsDir,
      scenarios: DATABASE_LABEL,
      dashboard: null,
    },
    runtime: { node: process.version, platform: process.platform, frameworkVersion },
    security: {
      accessTokenRequired: adminToken !== undefined,
      listening: `${host}:${port}`,
      destructiveAllowed: process.env['QA_ALLOW_DESTRUCTIVE'] === 'true',
    },
  },
});

// Each project has its own address and sign-in. An install from before that starts with what it was already using.
const connections = new ProjectConnectionService({
  store: storage,
  settings,
  allowedEnvs: allowedEnvsFromEnv(process.env),
  audit,
});
connections.seedFromSettings(
  [...store.inventory.values()].flatMap((c) => (c.projectId === undefined ? [] : [c.projectId])),
);

// The generic step library works for any application. The application pack steps stay registered until its scenarios are
// rewritten with generic steps, so the existing scenario files keep running.
const registry = registerDeleteProjectActions(
  registerAppActions(registerGenericActions(new ActionRegistry())),
);

// Steps that delete data run only when this is switched on, and only against the configured test environment.
const allowDestructive = process.env['QA_ALLOW_DESTRUCTIVE'] === 'true';
// What can run: every approved scenario. ScenarioService keeps this in step.
const scenarios = new Map<string, Scenario>();
const scenarioService = new ScenarioService({
  store: storage,
  registry,
  live: scenarios,
  caseIds: () => new Set(store.inventory.keys()),
  audit,
});
// Steps a project defines for itself. They are registered as actions, so everything that validates or runs steps sees them.
const customSteps = new CustomStepService({
  store: storage,
  registry,
  casesUsing: (action) =>
    [...store.inventory.keys()].filter((id) => {
      const s = scenarioService.get(id);
      return [s.draft, s.approved].some((r) => r?.scenario.steps.some((x) => x.action === action));
    }),
  audit,
});
// Parameter values live in the API's database. The worker asks for them when a run starts, and for backups and clearing.
const parameters = new ParameterClient({
  baseUrl: process.env['QA_PERSISTENCE_URL'] ?? 'http://127.0.0.1:5080',
  token: internalToken,
});

// Live updates for open dashboards: runs, saves and background jobs publish here.
const events = new EventBus();

// Settings › Pages. An existing setup starts from the routes it already had, which can then be edited in the app.
const pageMap = new PageMapService(storage, audit, LEGACY_PAGES);
pageMap.seed();

// Imported test cases are turned into steps by the rule-based converter, as a job with live progress.
const conversions = new ConversionService({
  inventory: store.inventory,
  scenarios: scenarioService,
  pages: () => pageMap.map(),
  events,
  audit,
});

// Snapshots before "clear all data", kept in the database so a clear can be undone for a week.
const backups = new BackupService({
  store: storage,
  cases: {
    list: () => [...store.inventory.values()],
    restore: (cases) => {
      for (const c of cases) store.inventory.set(c.id, c);
    },
  },
  scenarios: scenarioService,
  parameters,
  audit,
});

// Created before the account service, which needs it to test sign-in; credentials are looked up lazily.
// The executor needs credentials and the account service needs the executor to test sign-in, so link them lazily.
const lazy: { accounts?: AccountService } = {};
const executor = new PlaywrightExecutor({
  getSettings: (projectId) => connections.settingsFor(projectId),
  getCredentials: (id) => lazy.accounts?.credentials(id),
  getSession: (id) => lazy.accounts?.session(id),
  registry,
  artifactsDir,
  log,
  allowDestructive,
  getPages: (projectId) => pageMap.map(projectId),
});
const accounts = new AccountService({
  store: storage,
  box,
  audit,
  tester: async (creds, session, projectId) => {
    try {
      return await executor.testSignIn(connections.settingsFor(projectId), creds, session);
    } catch (e) {
      if (e instanceof ConfigError) throw new HttpError(409, 'not-configured', e.message);
      throw e;
    }
  },
  // A visible window opens on this computer; the person signs in there (SSO, second factor and all).
  capturer: async (projectId) => {
    let s;
    try {
      s = connections.settingsFor(projectId);
    } catch (e) {
      if (e instanceof ConfigError) throw new HttpError(409, 'not-configured', e.message);
      throw e;
    }
    try {
      return await executor.captureSession(s);
    } catch (e) {
      throw new HttpError(
        400,
        'sign-in-not-finished',
        e instanceof Error ? e.message : 'Sign-in did not finish.',
      );
    }
  },
  usesSavedSession: (projectId) => connections.signInMethod(projectId) === 'saved-session',
});
lazy.accounts = accounts;

const history = storage.loadRuns();
if (history.skipped > 0) log.warn('skipped unreadable stored runs', { skipped: history.skipped });
const runs = new RunManager(executor, {
  maxWorkers: 16,
  onChange: (run) => {
    storage.saveRun(run);
    // Run history is read from the database by the API, so a page told "this run changed" must find the change there:
    // announce it once it is committed (or once committing has failed, so the page is not left waiting).
    const announce = () => events.emit({ type: 'run', id: run.id, status: run.status });
    storage.flush().then(announce, announce);
  },
  onError: (e) => log.error('failed to persist run', { error: String(e) }),
  onClear: () => storage.deleteAllRuns(),
});
runs.restore(history.items);

const availability = connections.availability();
log.info('storage ready', {
  cases: store.inventory.size,
  runs: history.items.length,
  accounts: accounts.list().length,
  scenarios: scenarios.size,
  runsAvailable: availability.available,
  ...(availability.reason && { reason: availability.reason }),
});

const ai = new AiService({
  store: storage,
  box,
  env: process.env,
  audit,
  // Test-account passwords must never be sent to a model, whatever a prompt contains.
  extraSecrets: () => accounts.list().flatMap((a) => accounts.credentials(a.id)?.password ?? []),
  onCall: (r) =>
    log.info('model call', {
      provider: r.provider,
      model: r.model,
      inputChars: r.inputChars,
      inputTokens: r.usage.inputTokens,
      outputTokens: r.usage.outputTokens,
      ms: r.ms,
      ok: r.ok,
      ...(r.error && { error: r.error }),
    }),
});

// Voice control: settings live with the other config; LiveKit credentials come only from the environment.
const voice = new VoiceService({ store: storage, transport: liveKitTransport(process.env), audit });

// Local retrieval over the platform's own data. Rebuilt from the sources of truth, so it can never drift for long.
const kb = new KnowledgeIndex(storage.sql as unknown as SqlDb);
function reindexKnowledge() {
  kb.clearKind('test-case');
  for (const tc of store.inventory.values()) kb.upsert(testCaseDoc(tc));
  kb.clearKind('scenario');
  for (const s of scenarios.values()) kb.upsert(scenarioDoc(s));
  kb.clearKind('action');
  for (const a of registry.list()) kb.upsert(actionDoc(a));
  return kb.stats();
}
reindexKnowledge();
let reindexTimer: NodeJS.Timeout | undefined;
events.subscribe((e) => {
  // Anything that adds or removes cases or scenarios: imports, deletes, cases from a prompt, drafts and approvals.
  // (Generation jobs save drafts too; the job's end is a 'job' event, handled the same way.)
  const changesIndex =
    (e.type === 'data' &&
      /^\/api\/(imports|inventory|ai\/cases|scenarios|custom-steps)/.test(e.path)) ||
    (e.type === 'job' && e.status !== 'running');
  if (!changesIndex) return;
  clearTimeout(reindexTimer);
  reindexTimer = setTimeout(() => {
    try {
      reindexKnowledge();
    } catch (err) {
      log.error('knowledge reindex failed', { error: String(err) });
    }
  }, 500);
});

// Saved AI skills, applied when a generation prompt calls one with /skill-name.
const skills = new SkillService({ store: storage, audit });
const aiTasks = new AiTasks({
  skills: () => skills.skills(),
  ai,
  knowledge: kb,
  scenarios: scenarioService,
  actions: () => registry.list(),
  pages: (projectId) => Object.keys(pageMap.map(projectId)),
  inventory: store.inventory,
  events,
  audit,
  runs,
  artifactsDir,
  explore: async (paths, accountId) => {
    // Explores the chosen account's project, or else the first project that is set up.
    const all = accounts.list();
    const projectId = all.find((a) => a.id === accountId)?.projectId ?? connections.firstReady();
    const s = connections.settingsFor(projectId);
    let creds;
    let session;
    if (s.login.strategy !== 'none') {
      const id = accountId ?? all.find((a) => a.projectId === projectId)?.id;
      if (!id)
        throw new Error('Sign-in is on, so add a test account to the project to explore as.');
      if (s.login.strategy === 'saved-session') {
        session = accounts.session(id);
        creds = { username: '', password: '' };
      } else {
        creds = accounts.credentials(id);
        if (!creds)
          throw new Error('That account has no saved password. Enter it again on the project.');
      }
    }
    return executor.explore(s, creds, paths, session);
  },
});

// Azure DevOps Test Plans: import, automated pipeline and result publishing.
const azureDevOps = new AzureDevOpsService({
  store: storage,
  box,
  inventory: store.inventory,
  audit,
  publish: (job) => events.emit({ type: 'job', id: job.id, status: job.status }),
});

const app = createApp(
  store,
  {
    runs,
    events,
    registry,
    scenarios,
    artifactsDir,
    frameworkVersion,
    settings,
    accounts,
    connections,
    ai,
    voice,
    scenarioService,
    parameters,
    customSteps,
    azureDevOps,
    backups,
    conversions,
    aiTasks,
    skills,
    knowledge: {
      stats: () => kb.stats(),
      reindex: reindexKnowledge,
      search: (q) => kb.search(q),
    },
    audit: { list: (n) => storage.listAudit(n), add: audit },
  },
  {
    adminToken,
    allowedHosts: csv(process.env['QA_ALLOWED_HOSTS']),
    allowedOrigins: csv(process.env['QA_ALLOWED_ORIGINS']),
    secureCookie: process.env['QA_SECURE_COOKIE'] === 'true',
  },
);
telemetry?.instrument(app);
registerInternalSync(app, { token: internalToken, store, events, config: storage });

// The API asks for AI suggestions when it fills parameter values. Only when a provider is set up; otherwise it guesses.
registerParameterAi(app, {
  token: internalToken,
  suggest: (input) => (ai.view().ready ? aiTasks.suggestParameters(input) : Promise.resolve({})),
});

// Before a run, take the database's list: a notice from the API could have been missed while this worker was busy.
// Planning needs it too: it decides which project's accounts to offer, and a case can have moved project.
app.addHook('preHandler', async (req) => {
  const route = req.url.split('?')[0];
  if (req.method !== 'POST' || (route !== '/api/runs' && route !== '/api/runs/plan')) return;
  try {
    store.replaceFromRemote(await storage.fetchCases());
  } catch (e) {
    log.warn('could not refresh test cases before a run', { error: String(e) });
  }
  // The page list is edited in the API too, so it is taken from the database the same way.
  try {
    for (const block of await storage.fetchConfig('pages')) {
      storage.applyRemoteConfig(block.key, block.value);
    }
  } catch (e) {
    log.warn('could not refresh the page list before a run', { error: String(e) });
  }
});

// A person's change is reported as saved only once it is in the database.
app.addHook('onSend', async (req, reply, payload) => {
  if (req.method === 'GET' || req.method === 'HEAD') return payload;
  try {
    await storage.flush();
    return payload;
  } catch (e) {
    log.error('a change could not be saved to the database yet', { error: String(e) });
    // Rewritten here rather than thrown: the error handler's own reply would come back through this hook.
    void reply.code(503).header('content-type', 'application/json');
    return JSON.stringify({
      error: {
        code: 'storage-unavailable',
        message:
          'The database could not be reached. The change will be retried; check it in a moment.',
      },
    });
  }
});

const shutdown = () =>
  void Promise.all([app.close(), executor.close()]).finally(async () => {
    await storage.flush().catch(() => undefined);
    storage.close();
    process.exit(0);
  });
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

/** Open the app in the default browser (QA_OPEN_BROWSER=true, set by the `qa-studio` command). Failure is harmless. */
function openBrowser(url: string): void {
  const [cmd, args]: [string, string[]] =
    process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '', url]]
      : process.platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]];
  spawn(cmd, args, { detached: true, stdio: 'ignore' })
    .on('error', () => undefined)
    .unref();
}

app.listen({ port, host }).then(
  (addr) => {
    process.stdout.write(`QA Studio is running. Open ${addr}\n`);
    if (process.env['QA_OPEN_BROWSER'] === 'true') openBrowser(addr);
  },
  (err: unknown) => {
    const code = (err as { code?: string }).code;
    process.stderr.write(
      code === 'EADDRINUSE'
        ? `QA Studio cannot start: port ${port} is already in use. QA Studio may already be running: open http://${host}:${port}. Otherwise stop the other program, or set PORT to a different number.\n`
        : `QA Studio cannot start: ${String(err)}\n`,
    );
    process.exit(1);
  },
);
