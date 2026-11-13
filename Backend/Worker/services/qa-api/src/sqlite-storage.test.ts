import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Run, TestCase } from '@qa-studio/shared';
import { DatabaseSync } from './node-sqlite.js';
import { SCHEMA_VERSION, SqliteStorage } from './sqlite-storage.js';
import { MemoryStore } from './store.js';

const tc = (id: string): TestCase => ({
  schemaVersion: 1,
  id,
  title: `Title ${id}`,
  steps: [{ order: 1, action: 'do' }],
  tags: ['a'],
  dependsOn: [],
  readiness: 'needs-clarification',
  source: { workbook: 'plan.xlsx', worksheet: 'S', rowNumber: 2 },
});
const run = (id: string, createdAt: string): Run => ({
  id,
  status: 'passed',
  createdAt,
  environment: 'qa',
  browser: 'chromium',
  workers: 1,
  cases: [{ caseId: 'TC-1', status: 'passed', steps: [], artifacts: [] }],
});

const dirs: string[] = [];
const tmpDb = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-'));
  dirs.push(dir);
  return path.join(dir, 'nested', 'test.db'); // nested: the directory is created on demand
};
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe('SqliteStorage', () => {
  it('round-trips cases and returns runs oldest first, limited to the most recent', () => {
    const s = new SqliteStorage(':memory:');
    s.saveCase(tc('B'));
    s.saveCase(tc('A'));
    s.saveCase({ ...tc('B'), title: 'Updated' }); // upsert
    expect(s.loadCases().items.map((c) => [c.id, c.title])).toEqual([
      ['B', 'Updated'],
      ['A', 'Title A'],
    ]);
    for (let i = 1; i <= 5; i++) s.saveRun(run(`r${i}`, `2026-01-0${i}T00:00:00Z`));
    expect(s.loadRuns(3).items.map((r) => r.id)).toEqual(['r3', 'r4', 'r5']);
  });

  it('survives a restart: data written by one instance is read by the next', () => {
    const file = tmpDb();
    const a = new SqliteStorage(file);
    a.saveCase(tc('TC-1'));
    a.saveRun(run('r1', '2026-01-01T00:00:00Z'));
    a.close();
    const b = new SqliteStorage(file);
    expect(b.loadCases().items).toHaveLength(1);
    expect(b.loadRuns().items[0]!.id).toBe('r1');
    b.close();
  });

  it('skips rows that are corrupt or no longer match the schema, and keeps them in the database', () => {
    const file = tmpDb();
    const a = new SqliteStorage(file);
    a.saveCase(tc('GOOD'));
    a.close();
    const raw = new DatabaseSync(file);
    raw.prepare('INSERT INTO test_cases (id, json) VALUES (?, ?)').run('BAD1', '{not json');
    raw.prepare('INSERT INTO test_cases (id, json) VALUES (?, ?)').run('BAD2', '{"id":"BAD2"}');
    raw.close();
    const b = new SqliteStorage(file);
    const loaded = b.loadCases();
    expect(loaded.items.map((c) => c.id)).toEqual(['GOOD']);
    expect(loaded.skipped).toBe(2);
    b.close();
    const check = new DatabaseSync(file);
    expect((check.prepare('SELECT COUNT(*) AS n FROM test_cases').get() as { n: number }).n).toBe(
      3,
    );
    check.close();
  });

  it('refuses a database written by a newer schema version', () => {
    const file = tmpDb();
    new SqliteStorage(file).close();
    const raw = new DatabaseSync(file);
    raw.prepare("UPDATE meta SET value = '99' WHERE key = 'schema_version'").run();
    raw.close();
    expect(() => new SqliteStorage(file)).toThrow(/newer than this build supports/);
  });
});

describe('MemoryStore with persistence', () => {
  it('hydrates the inventory at startup and writes every new case through', () => {
    const file = tmpDb();
    const s1 = new SqliteStorage(file);
    const store1 = new MemoryStore(s1);
    store1.inventory.set('TC-1', tc('TC-1'));
    s1.close();

    const s2 = new SqliteStorage(file);
    const store2 = new MemoryStore(s2);
    expect([...store2.inventory.keys()]).toEqual(['TC-1']);
    store2.inventory.set('TC-2', tc('TC-2'));
    s2.close();

    const s3 = new SqliteStorage(file);
    expect([...new MemoryStore(s3).inventory.keys()]).toEqual(['TC-1', 'TC-2']);
    s3.close();
  });
});

describe('SqliteStorage: settings, accounts and audit', () => {
  it('stores settings and accounts, keeps account order, and enforces unique names ignoring case', () => {
    const s = new SqliteStorage(':memory:');
    expect(s.loadSettings()).toBeUndefined();
    s.saveSettings({ workers: 3 });
    s.saveSettings({ workers: 4 });
    expect(s.loadSettings()).toEqual({ workers: 4 });
    const row = (id: string, label: string) => ({
      id,
      projectId: 1,
      label,
      username: 'u',
      passwordEnc: 'v1:x:y:z',
      createdAt: `2026-01-0${id}T00:00:00Z`,
      updatedAt: `2026-01-0${id}T00:00:00Z`,
    });
    s.saveAccount(row('1', 'Alpha'));
    s.saveAccount(row('2', 'Beta'));
    s.saveAccount({ ...row('1', 'Alpha'), username: 'changed' });
    expect(s.listAccounts().map((a) => [a.label, a.username])).toEqual([
      ['Alpha', 'changed'],
      ['Beta', 'u'],
    ]);
    expect(() => s.saveAccount(row('3', 'ALPHA'))).toThrow();
    // The same label is fine in another project.
    s.saveAccount({ ...row('3', 'ALPHA'), projectId: 2 });
    expect(s.deleteAccount('3')).toBe(true);
    expect(s.deleteAccount('2')).toBe(true);
    expect(s.deleteAccount('2')).toBe(false);
    expect(s.getAccount('1')?.username).toBe('changed');
    s.close();
  });

  it('keeps the audit trail newest first, bounded, and ignores unreadable stored settings', () => {
    const s = new SqliteStorage(':memory:');
    for (let i = 0; i < 5; i++) s.addAudit('a', `t${i}`, 'd');
    expect(s.listAudit(3).map((r) => r.target)).toEqual(['t4', 't3', 't2']);
    expect(s.listAudit(0)).toHaveLength(1); // the limit is clamped, never unbounded
    s.close();
  });

  it('upgrades a version-1 database in place without losing cases or runs', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'v1-')), 'old.db');
    dirs.push(path.dirname(file));
    const old = new DatabaseSync(file);
    old.exec(`CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE test_cases (id TEXT PRIMARY KEY, json TEXT NOT NULL);
      CREATE TABLE runs (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, json TEXT NOT NULL);
      INSERT INTO meta VALUES ('schema_version', '1');`);
    old.prepare('INSERT INTO test_cases VALUES (?, ?)').run('TC-1', JSON.stringify(tc('TC-1')));
    old.close();
    const upgraded = new SqliteStorage(file);
    expect(upgraded.loadCases().items.map((c) => c.id)).toEqual(['TC-1']);
    upgraded.saveSettings({ ok: true });
    upgraded.close();
    const check = new DatabaseSync(file);
    expect(
      (
        check.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as {
          value: string;
        }
      ).value,
    ).toBe(String(SCHEMA_VERSION));
    check.close();
  });
});
