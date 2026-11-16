import { randomUUID } from 'node:crypto';
import {
  summarizeRun,
  type CaseResult,
  type ExecutionStatus,
  type Failure,
  type Run,
  type RunMode,
  type RunSummary,
  type Scenario,
  type SourceRef,
  type StepResult,
} from '@qa-studio/shared';

/** Which test account a job signs in as. The label is what people see; the id looks up the credentials. */
export interface AccountRef {
  id: string;
  label: string;
}

export interface CaseJob {
  caseId: string;
  /** The project the case is filed under: its address and sign-in are the ones this job uses. */
  projectId?: number | undefined;
  /** Account to sign in as. A case selected for several accounts becomes one job per account. */
  account?: AccountRef | undefined;
  /**
   * Which of several browsers the account runs in, when a concurrent run signs one account in more than once at the
   * same time ("same user in several browsers"). Each browser is its own sign-in: different browsers of one account run
   * side by side, but within one browser the account still runs one case at a time. Absent means the only one.
   */
  session?: number | undefined;
  title?: string | undefined;
  module?: string | undefined;
  priority?: string | undefined;
  source?: SourceRef | undefined;
  /** Absent when no approved scenario is mapped to the case. */
  scenario?: Scenario | undefined;
  /**
   * The parameter values the case's steps read as `{{data.name}}`: its own over its project's common ones, taken from the API
   * when the run starts, so nothing here can be out of date.
   */
  data?: Record<string, string> | undefined;
}

export interface CaseOutcome {
  status: ExecutionStatus;
  steps: StepResult[];
  failure?: Failure | undefined;
  artifacts: string[];
}

export interface CaseExecutor {
  execute(
    job: CaseJob,
    ctx: { runId: string; signal: AbortSignal; mode?: RunMode },
  ): Promise<CaseOutcome>;
  /** Called once when a run ends (however it ends), so anything kept open for the run can be released. */
  endRun?(runId: string): Promise<void>;
}

export interface RunOptions {
  environment: string;
  browser: string;
  workers: number;
  /** How cases share browsers and sign-ins. Defaults to `clean`. */
  mode?: RunMode | undefined;
}

export interface RunManagerOptions {
  /** Maximum parallel cases within a run. Runs themselves execute one at a time to protect shared environments. */
  maxWorkers?: number;
  /** Finished runs kept in memory. */
  historyLimit?: number;
  /** Called with a snapshot whenever a run changes, so it can be persisted. */
  onChange?: (run: Run) => void;
  /** Called when `onChange` throws. A persistence failure never fails the run itself. */
  onError?: (error: unknown) => void;
  /** Called when the run history is cleared, so stored runs can be removed too. */
  onClear?: () => void;
}

interface Internal {
  run: Run;
  jobs: CaseJob[];
  abort: AbortController;
  done: Promise<Run>;
  mode: RunMode;
}

const NO_SCENARIO: Failure = {
  kind: 'blocked',
  message:
    'No approved scenario is mapped to this test case. It needs a mapping or a new approved capability.',
};

export class RunManager {
  private readonly runs = new Map<string, Internal>();
  private tail: Promise<unknown> = Promise.resolve();
  private readonly maxWorkers: number;
  private readonly historyLimit: number;
  private readonly onChange: ((run: Run) => void) | undefined;
  private readonly onError: ((error: unknown) => void) | undefined;

  constructor(
    private readonly executor: CaseExecutor,
    opts: RunManagerOptions = {},
  ) {
    this.maxWorkers = opts.maxWorkers ?? 4;
    this.historyLimit = opts.historyLimit ?? 100;
    this.onChange = opts.onChange;
    this.onError = opts.onError;
    this.onClear = opts.onClear;
  }

  private readonly onClear: (() => void) | undefined;

  /** Whether any run is queued or running. */
  hasActiveRun(): boolean {
    return [...this.runs.values()].some(
      (e) => e.run.status === 'queued' || e.run.status === 'running',
    );
  }

  /**
   * Forget all run history, here and in storage. Refuses while a run is queued or running, so nothing is
   * deleted underneath a live run. Returns how many runs were removed.
   */
  clearHistory(): number {
    if (this.hasActiveRun())
      throw new Error('A run is in progress. Cancel it or wait for it to finish first.');
    const count = this.runs.size;
    this.runs.clear();
    this.onClear?.();
    return count;
  }

  private notify(run: Run): void {
    if (!this.onChange) return;
    try {
      this.onChange(structuredClone(run));
    } catch (e) {
      this.onError?.(e);
    }
  }

  /**
   * Load previously persisted runs into history (oldest first). Anything still queued or running was cut off by a
   * restart: it is closed as cancelled, with an explicit reason, and saved again.
   */
  restore(runs: Run[]): void {
    const now = new Date().toISOString();
    for (const run of [...runs].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
      if (run.status === 'queued' || run.status === 'running') {
        for (const c of run.cases) {
          if (c.status === 'queued' || c.status === 'running') {
            c.status = 'cancelled';
            c.failure = { kind: 'cancelled', message: 'Interrupted by a server restart.' };
          }
        }
        run.status = 'cancelled';
        run.endedAt = now;
        this.notify(run);
      }
      this.runs.set(run.id, {
        run,
        jobs: [],
        abort: new AbortController(),
        done: Promise.resolve(run),
        mode: 'clean',
      });
    }
    this.trim();
  }

  /** Queue a run and return its initial snapshot. Execution continues in the background. */
  start(jobs: CaseJob[], opts: RunOptions): Run {
    const run: Run = {
      id: randomUUID(),
      status: 'queued',
      createdAt: new Date().toISOString(),
      environment: opts.environment,
      browser: opts.browser,
      workers: Math.max(1, Math.min(opts.workers, this.maxWorkers)),
      cases: jobs.map((j) => ({
        caseId: j.caseId,
        ...(j.title !== undefined && { title: j.title }),
        ...(j.account !== undefined && { account: j.account.label }),
        ...(j.module !== undefined && { module: j.module }),
        ...(j.priority !== undefined && { priority: j.priority }),
        ...(j.source !== undefined && { source: j.source }),
        status: 'queued' as const,
        steps: [],
        artifacts: [],
      })),
    };
    const abort = new AbortController();
    const entry: Internal = {
      run,
      jobs,
      abort,
      done: Promise.resolve(run),
      mode: opts.mode ?? 'clean',
    };
    const p = this.tail.then(() => this.execute(entry));
    this.tail = p.catch(() => undefined);
    entry.done = p;
    this.runs.set(run.id, entry);
    this.trim();
    this.notify(run);
    return structuredClone(run);
  }

  get(id: string): Run | undefined {
    const e = this.runs.get(id);
    return e && structuredClone(e.run);
  }

  list(): (Run & { summary: RunSummary })[] {
    return [...this.runs.values()]
      .map((e) => ({ ...structuredClone(e.run), summary: summarizeRun(e.run) }))
      .reverse();
  }

  /** Request cancellation. Queued cases are cancelled; running cases receive the abort signal. */
  cancel(id: string): boolean {
    const e = this.runs.get(id);
    if (!e || ['passed', 'failed', 'cancelled'].includes(e.run.status)) return false;
    e.abort.abort();
    return true;
  }

  whenDone(id: string): Promise<Run> | undefined {
    const e = this.runs.get(id);
    return e && e.done.then(() => structuredClone(e.run));
  }

  private trim(): void {
    const finished = [...this.runs.entries()].filter(([, e]) =>
      ['passed', 'failed', 'cancelled'].includes(e.run.status),
    );
    for (const [id] of finished.slice(0, Math.max(0, finished.length - this.historyLimit)))
      this.runs.delete(id);
  }

  private async execute(e: Internal): Promise<Run> {
    const { run, jobs, abort, mode } = e;
    const cancelRemaining = () => {
      for (const c of run.cases) if (c.status === 'queued') c.status = 'cancelled';
    };
    if (abort.signal.aborted) {
      cancelRemaining();
      run.status = 'cancelled';
      run.endedAt = new Date().toISOString();
      this.notify(run);
      return run;
    }
    run.status = 'running';
    run.startedAt = new Date().toISOString();
    this.notify(run);

    // Jobs wait in a queue. A job is picked only when its account is not already signed in elsewhere in this
    // run, so one account never has two browsers open at once (SSO limits and lock-outs make that risky). The one
    // exception is asked for explicitly: a concurrent run of the same user in several browsers gives each browser its
    // own `session`, and only the same account in the same session waits.
    const pending = jobs.map((job, i) => ({ job, result: run.cases[i]! }));
    const busy = new Set<string>();
    const busyKey = (job: CaseJob) => job.account && `${job.account.id}#${job.session ?? 1}`;
    let waiters: (() => void)[] = [];
    const wakeAll = () => {
      const w = waiters;
      waiters = [];
      for (const resolve of w) resolve();
    };
    abort.signal.addEventListener('abort', wakeAll, { once: true });

    const worker = async () => {
      for (;;) {
        if (abort.signal.aborted) return;
        const at = pending.findIndex((p) => {
          const key = busyKey(p.job);
          return !key || !busy.has(key);
        });
        if (at === -1) {
          if (pending.length === 0) return;
          await new Promise<void>((resolve) => waiters.push(resolve)); // every remaining job's account is busy
          continue;
        }
        const [next] = pending.splice(at, 1);
        const accountId = busyKey(next!.job);
        if (accountId) busy.add(accountId);
        try {
          await this.runCase(run.id, mode, next!.job, next!.result, abort.signal);
          this.notify(run);
        } finally {
          if (accountId) busy.delete(accountId);
          wakeAll();
        }
      }
    };
    try {
      await Promise.all(Array.from({ length: Math.min(run.workers, jobs.length) }, worker));
    } finally {
      // Browsers kept open for the run are closed even if a worker threw. A failure here never changes the result.
      await this.executor.endRun?.(run.id).catch((err: unknown) => this.onError?.(err));
    }

    cancelRemaining();
    const { counts } = summarizeRun(run);
    run.status = abort.signal.aborted
      ? 'cancelled'
      : counts.failed > 0 || counts.blocked > 0
        ? 'failed' // incomplete coverage is surfaced, not hidden; pass rate is reported separately
        : 'passed';
    run.endedAt = new Date().toISOString();
    this.notify(run);
    this.trim();
    return run;
  }

  private async runCase(
    runId: string,
    mode: RunMode,
    job: CaseJob,
    result: CaseResult,
    signal: AbortSignal,
  ): Promise<void> {
    const started = Date.now();
    result.status = 'running';
    result.startedAt = new Date(started).toISOString();
    try {
      if (!job.scenario) {
        Object.assign(result, { status: 'blocked', failure: NO_SCENARIO });
      } else {
        const o = await this.executor.execute(job, { runId, signal, mode });
        Object.assign(result, {
          status: o.status,
          steps: o.steps,
          artifacts: o.artifacts,
          ...(o.failure && { failure: o.failure }),
        });
      }
    } catch (err) {
      // The executor itself broke (infrastructure), distinct from an application assertion.
      result.status = 'failed';
      result.failure = {
        kind: 'automation-error',
        message: err instanceof Error ? err.message : String(err),
      };
    }
    result.endedAt = new Date().toISOString();
    result.durationMs = Date.now() - started;
  }
}
