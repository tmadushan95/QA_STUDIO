/**
 * Snapshots taken before data is cleared, so "Clear all data" can be undone.
 *
 * A snapshot holds the test cases, the approved scenarios and the test case parameters as they were. Snapshots are kept in the
 * database and removed after `KEEP_DAYS`, so an accidental clear can be reversed for a week.
 */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Scenario, TestCase } from '@qa-studio/shared';
import { HttpError } from './errors.js';

/** How long a snapshot is kept. */
export const KEEP_DAYS = 7;

const Snapshot = z.object({
  id: z.string(),
  createdAt: z.string(),
  reason: z.string(),
  cases: z.array(TestCase),
  scenarios: z.array(Scenario),
  /** Per-case parameters. Absent in snapshots taken before parameters replaced shared test data. */
  parameters: z.record(z.string(), z.record(z.string(), z.string())).default({}),
});
type Snapshot = z.infer<typeof Snapshot>;

/** What the list shows: when, why and how much, never the content. */
export interface BackupSummary {
  id: string;
  createdAt: string;
  reason: string;
  cases: number;
  scenarios: number;
  /** How many test cases had parameters. */
  parameterSets: number;
}

/** Where snapshots live. Implemented by the storage layer. */
export interface BackupStore {
  saveBackup(id: string, createdAt: string, reason: string, snapshot: unknown): void;
  loadBackup(id: string): unknown;
  listBackups(): { id: string; createdAt: string }[];
  deleteBackup(id: string): boolean;
  /** Tells storage a restore finished, so it can put back what the snapshot itself does not hold. */
  backupRestored?(id: string): void;
}

/** The parts of the system a snapshot reads from and restores into. */
export interface BackupDeps {
  store: BackupStore;
  cases: { list(): TestCase[]; restore(cases: TestCase[]): void };
  scenarios: { approvedScenarios(): Scenario[]; restoreScenarios(list: Scenario[]): number };
  /** The parameter values, which the API stores. A snapshot keeps the same shape it always had, so old ones still restore. */
  parameters: {
    exportAll(): Promise<Record<string, Record<string, string>>>;
    importAll(raw: Record<string, Record<string, string>>): Promise<void>;
  };
  audit(action: string, target: string, detail: string): void;
  now?: () => Date;
}

export class BackupService {
  constructor(private readonly d: BackupDeps) {}

  private now(): Date {
    return this.d.now?.() ?? new Date();
  }

  /** Save the current data. Returns the snapshot's ID, for an "Undo" button. */
  async take(reason: string): Promise<string> {
    this.prune();
    const snap: Snapshot = {
      id: randomUUID(),
      createdAt: this.now().toISOString(),
      reason,
      cases: this.d.cases.list(),
      scenarios: this.d.scenarios.approvedScenarios(),
      parameters: await this.d.parameters.exportAll(),
    };
    this.d.store.saveBackup(snap.id, snap.createdAt, snap.reason, snap);
    this.d.audit(
      'backup.take',
      snap.id,
      `${reason}: ${snap.cases.length} cases, ${snap.scenarios.length} scenarios.`,
    );
    return snap.id;
  }

  private read(id: string): Snapshot {
    const raw = this.d.store.loadBackup(id);
    if (raw === undefined) {
      throw new HttpError(404, 'unknown-backup', 'There is no such backup. It may have expired.');
    }
    const p = Snapshot.safeParse(raw);
    if (!p.success) throw new HttpError(422, 'unreadable-backup', 'This backup cannot be read.');
    return p.data;
  }

  /** Snapshots still kept, newest first. */
  list(): BackupSummary[] {
    this.prune();
    return this.d.store
      .listBackups()
      .flatMap((b) => {
        try {
          const s = this.read(b.id);
          return [
            {
              id: s.id,
              createdAt: s.createdAt,
              reason: s.reason,
              cases: s.cases.length,
              scenarios: s.scenarios.length,
              parameterSets: Object.keys(s.parameters).length,
            },
          ];
        } catch {
          return [];
        }
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /** Put a snapshot's data back. Restored items are added to whatever exists now; nothing is deleted. */
  async restore(id: string): Promise<BackupSummary> {
    const s = this.read(id);
    this.d.cases.restore(s.cases);
    this.d.scenarios.restoreScenarios(s.scenarios);
    await this.d.parameters.importAll(s.parameters);
    this.d.store.backupRestored?.(id);
    this.d.audit(
      'backup.restore',
      id,
      `Restored ${s.cases.length} cases and ${s.scenarios.length} scenarios.`,
    );
    return this.list().find((b) => b.id === id)!;
  }

  /** Remove snapshots older than `KEEP_DAYS`. */
  private prune(): void {
    const cutoff = this.now().getTime() - KEEP_DAYS * 86_400_000;
    for (const b of this.d.store.listBackups()) {
      if (new Date(b.createdAt).getTime() < cutoff) this.d.store.deleteBackup(b.id);
    }
  }
}
