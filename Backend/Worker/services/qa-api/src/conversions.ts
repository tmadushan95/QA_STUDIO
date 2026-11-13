/**
 * Converts imported test cases into runnable steps, as a background job with live progress.
 *
 * Each case's written steps go through the rule-based converter. The result is saved as a draft for a person to
 * check and approve (nothing converted here runs by itself). Cases the rules cannot fully convert are marked
 * "needs review", so they can be finished in the editor or handed to the AI drafting job.
 */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { convertTestCase, type PageSpec } from '@qa-studio/automation-core';
import type { TestCase } from '@qa-studio/shared';
import { HttpError } from './errors.js';
import type { EventBus } from './events.js';
import type { ScenarioService } from './scenario-service.js';

export type ConversionItemStatus = 'pending' | 'ready' | 'needs-review' | 'failed' | 'skipped';

export interface ConversionItem {
  caseId: string;
  title: string;
  status: ConversionItemStatus;
  /** Number of steps produced. */
  steps: number;
  /** One line for the person: what is left to do, or why it failed or was skipped. */
  message?: string;
}

export interface ConversionJob {
  id: string;
  status: 'running' | 'done' | 'cancelled';
  startedAt: string;
  endedAt?: string;
  total: number;
  counts: Record<ConversionItemStatus, number>;
  items: ConversionItem[];
}

export interface ConversionDeps {
  inventory: Map<string, TestCase>;
  scenarios: ScenarioService;
  /** Pages known in Settings, so "Go to the X page" can become a go-to-page step. */
  pages(): Record<string, PageSpec>;
  events: EventBus;
  audit(action: string, target: string, detail: string): void;
}

export const MAX_CONVERT = 2000;
const KEEP_JOBS = 10;
const Start = z.object({ caseIds: z.array(z.string().min(1)).min(1).max(MAX_CONVERT) });

const empty = (): Record<ConversionItemStatus, number> => ({
  pending: 0,
  ready: 0,
  'needs-review': 0,
  failed: 0,
  skipped: 0,
});

export class ConversionService {
  private readonly jobs: ConversionJob[] = [];
  private readonly cancelled = new Set<string>();

  constructor(private readonly d: ConversionDeps) {}

  list(): ConversionJob[] {
    return this.jobs.map((j) => structuredClone(j));
  }

  get(id: string): ConversionJob {
    const j = this.jobs.find((x) => x.id === id);
    if (!j) throw new HttpError(404, 'unknown-job', 'There is no such conversion.');
    return structuredClone(j);
  }

  /** Start converting. Returns at once; progress arrives as live `job` events and through `get`. */
  start(body: unknown): ConversionJob {
    const p = Start.safeParse(body);
    if (!p.success) {
      throw new HttpError(
        400,
        'invalid-request',
        `Send between 1 and ${MAX_CONVERT} test case IDs.`,
      );
    }
    const ids = [...new Set(p.data.caseIds)];
    const job: ConversionJob = {
      id: randomUUID(),
      status: 'running',
      startedAt: new Date().toISOString(),
      total: ids.length,
      counts: { ...empty(), pending: ids.length },
      items: ids.map((caseId) => ({
        caseId,
        title: this.d.inventory.get(caseId)?.title ?? caseId,
        status: 'pending',
        steps: 0,
      })),
    };
    this.jobs.unshift(job);
    this.jobs.splice(KEEP_JOBS);
    void this.run(job);
    return structuredClone(job);
  }

  cancel(id: string): ConversionJob {
    const job = this.jobs.find((x) => x.id === id);
    if (!job) throw new HttpError(404, 'unknown-job', 'There is no such conversion.');
    if (job.status === 'running') this.cancelled.add(id);
    return structuredClone(job);
  }

  private publish(job: ConversionJob): void {
    this.d.events.emit({ type: 'job', id: job.id, status: job.status });
  }

  private async run(job: ConversionJob): Promise<void> {
    const pages = this.d.pages();
    for (const item of job.items) {
      if (this.cancelled.has(job.id)) break;
      Object.assign(item, this.convertOne(item.caseId, pages));
      job.counts.pending--;
      job.counts[item.status]++;
      this.publish(job);
      // Let other requests (and progress polls) through between cases.
      await new Promise((r) => setImmediate(r));
    }
    job.status = this.cancelled.delete(job.id) ? 'cancelled' : 'done';
    job.endedAt = new Date().toISOString();
    this.publish(job);
    const c = job.counts;
    this.d.audit(
      'conversion.done',
      job.id,
      `${c.ready} ready, ${c['needs-review']} need review, ${c.failed} failed, ${c.skipped} skipped.`,
    );
  }

  private convertOne(
    caseId: string,
    pages: Record<string, PageSpec>,
  ): Pick<ConversionItem, 'status' | 'steps' | 'message'> {
    const tc = this.d.inventory.get(caseId);
    if (!tc) return { status: 'failed', steps: 0, message: 'This test case no longer exists.' };
    const current = this.d.scenarios.get(caseId);
    // Never overwrite automation someone already made or approved.
    if (current.approved || current.draft) {
      return { status: 'skipped', steps: 0, message: 'Already has steps. Open it to change them.' };
    }
    try {
      const r = convertTestCase(tc, pages);
      if (r.steps.length === 0) {
        return {
          status: 'needs-review',
          steps: 0,
          message: r.unmatched.length
            ? `No sentence could be converted, starting with “${r.unmatched[0]}”.`
            : 'The test case has no written steps.',
        };
      }
      const draft = this.d.scenarios.saveDraft(caseId, {
        steps: r.steps,
        origin: 'rules',
        note:
          r.unmatched.length > 0
            ? `Converted from the written steps. Not converted: ${r.unmatched.join(' | ')}`
            : 'Converted from the written steps.',
      });
      if (draft.status === 'validated' && r.unmatched.length === 0) {
        return { status: 'ready', steps: r.steps.length };
      }
      return {
        status: 'needs-review',
        steps: r.steps.length,
        message:
          r.unmatched.length > 0
            ? `${r.unmatched.length} sentence${r.unmatched.length === 1 ? '' : 's'} still to convert.`
            : (draft.issues[0] ?? 'Check the steps.'),
      };
    } catch (e) {
      return { status: 'failed', steps: 0, message: e instanceof Error ? e.message : String(e) };
    }
  }
}
