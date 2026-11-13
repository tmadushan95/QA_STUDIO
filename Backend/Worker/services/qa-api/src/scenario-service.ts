import { z } from 'zod';
import { resolveData, type ActionRegistry } from '@qa-studio/automation-core';
import { Scenario } from '@qa-studio/shared';
import { HttpError } from './errors.js';

/**
 * Where a scenario is in its life. Only `approved` scenarios can run. AI writes a `draft`; the validator turns it
 * into `validated` when every step is a registered action with valid parameters; a person approves it. A person
 * saving valid steps in the editor approves them in the same action, since they are the reviewer.
 *
 * The database is the only copy. The version an approval replaces is kept in the history, so any change can be
 * reviewed and undone.
 */
export type ScenarioStatus = 'draft' | 'validated' | 'approved';

const ScenarioRecord = z.object({
  caseId: z.string().min(1),
  scenario: Scenario,
  status: z.enum(['draft', 'validated', 'approved']),
  /** Who wrote it: a person in the app, AI, the rule-based converter, or (older records) a JSON file. */
  origin: z.enum(['manual', 'ai', 'file', 'rules']),
  version: z.number().int().min(1),
  createdAt: z.string(),
  updatedAt: z.string(),
  approvedAt: z.string().optional(),
  /** Why the scenario looks the way it does (for AI drafts: what it was based on). Shown to the reviewer. */
  note: z.string().max(4000).optional(),
  issues: z.array(z.string()).default([]),
  warnings: z.array(z.string()).default([]),
});
export type ScenarioRecord = z.infer<typeof ScenarioRecord>;

export interface ScenarioStore {
  loadScenarioRecords(slot: 'draft' | 'approved'): unknown[];
  saveScenarioRecord(slot: 'draft' | 'approved', caseId: string, record: unknown): void;
  deleteScenarioRecord(slot: 'draft' | 'approved', caseId: string): boolean;
  saveScenarioRevision(caseId: string, version: number, record: unknown): void;
  loadScenarioRevisions(caseId: string): unknown[];
  deleteAllScenarioRecords(): number;
}

export interface ScenarioRow {
  caseId: string;
  /** What the case shows: the approved scenario if there is one, otherwise the pending draft, otherwise none. */
  state: ScenarioStatus | 'none';
  /** Where the runnable scenario comes from. */
  source?: 'file' | 'app';
  version?: number;
  steps?: number;
  /** A newer draft is waiting next to the approved scenario. */
  hasDraft: boolean;
}

export interface ScenarioDeps {
  store: ScenarioStore;
  registry: ActionRegistry;
  /** The map the run engine reads. This service keeps it in step with what is approved. */
  live: Map<string, Scenario>;
  caseIds(): Set<string>;
  audit(action: string, target: string, detail: string): void;
}

const MAX_STEPS = 200;

export class ScenarioService {
  private readonly drafts = new Map<string, ScenarioRecord>();
  private readonly approved = new Map<string, ScenarioRecord>();

  constructor(private readonly d: ScenarioDeps) {
    for (const [slot, into] of [
      ['draft', this.drafts],
      ['approved', this.approved],
    ] as const) {
      for (const raw of d.store.loadScenarioRecords(slot)) {
        const p = ScenarioRecord.safeParse(raw);
        if (p.success) into.set(p.data.caseId, p.data);
      }
    }
    for (const r of this.approved.values()) d.live.set(r.caseId, r.scenario);
  }

  /** The newest version number used for a case, approved or draft, so a new version is always higher. */
  private latestVersion(caseId: string): number {
    return Math.max(this.drafts.get(caseId)?.version ?? 0, this.approved.get(caseId)?.version ?? 0);
  }

  /** Make a scenario the approved one: history first, then the record and the run map. */
  private storeApproved(input: {
    caseId: string;
    scenario: Scenario;
    origin: ScenarioRecord['origin'];
    note?: string;
    warnings: string[];
  }): ScenarioRecord {
    const now = new Date().toISOString();
    const previous = this.approved.get(input.caseId);
    if (previous) this.d.store.saveScenarioRevision(input.caseId, previous.version, previous);
    const record: ScenarioRecord = {
      caseId: input.caseId,
      scenario: input.scenario,
      status: 'approved',
      origin: input.origin,
      version: this.latestVersion(input.caseId) + 1,
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
      approvedAt: now,
      ...(input.note && { note: input.note }),
      issues: [],
      warnings: input.warnings,
    };
    this.approved.set(input.caseId, record);
    this.d.store.saveScenarioRecord('approved', input.caseId, record);
    this.d.live.set(input.caseId, record.scenario);
    return record;
  }

  /** Check a scenario without saving it: every step must be a registered action with valid parameters. */
  validate(scenario: Scenario): { issues: string[]; warnings: string[] } {
    const issues: string[] = [];
    const warnings: string[] = [];
    // Test data is filled in at run time, so a reference only needs to be well formed here.
    const anything = new Proxy({}, { get: () => 'x' }) as Record<string, string>;
    scenario.steps.forEach((s, i) => {
      const n = i + 1;
      const filled = resolveData(s.params, anything);
      const v = this.d.registry.validate(s.action, filled.ok ? filled.value : s.params);
      if (!v.ok) issues.push(`Step ${n} (${s.action}): ${v.reason}`);
      else if (this.d.registry.isDestructive(s.action, s.params)) {
        warnings.push(
          `Step ${n} (${s.action}) deletes data, so it only runs when deleting is allowed.`,
        );
      }
    });
    return { issues, warnings };
  }

  list(): ScenarioRow[] {
    const ids = new Set([...this.d.caseIds(), ...this.approved.keys(), ...this.drafts.keys()]);
    return [...ids].map((caseId) => {
      const app = this.approved.get(caseId);
      const draft = this.drafts.get(caseId);
      if (app) {
        return {
          caseId,
          state: 'approved' as const,
          source: app.origin === 'file' ? ('file' as const) : ('app' as const),
          version: app.version,
          steps: app.scenario.steps.length,
          hasDraft: draft !== undefined,
        };
      }
      return draft
        ? {
            caseId,
            state: draft.status,
            version: draft.version,
            steps: draft.scenario.steps.length,
            hasDraft: true,
          }
        : { caseId, state: 'none' as const, hasDraft: false };
    });
  }

  get(caseId: string): {
    approved?: ScenarioRecord;
    draft?: ScenarioRecord;
  } {
    const approved = this.approved.get(caseId);
    const draft = this.drafts.get(caseId);
    return { ...(approved && { approved }), ...(draft && { draft }) };
  }

  /** Check the request shape and build the scenario. Throws an HttpError naming what is wrong. */
  private parseInput(caseId: string, input: { steps?: unknown; description?: unknown }): Scenario {
    if (!this.d.caseIds().has(caseId)) {
      throw new HttpError(404, 'unknown-case', `There is no test case "${caseId}".`);
    }
    if (!Array.isArray(input.steps) || input.steps.length === 0 || input.steps.length > MAX_STEPS) {
      throw new HttpError(400, 'invalid-scenario', `Send between 1 and ${MAX_STEPS} steps.`, {
        steps: `Send between 1 and ${MAX_STEPS} steps.`,
      });
    }
    const parsed = Scenario.safeParse({
      schemaVersion: 1,
      caseId,
      ...(typeof input.description === 'string' &&
        input.description && { description: input.description.slice(0, 500) }),
      steps: input.steps,
    });
    if (!parsed.success) {
      throw new HttpError(
        400,
        'invalid-scenario',
        'The steps are not in the expected format.',
        Object.fromEntries(parsed.error.issues.map((i) => [i.path.join('.'), i.message])),
      );
    }
    return parsed.data;
  }

  saveDraft(
    caseId: string,
    input: {
      steps?: unknown;
      description?: unknown;
      origin?: 'manual' | 'ai' | 'rules';
      note?: unknown;
    },
  ): ScenarioRecord {
    const scenario = this.parseInput(caseId, input);
    const { issues, warnings } = this.validate(scenario);
    const now = new Date().toISOString();
    const prior = this.drafts.get(caseId);
    const version = this.latestVersion(caseId) + 1;
    const record: ScenarioRecord = {
      caseId,
      scenario,
      status: issues.length === 0 ? 'validated' : 'draft',
      origin: input.origin ?? 'manual',
      version,
      createdAt: prior?.createdAt ?? now,
      updatedAt: now,
      ...(typeof input.note === 'string' && input.note && { note: input.note.slice(0, 4000) }),
      issues,
      warnings,
    };
    this.drafts.set(caseId, record);
    this.d.store.saveScenarioRecord('draft', caseId, record);
    this.d.audit(
      'scenario.draft',
      caseId,
      `Draft v${version} saved (${record.origin}); ${record.status}.`,
    );
    return record;
  }

  approve(caseId: string): ScenarioRecord {
    const draft = this.drafts.get(caseId);
    if (!draft) throw new HttpError(404, 'no-draft', `There is no draft for ${caseId} to approve.`);
    // Checked again now: the set of actions can change between saving and approving.
    const { issues, warnings } = this.validate(draft.scenario);
    if (issues.length > 0) {
      throw new HttpError(409, 'not-valid', `The draft cannot be approved yet: ${issues[0]}`, {
        steps: issues.join(' | '),
      });
    }
    this.drafts.delete(caseId);
    this.d.store.deleteScenarioRecord('draft', caseId);
    const record = this.storeApproved({
      caseId,
      scenario: draft.scenario,
      origin: draft.origin,
      ...(draft.note && { note: draft.note }),
      warnings,
    });
    this.d.audit('scenario.approve', caseId, `Version ${record.version} approved; it can now run.`);
    return record;
  }

  discardDraft(caseId: string): boolean {
    if (!this.drafts.delete(caseId)) return false;
    this.d.store.deleteScenarioRecord('draft', caseId);
    this.d.audit('scenario.discard', caseId, 'Draft discarded.');
    return true;
  }

  /** Stop a scenario from running: the approved version moves to the history. */
  revoke(caseId: string): boolean {
    const current = this.approved.get(caseId);
    if (!current) return false;
    this.d.store.saveScenarioRevision(caseId, current.version, current);
    this.approved.delete(caseId);
    this.d.store.deleteScenarioRecord('approved', caseId);
    this.d.live.delete(caseId);
    this.d.audit('scenario.revoke', caseId, 'Approval withdrawn; the case is no longer automated.');
    return true;
  }

  /**
   * A person saved steps in the editor. Valid steps become the approved version straight away (the person is the
   * reviewer); steps with problems are kept as a draft that lists them, and the approved version keeps running.
   * `expectedVersion` is the version the editor opened: if someone saved since, nothing is changed and a 409 says so.
   */
  saveEdit(
    caseId: string,
    input: { steps?: unknown; description?: unknown; expectedVersion?: unknown },
  ): ScenarioRecord {
    const scenario = this.parseInput(caseId, input);
    const latest = this.latestVersion(caseId);
    if (typeof input.expectedVersion === 'number' && input.expectedVersion !== latest) {
      throw new HttpError(
        409,
        'changed-since-opened',
        `This test case was changed since you opened it (now version ${latest}). Reload it to see the change.`,
      );
    }
    const { issues, warnings } = this.validate(scenario);
    if (issues.length > 0) {
      return this.saveDraft(caseId, {
        ...input,
        origin: 'manual',
        note: 'Saved with problems to fix.',
      });
    }
    // A newer person-made version makes any waiting draft out of date.
    if (this.drafts.delete(caseId)) this.d.store.deleteScenarioRecord('draft', caseId);
    const record = this.storeApproved({ caseId, scenario, origin: 'manual', warnings });
    this.d.audit('scenario.save', caseId, `Version ${record.version} saved and approved by hand.`);
    return record;
  }

  /** Earlier approved versions of a case, newest first. */
  history(caseId: string): ScenarioRecord[] {
    return this.d.store.loadScenarioRevisions(caseId).flatMap((raw) => {
      const p = ScenarioRecord.safeParse(raw);
      return p.success ? [p.data] : [];
    });
  }

  /** Make an earlier version the approved one again, as a new version (history is never rewritten). */
  restore(caseId: string, version: number): ScenarioRecord {
    const old = this.history(caseId).find((r) => r.version === version);
    if (!old) {
      throw new HttpError(404, 'unknown-version', `There is no version ${version} of ${caseId}.`);
    }
    const record = this.saveEdit(caseId, {
      steps: old.scenario.steps,
      ...(old.scenario.description && { description: old.scenario.description }),
    });
    this.d.audit(
      'scenario.restore',
      caseId,
      `Version ${version} restored as version ${record.version}.`,
    );
    return record;
  }

  /** Every approved scenario, for a backup taken before clearing. */
  approvedScenarios(): Scenario[] {
    return [...this.approved.values()].map((r) => r.scenario);
  }

  /** Bring back scenarios from a backup as approved versions. */
  restoreScenarios(list: Scenario[]): number {
    for (const scenario of list) {
      this.storeApproved({
        caseId: scenario.caseId,
        scenario,
        origin: 'manual',
        note: 'Restored from a backup.',
        warnings: this.validate(scenario).warnings,
      });
    }
    if (list.length)
      this.d.audit('scenario.restore-backup', 'all', `Restored ${list.length} scenarios.`);
    return list.length;
  }

  /**
   * Remove every scenario, draft and earlier version. Used by "clear all data". `files` stays in the answer, always 0,
   * because the API's clear response has it and scripts may read it.
   */
  clearAll(): { scenarios: number; files: number } {
    const scenarios = this.d.store.deleteAllScenarioRecords();
    this.drafts.clear();
    this.approved.clear();
    this.d.live.clear();
    this.d.audit('scenario.clear', 'all', `Removed ${scenarios} scenarios.`);
    return { scenarios, files: 0 };
  }
}
