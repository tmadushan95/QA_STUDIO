import type {
  ExecutionStatus,
  Failure,
  FailureKind,
  Scenario,
  StepResult,
} from '@qa-studio/shared';
import type { ActionContext, ActionRegistry } from './registry.js';

/** The application did not behave as the scenario expects. */
export class AssertionFailure extends Error {
  override name = 'AssertionFailure';
  constructor(
    message: string,
    readonly expected?: string,
    readonly actual?: string,
  ) {
    super(message);
  }
}

/** The automation was used wrongly (for example an unknown page key). Not an application defect. */
export class AutomationError extends Error {
  override name = 'AutomationError';
}

export function classifyError(e: unknown): Failure {
  const message = e instanceof Error ? e.message.split('\n')[0]! : String(e);
  if (e instanceof AssertionFailure) {
    return {
      kind: 'assertion',
      message,
      ...(e.expected !== undefined && { expected: e.expected }),
      ...(e.actual !== undefined && { actual: e.actual }),
    };
  }
  const kind: FailureKind =
    e instanceof Error && e.name === 'TimeoutError'
      ? 'timeout'
      : e instanceof Error && e.name === 'AbortError'
        ? 'cancelled'
        : 'automation-error';
  return { kind, message };
}

export interface ScenarioOptions {
  allowDestructive?: boolean;
  stepTimeoutMs: number;
}

export interface ScenarioOutcome {
  status: ExecutionStatus;
  steps: StepResult[];
  failure?: Failure;
}

class StepTimeout extends Error {
  override name = 'TimeoutError';
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let t: NodeJS.Timeout;
  const timer = new Promise<never>((_, reject) => {
    t = setTimeout(() => reject(new StepTimeout(`${label} exceeded ${ms} ms`)), ms);
  });
  return Promise.race([p, timer]).finally(() => clearTimeout(t));
}

const DATA_REF = /\{\{\s*data\.([A-Za-z][\w-]*)\s*\}\}/g;

/** The parameter names a value refers to through `{{data.name}}`, in first-seen order, each once. */
export function dataRefs(value: unknown): string[] {
  const found = new Set<string>();
  const walk = (v: unknown): void => {
    if (typeof v === 'string') for (const m of v.matchAll(DATA_REF)) found.add(m[1] as string);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(value);
  return [...found];
}

/** Replace `{{data.name}}` in string params with the test case's parameters; a missing value blocks the case. */
export function resolveData(
  value: unknown,
  data: Record<string, string>,
): { ok: true; value: unknown } | { ok: false; reason: string } {
  const missing = new Set<string>();
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') {
      return v.replace(DATA_REF, (_m, name: string) => {
        const found = data[name];
        if (found === undefined || found === '') missing.add(name);
        return found ?? '';
      });
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    }
    return v;
  };
  const out = walk(value);
  if (missing.size === 0) return { ok: true, value: out };
  const names = [...missing].map((n) => `"${n}"`).join(', ');
  return {
    ok: false,
    reason: `Parameter ${names} is not set. Add ${missing.size === 1 ? 'it' : 'them'} in the test case's parameters (Test Design or Test Execution page).`,
  };
}

/**
 * Run a scenario deterministically. Every step is validated first; if any step is unknown, has invalid
 * parameters, or is destructive without permission, nothing runs and the case is `blocked`.
 */
export async function runScenario(
  registry: ActionRegistry,
  scenario: Scenario,
  base: Omit<ActionContext, 'vars'>,
  opts: ScenarioOptions,
): Promise<ScenarioOutcome> {
  const ctx: ActionContext = { ...base, vars: {} };
  const planned = scenario.steps.map((s, index) => {
    const resolved = resolveData(s.params, ctx.env.data ?? {});
    if (!resolved.ok) return { index, action: s.action, error: resolved.reason };
    const v = registry.validate(s.action, resolved.value);
    if (v.ok && registry.isDestructive(s.action, v.params) && !opts.allowDestructive) {
      return {
        index,
        action: s.action,
        error: `Action "${s.action}" is destructive and was not explicitly allowed.`,
      };
    }
    return v.ok
      ? { index, action: s.action, params: v.params }
      : { index, action: s.action, error: v.reason };
  });

  const blocked = planned.filter((p) => 'error' in p);
  if (blocked.length > 0) {
    const steps: StepResult[] = planned.map((p) =>
      'error' in p
        ? {
            index: p.index,
            action: p.action,
            status: 'blocked',
            durationMs: 0,
            failure: { kind: 'blocked', message: p.error! },
          }
        : { index: p.index, action: p.action, status: 'skipped', durationMs: 0 },
    );
    return {
      status: 'blocked',
      steps,
      failure: {
        kind: 'blocked',
        message: blocked.map((b) => ('error' in b ? b.error : '')).join(' | '),
      },
    };
  }

  const steps: StepResult[] = [];
  let failure: Failure | undefined;
  let status: ExecutionStatus = 'passed';
  for (const p of planned) {
    if (failure || ctx.signal.aborted) {
      const cancelled = !failure && ctx.signal.aborted;
      if (cancelled) status = 'cancelled';
      steps.push({
        index: p.index,
        action: p.action,
        status: cancelled ? 'cancelled' : 'skipped',
        durationMs: 0,
      });
      continue;
    }
    const def = registry.get(p.action)!;
    const started = Date.now();
    try {
      await withTimeout(
        def.run(ctx, 'params' in p ? p.params : undefined),
        opts.stepTimeoutMs,
        `Step ${p.index + 1} (${p.action})`,
      );
      steps.push({
        index: p.index,
        action: p.action,
        status: 'passed',
        durationMs: Date.now() - started,
      });
    } catch (e) {
      // An error raised after an abort (for example the browser closing under the step) is a cancellation.
      failure = ctx.signal.aborted
        ? { kind: 'cancelled', message: 'Cancelled by user.' }
        : classifyError(e);
      status = failure.kind === 'cancelled' ? 'cancelled' : 'failed';
      steps.push({
        index: p.index,
        action: p.action,
        status: status === 'cancelled' ? 'cancelled' : 'failed',
        durationMs: Date.now() - started,
        failure,
      });
    }
  }
  return { status, steps, ...(failure && { failure }) };
}
