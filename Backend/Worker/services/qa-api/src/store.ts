import type { TestCase } from '@qa-studio/shared';
import type { MappingOverride, WorkbookResult } from '@qa-studio/test-case-import';

export interface ImportSession {
  id: string;
  fileName: string;
  bytes: Uint8Array;
  overrides: Record<string, MappingOverride>;
  result: WorkbookResult;
  createdAt: string;
}

/** Where committed test cases are written through to. */
export interface CasePersistence {
  saveCase(tc: TestCase): void;
  deleteCase(id: string): boolean;
  deleteAllCases(): number;
}

const MAX_SESSIONS = 20;

/** A Map that writes every `set` through to persistence. Reads stay in memory. */
class PersistedCases extends Map<string, TestCase> {
  constructor(private readonly persistence: CasePersistence) {
    super();
  }
  override set(key: string, value: TestCase): this {
    this.persistence.saveCase(value);
    return super.set(key, value);
  }
  override delete(key: string): boolean {
    this.persistence.deleteCase(key);
    return super.delete(key);
  }
  /** Clearing must clear storage too, or the cases would come back at the next start. */
  override clear(): void {
    this.persistence.deleteAllCases();
    super.clear();
  }
  /** Fill from storage at startup without writing back. */
  hydrate(cases: TestCase[]): void {
    for (const c of cases) super.set(c.id, c);
  }
  /** Forget cases that are already gone from storage, without writing back. */
  forget(ids: string[]): void {
    for (const id of ids) super.delete(id);
  }
  /** Take storage's list as the whole truth, without writing back. */
  replaceAll(cases: TestCase[]): void {
    super.clear();
    this.hydrate(cases);
  }
}

/**
 * Import sessions are in memory and bounded (oldest evicted); they hold uploaded bytes and are cheap to redo.
 * The inventory is written through to persistence when one is supplied.
 */
export class MemoryStore {
  readonly sessions = new Map<string, ImportSession>();
  readonly inventory: Map<string, TestCase>;
  private readonly persisted: PersistedCases | undefined;

  constructor(persistence?: CasePersistence & { loadCases(): { items: TestCase[] } }) {
    if (persistence) {
      const cases = new PersistedCases(persistence);
      cases.hydrate(persistence.loadCases().items);
      this.inventory = cases;
      this.persisted = cases;
    } else {
      this.inventory = new Map();
      this.persisted = undefined;
    }
  }

  /** Cases changed in the database by someone else. They are already saved, so they are not written back. */
  applyRemote(upserted: TestCase[], deleted: string[]): void {
    if (this.persisted) {
      this.persisted.hydrate(upserted);
      this.persisted.forget(deleted);
      return;
    }
    for (const c of upserted) this.inventory.set(c.id, c);
    for (const id of deleted) this.inventory.delete(id);
  }

  /** Replace the whole inventory with the database's list. */
  replaceFromRemote(cases: TestCase[]): void {
    if (this.persisted) {
      this.persisted.replaceAll(cases);
      return;
    }
    this.inventory.clear();
    for (const c of cases) this.inventory.set(c.id, c);
  }

  addSession(s: ImportSession): void {
    this.sessions.set(s.id, s);
    while (this.sessions.size > MAX_SESSIONS) {
      const oldest = this.sessions.keys().next().value;
      if (oldest === undefined) break;
      this.sessions.delete(oldest);
    }
  }
}
