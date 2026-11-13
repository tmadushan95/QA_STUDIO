/**
 * Storage for the worker when SQL Server (behind the .NET API) holds the data.
 *
 * The services above this layer are synchronous, and they were written against reads that never wait. So reads come
 * from a private in-memory copy, filled from the API at start-up, and every write also goes to the API, in order. Nothing
 * is written to disk. A request that changed something is not answered until its writes have committed (see `flush` and
 * the hook in server.ts), so "saved" still means saved in the database.
 */
import { Run, TestCase } from '@qa-studio/shared';
import { SqliteStorage, type AccountRow } from './sqlite-storage.js';

/** One write, in the shape `POST /internal/persistence/batch` applies. */
export interface RemoteOperation {
  kind: string;
  key?: string;
  slot?: 'draft' | 'approved';
  version?: number;
  payload?: unknown;
}

/** What `GET /internal/persistence/snapshot` returns. */
export interface RemoteSnapshot {
  testCases: unknown[];
  scenarios: { slot: 'draft' | 'approved'; caseId: string; record: unknown }[];
  revisions: { caseId: string; version: number; record: unknown }[];
  runs: unknown[];
  config: Record<string, unknown>;
  accounts: AccountRow[];
  sessions: { accountId: string; stateEnc: string; savedAt: string }[];
  aiKeys: { provider: string; keyEnc: string; updatedAt: string }[];
  backups: { id: string; createdAt: string; reason: string }[];
}

export interface RemoteStorageOptions {
  baseUrl: string;
  /** Shared secret for the API's internal routes. */
  token: string;
  log: { info(m: string, c?: object): void; error(m: string, c?: object): void };
  fetch?: typeof fetch;
  /** Wait between attempts while the API is unreachable. */
  retryMs?: number;
  /** Most operations per request. Long imports go in several transactions, in order. */
  batchSize?: number;
}

const TOKEN_HEADER = 'x-qa-internal-token';
const SETTINGS_KEY = 'app';
/** Coalesces bursts, such as a run's progress or one import's cases, into one transaction. */
const FLUSH_DELAY_MS = 100;

export class RemoteStorage extends SqliteStorage {
  private hydrating = false;
  private readonly pending: RemoteOperation[] = [];
  /** How many of the oldest pending operations are on the wire and so must not be changed. */
  private inFlight = 0;
  private draining: Promise<void> | undefined;
  private timer: NodeJS.Timeout | undefined;
  private readonly send: typeof fetch;
  private readonly retryMs: number;
  private readonly batchSize: number;

  constructor(private readonly o: RemoteStorageOptions) {
    super(':memory:');
    this.send = o.fetch ?? fetch;
    this.retryMs = o.retryMs ?? 2000;
    this.batchSize = o.batchSize ?? 200;
  }

  private url(path: string): string {
    return `${this.o.baseUrl.replace(/\/+$/, '')}${path}`;
  }

  private get headers(): Record<string, string> {
    return { [TOKEN_HEADER]: this.o.token, 'content-type': 'application/json' };
  }

  /** Fill the in-memory copy from the API, waiting for it to come up. The two services may start in any order. */
  async connect(maxWaitMs = 60_000): Promise<void> {
    const giveUpAt = Date.now() + maxWaitMs;
    for (;;) {
      try {
        const res = await this.send(this.url('/internal/persistence/snapshot'), {
          headers: this.headers,
        });
        if (res.status === 401) {
          // Waiting cannot fix a wrong secret, so say so at once.
          throw new FatalLoadError(
            'The API refused QA_INTERNAL_TOKEN. It must equal Worker:InternalToken in the API settings.',
          );
        }
        if (!res.ok) throw new Error(`The API answered ${res.status}.`);
        this.hydrate((await res.json()) as RemoteSnapshot);
        return;
      } catch (e) {
        if (e instanceof FatalLoadError || Date.now() >= giveUpAt) throw e;
        this.o.log.info('waiting for the QA Studio API', { error: String(e) });
        await new Promise((r) => setTimeout(r, this.retryMs));
      }
    }
  }

  private hydrate(s: RemoteSnapshot): void {
    this.hydrating = true;
    try {
      for (const raw of s.testCases) {
        const tc = TestCase.safeParse(raw);
        if (tc.success) super.saveCase(tc.data);
      }
      for (const r of s.scenarios) super.saveScenarioRecord(r.slot, r.caseId, r.record);
      for (const r of s.revisions) super.saveScenarioRevision(r.caseId, r.version, r.record);
      for (const raw of s.runs) {
        const run = Run.safeParse(raw);
        if (run.success) super.saveRun(run.data);
      }
      for (const [key, value] of Object.entries(s.config)) super.saveConfig(key, value);
      for (const a of s.accounts) super.saveAccount(a);
      for (const r of s.sessions) super.saveSession(r.accountId, r.stateEnc, r.savedAt);
      for (const k of s.aiKeys) super.saveAiKey(k.provider, k.keyEnc, k.updatedAt);
      for (const b of s.backups) super.saveBackup(b.id, b.createdAt, b.reason, b);
    } finally {
      this.hydrating = false;
    }
  }

  /** Every test case as stored now. Pending writes go first, so they are not read back as older values. */
  async fetchCases(): Promise<TestCase[]> {
    await this.flush();
    const res = await this.send(this.url('/internal/persistence/test-cases'), {
      headers: this.headers,
    });
    if (!res.ok) throw new Error(`The API answered ${res.status}.`);
    const { items } = (await res.json()) as { items: unknown[] };
    return items.flatMap((raw) => {
      const tc = TestCase.safeParse(raw);
      return tc.success ? [tc.data] : [];
    });
  }

  /**
   * A configuration block the API changed (the page list, for example). It is already saved, so it is only taken into the
   * in-memory copy and not written back.
   */
  applyRemoteConfig(key: string, value: unknown): void {
    this.hydrating = true;
    try {
      super.saveConfig(key, value);
    } finally {
      this.hydrating = false;
    }
  }

  /** A configuration block and its per-project blocks (`pages`, `pages:3`) as the database holds them now. */
  async fetchConfig(prefix: string): Promise<{ key: string; value: unknown }[]> {
    await this.flush();
    const res = await this.send(
      this.url(`/internal/persistence/config?prefix=${encodeURIComponent(prefix)}`),
      { headers: this.headers },
    );
    if (!res.ok) throw new Error(`The API answered ${res.status}.`);
    const { items } = (await res.json()) as { items: { key: string; value: unknown }[] };
    return items;
  }

  // ---- writes: the in-memory copy, then the database ----

  private enqueue(op: RemoteOperation): void {
    if (this.hydrating) return;
    // A run reports progress constantly and only its latest state matters, so a waiting one is replaced in place.
    // The search stops at a `run.delete-all`, whose order against the writes around it does matter.
    if (op.kind === 'run.upsert') {
      for (let i = this.pending.length - 1; i >= this.inFlight; i--) {
        const other = this.pending[i]!;
        if (other.kind === 'run.delete-all') break;
        if (other.kind === 'run.upsert' && other.key === op.key) {
          this.pending[i] = op;
          return;
        }
      }
    }
    this.pending.push(op);
    this.schedule(FLUSH_DELAY_MS);
  }

  private schedule(ms: number): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      // A failure is already logged and rescheduled inside the drain; nobody is waiting on this attempt.
      this.flush().catch(() => undefined);
    }, ms);
    this.timer.unref();
  }

  /**
   * Resolves when every write so far has committed. Rejects if the API cannot take them right now; they stay queued,
   * in order, and are retried, so nothing is lost while the worker keeps running.
   */
  flush(): Promise<void> {
    this.draining ??= this.drain().finally(() => {
      this.draining = undefined;
    });
    return this.draining;
  }

  private async drain(): Promise<void> {
    while (this.pending.length > 0) {
      this.inFlight = Math.min(this.batchSize, this.pending.length);
      try {
        const res = await this.send(this.url('/internal/persistence/batch'), {
          method: 'POST',
          headers: this.headers,
          body: JSON.stringify({ operations: this.pending.slice(0, this.inFlight) }),
        });
        if (res.status >= 400 && res.status < 500) {
          // The database refused the content. Retrying cannot change that and would block every later write, so
          // these are dropped and reported. They are still in the in-memory copy until the next restart.
          const dropped = this.pending.splice(0, this.inFlight);
          this.o.log.error('the API refused writes', {
            status: res.status,
            kinds: [...new Set(dropped.map((d) => d.kind))],
            body: (await res.text()).slice(0, 500),
          });
          throw new Error(`The API refused the data (${res.status}).`);
        }
        if (!res.ok) throw new RetryableError(`The API answered ${res.status}.`);
        this.pending.splice(0, this.inFlight);
      } catch (e) {
        if (e instanceof RetryableError || e instanceof TypeError) {
          this.o.log.error('could not reach the API; will retry', {
            pending: this.pending.length,
            error: String(e),
          });
          this.schedule(this.retryMs);
        }
        throw e;
      } finally {
        this.inFlight = 0;
      }
    }
  }

  override saveCase(tc: TestCase): void {
    super.saveCase(tc);
    this.enqueue({ kind: 'test-case.upsert', key: tc.id, payload: tc });
  }

  override deleteCase(id: string): boolean {
    const had = super.deleteCase(id);
    this.enqueue({ kind: 'test-case.delete', key: id });
    return had;
  }

  override deleteAllCases(): number {
    const n = super.deleteAllCases();
    this.enqueue({ kind: 'test-case.delete-all' });
    return n;
  }

  override saveRun(run: Run): void {
    super.saveRun(run);
    this.enqueue({ kind: 'run.upsert', key: run.id, payload: run });
  }

  override deleteAllRuns(): number {
    const n = super.deleteAllRuns();
    this.enqueue({ kind: 'run.delete-all' });
    return n;
  }

  override saveSettings(settings: unknown): void {
    super.saveSettings(settings);
    this.enqueue({ kind: 'config.upsert', key: SETTINGS_KEY, payload: settings });
  }

  override saveConfig(key: string, value: unknown): void {
    super.saveConfig(key, value);
    this.enqueue({ kind: 'config.upsert', key, payload: value });
  }

  override saveScenarioRecord(slot: 'draft' | 'approved', caseId: string, record: unknown): void {
    super.saveScenarioRecord(slot, caseId, record);
    this.enqueue({ kind: 'scenario.upsert', key: caseId, slot, payload: record });
  }

  override deleteScenarioRecord(slot: 'draft' | 'approved', caseId: string): boolean {
    const had = super.deleteScenarioRecord(slot, caseId);
    this.enqueue({ kind: 'scenario.delete', key: caseId, slot });
    return had;
  }

  override saveScenarioRevision(caseId: string, version: number, record: unknown): void {
    super.saveScenarioRevision(caseId, version, record);
    this.enqueue({ kind: 'revision.upsert', key: caseId, version, payload: record });
  }

  override deleteAllScenarioRecords(): number {
    const n = super.deleteAllScenarioRecords();
    this.enqueue({ kind: 'scenario.delete-all' });
    return n;
  }

  override saveSession(accountId: string, stateEnc: string, savedAt?: string): void {
    const at = savedAt ?? new Date().toISOString();
    super.saveSession(accountId, stateEnc, at);
    this.enqueue({ kind: 'session.upsert', key: accountId, payload: { stateEnc, savedAt: at } });
  }

  override deleteSession(accountId: string): boolean {
    const had = super.deleteSession(accountId);
    this.enqueue({ kind: 'session.delete', key: accountId });
    return had;
  }

  override saveAiKey(provider: string, keyEnc: string, updatedAt?: string): void {
    const at = updatedAt ?? new Date().toISOString();
    super.saveAiKey(provider, keyEnc, at);
    this.enqueue({ kind: 'ai-key.upsert', key: provider, payload: { keyEnc, updatedAt: at } });
  }

  override deleteAiKey(provider: string): boolean {
    const had = super.deleteAiKey(provider);
    this.enqueue({ kind: 'ai-key.delete', key: provider });
    return had;
  }

  override saveAccount(a: AccountRow): void {
    super.saveAccount(a);
    this.enqueue({ kind: 'account.upsert', key: a.id, payload: a });
  }

  override deleteAccount(id: string): boolean {
    const had = super.deleteAccount(id);
    this.enqueue({ kind: 'account.delete', key: id });
    return had;
  }

  override addAudit(action: string, target: string, detail: string): void {
    super.addAudit(action, target, detail);
    this.enqueue({
      kind: 'audit.add',
      payload: { at: new Date().toISOString(), action, target, detail },
    });
  }

  override saveBackup(id: string, createdAt: string, reason: string, snapshot: unknown): void {
    super.saveBackup(id, createdAt, reason, snapshot);
    this.enqueue({ kind: 'backup.upsert', key: id, payload: snapshot });
  }

  /** Where the cases were filed is known only to the database, so it puts that back itself. */
  backupRestored(id: string): void {
    this.enqueue({ kind: 'backup.restored', key: id });
  }

  override deleteBackup(id: string): boolean {
    const had = super.deleteBackup(id);
    this.enqueue({ kind: 'backup.delete', key: id });
    return had;
  }
}

/** The API answered, and waiting will not change its answer. */
class FatalLoadError extends Error {}

/** A failure that may pass: the API or its database is restarting. */
class RetryableError extends Error {}
