import fs from 'node:fs';
import path from 'node:path';
import { Run, TestCase } from '@qa-studio/shared';
import { DatabaseSync } from './node-sqlite.js';

export const SCHEMA_VERSION = 4;

/** A saved test account. The password is only ever held here as ciphertext (see SecretBox). */
export interface AccountRow {
  id: string;
  /** The project this account signs in to. */
  projectId: number;
  label: string;
  username: string;
  passwordEnc: string;
  createdAt: string;
  updatedAt: string;
}

export interface AuditRow {
  id: number;
  at: string;
  action: string;
  target: string;
  detail: string;
}

export interface LoadResult<T> {
  items: T[];
  /** Rows that no longer match the current schema. They stay in the database untouched. */
  skipped: number;
}

/**
 * SQLite persistence for the test inventory and run history (Node's built-in `node:sqlite`, no native build).
 * Rows hold validated JSON; on load every row is re-validated, so a corrupted or outdated row is reported and
 * skipped instead of crashing the service.
 */
export class SqliteStorage {
  private readonly db: DatabaseSync;

  constructor(file: string) {
    if (file !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
    this.db = new DatabaseSync(file);
    try {
      this.db.exec(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS test_cases (id TEXT PRIMARY KEY, json TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, json TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS runs_created ON runs (created_at);
        CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, json TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS accounts (
          id TEXT PRIMARY KEY, project_id INTEGER NOT NULL, label TEXT NOT NULL COLLATE NOCASE, username TEXT NOT NULL,
          password_enc TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
          UNIQUE (project_id, label)
        );
        CREATE TABLE IF NOT EXISTS scenario_drafts (case_id TEXT PRIMARY KEY, json TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS scenario_approved (case_id TEXT PRIMARY KEY, json TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS scenario_history (
          case_id TEXT NOT NULL, version INTEGER NOT NULL, json TEXT NOT NULL, PRIMARY KEY (case_id, version)
        );
        CREATE TABLE IF NOT EXISTS account_sessions (
          account_id TEXT PRIMARY KEY, state_enc TEXT NOT NULL, saved_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS ai_keys (
          provider TEXT PRIMARY KEY, key_enc TEXT NOT NULL, updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS audit (
          id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL, detail TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS backups (
          id TEXT PRIMARY KEY, created_at TEXT NOT NULL, reason TEXT NOT NULL, json TEXT NOT NULL
        );
      `);
      const row = this.db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as
        | { value: string }
        | undefined;
      if (!row) {
        this.db
          .prepare("INSERT INTO meta (key, value) VALUES ('schema_version', ?)")
          .run(String(SCHEMA_VERSION));
      } else if (Number(row.value) > SCHEMA_VERSION) {
        throw new Error(
          `Database schema version ${row.value} is newer than this build supports (${SCHEMA_VERSION}).`,
        );
      } else if (Number(row.value) < SCHEMA_VERSION) {
        // Versions 2 to 4 only add tables (created above), so an older database upgrades in place.
        this.db
          .prepare("UPDATE meta SET value = ? WHERE key = 'schema_version'")
          .run(String(SCHEMA_VERSION));
      }
    } catch (e) {
      this.db.close(); // do not leave the file locked when startup is refused
      throw e;
    }
  }

  /** Upsert keeps the row's original position, so inventory order is stable across updates. */
  saveCase(tc: TestCase): void {
    this.db
      .prepare(
        'INSERT INTO test_cases (id, json) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json',
      )
      .run(tc.id, JSON.stringify(tc));
  }

  loadCases(): LoadResult<TestCase> {
    return this.load('SELECT json FROM test_cases ORDER BY rowid', TestCase);
  }

  /** Remove one stored test case. Returns whether it existed. */
  deleteCase(id: string): boolean {
    return Number(this.db.prepare('DELETE FROM test_cases WHERE id = ?').run(id).changes) > 0;
  }

  /** Remove every stored test case. Returns how many rows went. Settings, accounts and runs are untouched. */
  deleteAllCases(): number {
    return Number(this.db.prepare('DELETE FROM test_cases').run().changes);
  }

  /** Remove every stored run. Returns how many rows went. Evidence files on disk are not touched. */
  deleteAllRuns(): number {
    return Number(this.db.prepare('DELETE FROM runs').run().changes);
  }

  saveRun(run: Run): void {
    this.db
      .prepare(
        'INSERT INTO runs (id, created_at, json) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json',
      )
      .run(run.id, run.createdAt, JSON.stringify(run));
  }

  /** The most recent `limit` runs, oldest first. */
  loadRuns(limit = 100): LoadResult<Run> {
    const r = this.load(
      `SELECT json FROM (SELECT json, created_at FROM runs ORDER BY created_at DESC LIMIT ${Math.trunc(limit)}) ORDER BY created_at`,
      Run,
    );
    return r;
  }

  // ---- settings (no secrets) ----

  loadSettings(): unknown {
    const row = this.db.prepare("SELECT json FROM settings WHERE key = 'app'").get() as
      | { json: string }
      | undefined;
    if (!row) return undefined;
    try {
      return JSON.parse(row.json);
    } catch {
      return undefined; // unreadable: fall back to defaults rather than refuse to start
    }
  }

  saveSettings(settings: unknown): void {
    this.db
      .prepare(
        "INSERT INTO settings (key, json) VALUES ('app', ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json",
      )
      .run(JSON.stringify(settings));
  }

  /** Other named, non-secret configuration blobs (for example the AI provider choice). */
  loadConfig(key: string): unknown {
    const row = this.db.prepare('SELECT json FROM settings WHERE key = ?').get(key) as
      | { json: string }
      | undefined;
    if (!row) return undefined;
    try {
      return JSON.parse(row.json);
    } catch {
      return undefined;
    }
  }

  saveConfig(key: string, value: unknown): void {
    this.db
      .prepare(
        'INSERT INTO settings (key, json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json',
      )
      .run(key, JSON.stringify(value));
  }

  // ---- scenario records: one pending draft and one approved (runnable) record per test case ----

  loadScenarioRecords(slot: 'draft' | 'approved'): unknown[] {
    const table = slot === 'draft' ? 'scenario_drafts' : 'scenario_approved';
    const out: unknown[] = [];
    for (const row of this.db.prepare(`SELECT json FROM ${table} ORDER BY rowid`).all() as {
      json: string;
    }[]) {
      try {
        out.push(JSON.parse(row.json));
      } catch {
        /* an unreadable row is skipped; it stays in the database untouched */
      }
    }
    return out;
  }

  saveScenarioRecord(slot: 'draft' | 'approved', caseId: string, record: unknown): void {
    const table = slot === 'draft' ? 'scenario_drafts' : 'scenario_approved';
    this.db
      .prepare(
        `INSERT INTO ${table} (case_id, json) VALUES (?, ?) ON CONFLICT(case_id) DO UPDATE SET json = excluded.json`,
      )
      .run(caseId, JSON.stringify(record));
  }

  deleteScenarioRecord(slot: 'draft' | 'approved', caseId: string): boolean {
    const table = slot === 'draft' ? 'scenario_drafts' : 'scenario_approved';
    return (
      Number(this.db.prepare(`DELETE FROM ${table} WHERE case_id = ?`).run(caseId).changes) > 0
    );
  }

  // ---- earlier approved versions of a scenario, so a change can be reviewed and undone ----

  saveScenarioRevision(caseId: string, version: number, record: unknown): void {
    this.db
      .prepare(
        'INSERT INTO scenario_history (case_id, version, json) VALUES (?, ?, ?) ON CONFLICT(case_id, version) DO UPDATE SET json = excluded.json',
      )
      .run(caseId, version, JSON.stringify(record));
  }

  /** Earlier versions of one scenario, newest first. Unreadable rows are skipped. */
  loadScenarioRevisions(caseId: string): unknown[] {
    const rows = this.db
      .prepare('SELECT json FROM scenario_history WHERE case_id = ? ORDER BY version DESC')
      .all(caseId) as { json: string }[];
    return rows.flatMap((r) => {
      try {
        return [JSON.parse(r.json) as unknown];
      } catch {
        return [];
      }
    });
  }

  /** Remove every scenario record, draft and earlier version. Returns how many cases had one. */
  deleteAllScenarioRecords(): number {
    const cases = this.db
      .prepare(
        'SELECT COUNT(*) AS n FROM (SELECT case_id FROM scenario_drafts UNION SELECT case_id FROM scenario_approved)',
      )
      .get() as { n: number };
    this.db.exec(
      'DELETE FROM scenario_drafts; DELETE FROM scenario_approved; DELETE FROM scenario_history;',
    );
    return Number(cases.n);
  }

  // ---- saved browser sessions per test account (ciphertext only: they hold sign-in tokens) ----

  loadSession(accountId: string): { stateEnc: string; savedAt: string } | undefined {
    const row = this.db
      .prepare('SELECT state_enc, saved_at FROM account_sessions WHERE account_id = ?')
      .get(accountId) as { state_enc: string; saved_at: string } | undefined;
    return row && { stateEnc: row.state_enc, savedAt: row.saved_at };
  }

  saveSession(accountId: string, stateEnc: string, savedAt = new Date().toISOString()): void {
    this.db
      .prepare(
        `INSERT INTO account_sessions (account_id, state_enc, saved_at) VALUES (?, ?, ?)
         ON CONFLICT(account_id) DO UPDATE SET state_enc = excluded.state_enc, saved_at = excluded.saved_at`,
      )
      .run(accountId, stateEnc, savedAt);
  }

  deleteSession(accountId: string): boolean {
    return (
      Number(
        this.db.prepare('DELETE FROM account_sessions WHERE account_id = ?').run(accountId).changes,
      ) > 0
    );
  }

  // ---- AI provider keys (ciphertext only) ----

  loadAiKey(provider: string): string | undefined {
    const row = this.db.prepare('SELECT key_enc FROM ai_keys WHERE provider = ?').get(provider) as
      | { key_enc: string }
      | undefined;
    return row?.key_enc;
  }

  saveAiKey(provider: string, keyEnc: string, updatedAt = new Date().toISOString()): void {
    this.db
      .prepare(
        `INSERT INTO ai_keys (provider, key_enc, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(provider) DO UPDATE SET key_enc = excluded.key_enc, updated_at = excluded.updated_at`,
      )
      .run(provider, keyEnc, updatedAt);
  }

  deleteAiKey(provider: string): boolean {
    return (
      Number(this.db.prepare('DELETE FROM ai_keys WHERE provider = ?').run(provider).changes) > 0
    );
  }

  // ---- snapshots taken before clearing data ----

  saveBackup(id: string, createdAt: string, reason: string, snapshot: unknown): void {
    this.db
      .prepare(
        'INSERT INTO backups (id, created_at, reason, json) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json',
      )
      .run(id, createdAt, reason, JSON.stringify(snapshot));
  }

  loadBackup(id: string): unknown {
    const row = this.db.prepare('SELECT json FROM backups WHERE id = ?').get(id) as
      | { json: string }
      | undefined;
    return row && (JSON.parse(row.json) as unknown);
  }

  /** Every snapshot's ID and time, newest first. */
  listBackups(): { id: string; createdAt: string }[] {
    return this.db
      .prepare('SELECT id, created_at AS createdAt FROM backups ORDER BY created_at DESC')
      .all() as unknown as { id: string; createdAt: string }[];
  }

  deleteBackup(id: string): boolean {
    return Number(this.db.prepare('DELETE FROM backups WHERE id = ?').run(id).changes) > 0;
  }

  /** The open database, for modules that keep their own tables in it (the knowledge index). */
  get sql(): DatabaseSync {
    return this.db;
  }

  // ---- accounts ----

  private static account(r: Record<string, string>): AccountRow {
    return {
      id: r['id']!,
      projectId: Number(r['project_id']),
      label: r['label']!,
      username: r['username']!,
      passwordEnc: r['password_enc']!,
      createdAt: r['created_at']!,
      updatedAt: r['updated_at']!,
    };
  }

  listAccounts(): AccountRow[] {
    return (
      this.db.prepare('SELECT * FROM accounts ORDER BY created_at, rowid').all() as Record<
        string,
        string
      >[]
    ).map(SqliteStorage.account);
  }

  getAccount(id: string): AccountRow | undefined {
    const r = this.db.prepare('SELECT * FROM accounts WHERE id = ?').get(id) as
      | Record<string, string>
      | undefined;
    return r && SqliteStorage.account(r);
  }

  saveAccount(a: AccountRow): void {
    this.db
      .prepare(
        `INSERT INTO accounts (id, project_id, label, username, password_enc, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET project_id = excluded.project_id, label = excluded.label, username = excluded.username,
           password_enc = excluded.password_enc, updated_at = excluded.updated_at`,
      )
      .run(a.id, a.projectId, a.label, a.username, a.passwordEnc, a.createdAt, a.updatedAt);
  }

  deleteAccount(id: string): boolean {
    return Number(this.db.prepare('DELETE FROM accounts WHERE id = ?').run(id).changes) > 0;
  }

  // ---- audit trail of configuration changes (never contains secrets) ----

  addAudit(action: string, target: string, detail: string): void {
    this.db
      .prepare('INSERT INTO audit (at, action, target, detail) VALUES (?, ?, ?, ?)')
      .run(new Date().toISOString(), action, target, detail);
  }

  listAudit(limit = 100): AuditRow[] {
    return this.db
      .prepare('SELECT id, at, action, target, detail FROM audit ORDER BY id DESC LIMIT ?')
      .all(Math.max(1, Math.min(500, Math.trunc(limit)))) as unknown as AuditRow[];
  }

  close(): void {
    this.db.close();
  }

  private load<T>(
    sql: string,
    schema: { safeParse(v: unknown): { success: true; data: T } | { success: false } },
  ): LoadResult<T> {
    const items: T[] = [];
    let skipped = 0;
    for (const row of this.db.prepare(sql).all() as { json: string }[]) {
      try {
        const parsed = schema.safeParse(JSON.parse(row.json));
        if (parsed.success) items.push(parsed.data);
        else skipped++;
      } catch {
        skipped++;
      }
    }
    return { items, skipped };
  }
}
