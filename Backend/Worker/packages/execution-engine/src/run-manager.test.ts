import { describe, expect, it } from 'vitest';
import { summarizeRun, type Run, type Scenario } from '@qa-studio/shared';
import {
  RunManager,
  safeName,
  type CaseExecutor,
  type CaseJob,
  type CaseOutcome,
} from './index.js';

const scenario = (caseId: string): Scenario => ({
  schemaVersion: 1,
  caseId,
  steps: [{ action: 'x', params: {} }],
});
const job = (id: string, withScenario = true): CaseJob => ({
  caseId: id,
  scenario: withScenario ? scenario(id) : undefined,
});
const pass: CaseOutcome = { status: 'passed', steps: [], artifacts: [] };
const opts = { environment: 'qa', browser: 'chromium', workers: 2 };

class Gate {
  resolve!: () => void;
  promise = new Promise<void>((r) => (this.resolve = r));
}

describe('RunManager', () => {
  it('runs cases, blocks unmapped ones, and summarizes with a defined pass rate', async () => {
    const ex: CaseExecutor = {
      execute: async (j) =>
        j.caseId === 'F'
          ? {
              status: 'failed',
              steps: [],
              artifacts: [],
              failure: { kind: 'assertion', message: 'bad' },
            }
          : pass,
    };
    const m = new RunManager(ex);
    const run = m.start([job('A'), job('F'), job('N', false)], opts);
    expect(run.status).toBe('queued');
    const done = await m.whenDone(run.id)!;
    expect(done.cases.map((c) => [c.caseId, c.status])).toEqual([
      ['A', 'passed'],
      ['F', 'failed'],
      ['N', 'blocked'],
    ]);
    expect(done.cases[2]!.failure?.message).toMatch(/No approved scenario/);
    expect(done.status).toBe('failed');
    const s = summarizeRun(done);
    expect(s.counts).toMatchObject({ passed: 1, failed: 1, blocked: 1 });
    expect(s.passRate).toBe(0.5); // blocked cases are not "executed"
    expect(done.startedAt && done.endedAt).toBeTruthy();
  });

  it('never exceeds the configured worker count', async () => {
    let active = 0;
    let peak = 0;
    const ex: CaseExecutor = {
      execute: async () => {
        peak = Math.max(peak, ++active);
        await new Promise((r) => setTimeout(r, 20));
        active--;
        return pass;
      },
    };
    const m = new RunManager(ex, { maxWorkers: 3 });
    const run = m.start(
      Array.from({ length: 8 }, (_, i) => job(`C${i}`)),
      { ...opts, workers: 99 },
    );
    expect(run.workers).toBe(3);
    await m.whenDone(run.id);
    expect(peak).toBe(3);
  });

  it('executes runs one at a time', async () => {
    const order: string[] = [];
    const gate = new Gate();
    const ex: CaseExecutor = {
      execute: async (j) => {
        order.push(`start ${j.caseId}`);
        if (j.caseId === 'A') await gate.promise;
        order.push(`end ${j.caseId}`);
        return pass;
      },
    };
    const m = new RunManager(ex);
    const r1 = m.start([job('A')], opts);
    const r2 = m.start([job('B')], opts);
    await new Promise((r) => setTimeout(r, 30));
    expect(m.get(r2.id)!.status).toBe('queued');
    gate.resolve();
    await m.whenDone(r2.id);
    expect(order).toEqual(['start A', 'end A', 'start B', 'end B']);
    expect(m.get(r1.id)!.status).toBe('passed');
  });

  it('cancels a running run: in-flight case gets the signal, the rest are cancelled', async () => {
    const gate = new Gate();
    let sawAbort = false;
    const ex: CaseExecutor = {
      execute: async (_j, { signal }) => {
        await gate.promise;
        sawAbort = signal.aborted;
        return signal.aborted ? { status: 'cancelled', steps: [], artifacts: [] } : pass;
      },
    };
    const m = new RunManager(ex);
    const run = m.start([job('A'), job('B'), job('C')], { ...opts, workers: 1 });
    await new Promise((r) => setTimeout(r, 20));
    expect(m.cancel(run.id)).toBe(true);
    gate.resolve();
    const done = await m.whenDone(run.id)!;
    expect(sawAbort).toBe(true);
    expect(done.status).toBe('cancelled');
    expect(done.cases.map((c) => c.status)).toEqual(['cancelled', 'cancelled', 'cancelled']);
    expect(m.cancel(run.id)).toBe(false); // already finished
  });

  it('cancels a queued run before it starts', async () => {
    const gate = new Gate();
    const m = new RunManager({ execute: async () => (await gate.promise, pass) });
    m.start([job('A')], opts);
    const queued = m.start([job('B')], opts);
    expect(m.cancel(queued.id)).toBe(true);
    gate.resolve();
    const done = await m.whenDone(queued.id)!;
    expect(done.status).toBe('cancelled');
    expect(done.cases[0]!.status).toBe('cancelled');
  });

  it('records an executor crash as an automation error, not an app failure, and keeps going', async () => {
    const ex: CaseExecutor = {
      execute: async (j) => {
        if (j.caseId === 'X') throw new Error('browser missing');
        return pass;
      },
    };
    const m = new RunManager(ex);
    const done = await m.whenDone(m.start([job('X'), job('Y')], opts).id)!;
    expect(done.cases[0]).toMatchObject({
      status: 'failed',
      failure: { kind: 'automation-error', message: 'browser missing' },
    });
    expect(done.cases[1]!.status).toBe('passed');
  });

  it('keeps bounded history and returns copies', async () => {
    const m = new RunManager({ execute: async () => pass }, { historyLimit: 2 });
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) {
      const r = m.start([job('A')], opts);
      ids.push(r.id);
      await m.whenDone(r.id);
    }
    expect(m.list().map((r) => r.id)).toEqual([ids[3], ids[2]]);
    const copy = m.get(ids[3]!)!;
    copy.status = 'cancelled';
    expect(m.get(ids[3]!)!.status).toBe('passed');
  });
});

describe('safeName', () => {
  it('neutralizes traversal and separators', () => {
    expect(safeName('../../etc/passwd')).toBe('__.._etc_passwd');
    expect(safeName('TC-1')).toBe('TC-1');
    expect(safeName('a\\b:c')).toBe('a_b_c');
    expect(safeName('')).toBe('_');
  });
});

describe('RunManager persistence hooks', () => {
  it('reports every state change, and a failing persister never fails the run', async () => {
    const seen: string[] = [];
    const errors: unknown[] = [];
    let boom = false;
    const m = new RunManager(
      { execute: async () => pass },
      {
        onChange: (r) => {
          seen.push(`${r.status}:${r.cases.map((c) => c.status).join(',')}`);
          if (boom) throw new Error('disk full');
        },
        onError: (e) => errors.push(e),
      },
    );
    const done = await m.whenDone(m.start([job('A'), job('B')], { ...opts, workers: 1 }).id)!;
    expect(seen[0]).toBe('queued:queued,queued');
    expect(seen).toContain('running:queued,queued');
    expect(seen).toContain('running:passed,queued'); // saved after each case
    expect(seen.at(-1)).toBe('passed:passed,passed');
    expect(done.status).toBe('passed');

    boom = true;
    const failing = await m.whenDone(m.start([job('C')], opts).id)!;
    expect(failing.status).toBe('passed');
    expect(errors.length).toBeGreaterThan(0);
  });

  it('restores history and closes runs a restart interrupted, with a reason, and saves them again', () => {
    const saved: Run[] = [];
    const m = new RunManager({ execute: async () => pass }, { onChange: (r) => saved.push(r) });
    const base = {
      createdAt: '2026-01-01T00:00:00Z',
      environment: 'qa',
      browser: 'chromium',
      workers: 1,
    };
    m.restore([
      {
        ...base,
        id: 'done',
        status: 'passed',
        cases: [{ caseId: 'A', status: 'passed', steps: [], artifacts: [] }],
      },
      {
        ...base,
        id: 'cut-off',
        createdAt: '2026-01-02T00:00:00Z',
        status: 'running',
        cases: [
          { caseId: 'A', status: 'passed', steps: [], artifacts: [] },
          { caseId: 'B', status: 'running', steps: [], artifacts: [] },
          { caseId: 'C', status: 'queued', steps: [], artifacts: [] },
        ],
      },
    ]);
    expect(m.list().map((r) => r.id)).toEqual(['cut-off', 'done']);
    const cut = m.get('cut-off')!;
    expect(cut.status).toBe('cancelled');
    expect(cut.endedAt).toBeTruthy();
    expect(cut.cases.map((c) => c.status)).toEqual(['passed', 'cancelled', 'cancelled']);
    expect(cut.cases[1]!.failure).toEqual({
      kind: 'cancelled',
      message: 'Interrupted by a server restart.',
    });
    expect(m.get('done')!.status).toBe('passed');
    expect(saved.map((r) => r.id)).toEqual(['cut-off']); // only the repaired run is rewritten
    expect(m.cancel('done')).toBe(false);
  });
});

describe('RunManager account scheduling', () => {
  const acct = (id: string) => ({ id, label: `Account ${id}` });
  const withAccount = (caseId: string, id: string): CaseJob => ({
    ...job(caseId),
    account: acct(id),
  });

  /** Executor that records which accounts are active at the same time. */
  function tracked() {
    const active = new Map<string, number>();
    let peakTotal = 0;
    let peakPerAccount = 0;
    const log: string[] = [];
    const executor: CaseExecutor = {
      execute: async (j) => {
        const id = j.account!.id;
        active.set(id, (active.get(id) ?? 0) + 1);
        peakPerAccount = Math.max(peakPerAccount, active.get(id)!);
        peakTotal = Math.max(
          peakTotal,
          [...active.values()].reduce((a, b) => a + b, 0),
        );
        log.push(`start ${j.caseId}@${id}`);
        await new Promise((r) => setTimeout(r, 25));
        active.set(id, active.get(id)! - 1);
        log.push(`end ${j.caseId}@${id}`);
        return pass;
      },
    };
    return { executor, stats: () => ({ peakTotal, peakPerAccount, log }) };
  }

  it('never signs the same account in twice at once, but runs different accounts in parallel', async () => {
    const { executor, stats } = tracked();
    const m = new RunManager(executor, { maxWorkers: 8 });
    const jobs = ['A', 'B', 'C'].flatMap((a) => ['T1', 'T2', 'T3'].map((t) => withAccount(t, a)));
    const run = m.start(jobs, { ...opts, workers: 8 });
    const done = await m.whenDone(run.id)!;
    expect(done.status).toBe('passed');
    expect(done.cases).toHaveLength(9);
    expect(stats().peakPerAccount).toBe(1);
    expect(stats().peakTotal).toBe(3); // one browser per account, all three accounts at once
    expect(done.cases.map((c) => c.account).filter((a) => a === 'Account A')).toHaveLength(3);
  });

  it('a single account is simply run one case at a time', async () => {
    const { executor, stats } = tracked();
    const m = new RunManager(executor);
    const done = await m.whenDone(
      m.start(
        ['1', '2', '3', '4'].map((t) => withAccount(t, 'A')),
        { ...opts, workers: 4 },
      ).id,
    )!;
    expect(done.status).toBe('passed');
    expect(stats().peakTotal).toBe(1);
    expect(
      stats()
        .log.filter((l) => l.startsWith('start'))
        .map((l) => l.slice(6, 7)),
    ).toEqual(['1', '2', '3', '4']);
  });

  it('keeps other accounts busy while one account works through its queue', async () => {
    const { executor, stats } = tracked();
    const m = new RunManager(executor);
    const jobs = [
      withAccount('1', 'A'),
      withAccount('2', 'A'),
      withAccount('3', 'A'),
      withAccount('X', 'B'),
    ];
    const done = await m.whenDone(m.start(jobs, { ...opts, workers: 2 }).id)!;
    expect(done.status).toBe('passed');
    const log = stats().log;
    // B's case starts before A has finished all three of its own
    expect(log.indexOf('start X@B')).toBeLessThan(log.indexOf('end 3@A'));
  });

  it('cancels cleanly while jobs are waiting on a busy account', async () => {
    const gate = new Gate();
    const started: string[] = [];
    const m = new RunManager({
      execute: async (j, { signal }) => {
        started.push(j.caseId);
        await gate.promise;
        return signal.aborted ? { status: 'cancelled', steps: [], artifacts: [] } : pass;
      },
    });
    const run = m.start([withAccount('1', 'A'), withAccount('2', 'A'), withAccount('3', 'A')], {
      ...opts,
      workers: 3,
    });
    await new Promise((r) => setTimeout(r, 30));
    expect(started).toEqual(['1']); // 2 and 3 wait for the account, even with free workers
    m.cancel(run.id);
    gate.resolve();
    const done = await m.whenDone(run.id)!;
    expect(done.status).toBe('cancelled');
    expect(done.cases.map((c) => c.status)).toEqual(['cancelled', 'cancelled', 'cancelled']);
  });

  it('records the account label on each result, never the id or any credentials', async () => {
    const m = new RunManager({ execute: async () => pass });
    const done = await m.whenDone(m.start([withAccount('1', 'A')], opts).id)!;
    expect(done.cases[0]!.account).toBe('Account A');
    expect(JSON.stringify(done)).not.toMatch(/"password"|"username"/);
  });
});
