import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createLogger, type Scenario } from '@qa-studio/shared';
import {
  ActionRegistry,
  defineAction,
  describeStep,
  registerGenericActions,
  runScenario,
  type ActionContext,
} from './index.js';

const calls: string[] = [];
const ac = new AbortController();
const ctx = (signal = ac.signal) =>
  ({
    page: {},
    env: { baseUrl: 'http://x', timeoutMs: 100, pages: {} },
    log: createLogger(() => undefined),
    signal,
  }) as unknown as ActionContext;

const registry = new ActionRegistry()
  .register(
    defineAction({
      name: 'ok',
      description: '',
      source: 'example',
      params: z.object({}),
      run: async () => void calls.push('ok'),
    }),
  )
  .register(
    defineAction({
      name: 'danger',
      description: '',
      source: 'example',
      destructive: true,
      params: z.object({}),
      run: async () => void calls.push('danger'),
    }),
  )
  .register(
    defineAction({
      name: 'hang',
      description: '',
      source: 'example',
      params: z.object({}),
      run: () => new Promise(() => undefined),
    }),
  )
  .register(
    defineAction({
      name: 'abort',
      description: '',
      source: 'example',
      params: z.object({}),
      run: async () => ac.abort(),
    }),
  );

const sc = (...actions: string[]): Scenario => ({
  schemaVersion: 1,
  caseId: 'C',
  steps: actions.map((action) => ({ action, params: {} })),
});

describe('runScenario (no browser)', () => {
  it('blocks destructive actions unless explicitly allowed, running nothing', async () => {
    calls.length = 0;
    const out = await runScenario(registry, sc('ok', 'danger'), ctx(), { stepTimeoutMs: 100 });
    expect(out.status).toBe('blocked');
    expect(out.failure?.message).toMatch(/destructive/);
    expect(calls).toEqual([]);
    const allowed = await runScenario(registry, sc('ok', 'danger'), ctx(), {
      stepTimeoutMs: 100,
      allowDestructive: true,
    });
    expect(allowed.status).toBe('passed');
    expect(calls).toEqual(['ok', 'danger']);
  });

  it('fails a step that exceeds its timeout and skips the rest', async () => {
    const out = await runScenario(registry, sc('hang', 'ok'), ctx(), { stepTimeoutMs: 50 });
    expect(out.status).toBe('failed');
    expect(out.failure?.kind).toBe('timeout');
    expect(out.steps.map((s) => s.status)).toEqual(['failed', 'skipped']);
  });

  it('marks later steps cancelled when aborted mid-run', async () => {
    const local = new AbortController();
    const reg = new ActionRegistry()
      .register(
        defineAction({
          name: 'abort',
          description: '',
          source: 'example',
          params: z.object({}),
          run: async () => local.abort(),
        }),
      )
      .register(
        defineAction({
          name: 'ok',
          description: '',
          source: 'example',
          params: z.object({}),
          run: async () => undefined,
        }),
      );
    const out = await runScenario(reg, sc('abort', 'ok'), ctx(local.signal), {
      stepTimeoutMs: 100,
    });
    expect(out.status).toBe('cancelled');
    expect(out.steps.map((s) => s.status)).toEqual(['passed', 'cancelled']);
  });
});

describe('describeStep', () => {
  const generic = registerGenericActions(new ActionRegistry());

  it('fills the editor summary with the step values, targets in words', () => {
    const click = { target: { role: 'button', name: 'Delete', exact: true } };
    expect(describeStep(generic.get('click'), 'click', click)).toBe('Click button "Delete"');
    expect(describeStep(generic.get('open'), 'open', { path: '/projects/draft-list' })).toBe(
      'Open /projects/draft-list',
    );
  });

  it('keeps data placeholders as written, so test data never reaches the report', () => {
    const fill = { target: { label: 'Password' }, value: '{{data.password}}' };
    expect(describeStep(generic.get('fill'), 'fill', fill)).toBe(
      'Fill field "Password" with {{data.password}}',
    );
  });

  it('lists the values after a summary without placeholders, and names unknown actions', () => {
    const custom = defineAction({
      name: 'custom.1.open',
      description: '',
      source: 'example',
      params: z.object({ projectCode: z.string() }),
      ui: {
        label: 'Open draft project',
        group: 'Custom',
        summary: 'Open draft project',
        fields: [{ name: 'projectCode', label: 'Project code', kind: 'text', required: true }],
      },
      run: async () => undefined,
    });
    expect(describeStep(custom, 'custom.1.open', { projectCode: 'PRJ-1' })).toBe(
      'Open draft project (Project code: PRJ-1)',
    );
    expect(describeStep(undefined, 'drafts.open-project', {})).toBe('Drafts: open project');
  });

  it('puts the description on every step result', async () => {
    const out = await runScenario(registry, sc('ok'), ctx(), { stepTimeoutMs: 100 });
    expect(out.steps[0]?.description).toBe('Ok');
  });
});
