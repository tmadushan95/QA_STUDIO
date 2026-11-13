import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createLogger, type Scenario } from '@qa-studio/shared';
import {
  ActionRegistry,
  defineAction,
  registerGenericActions,
  runScenario,
  uiFromSchema,
  type ActionContext,
} from '@qa-studio/automation-core';
import { createApp } from './app.js';
import { customActionName, CustomStepService } from './custom-steps.js';
import { HttpError } from './errors.js';
import { MemoryStore } from './store.js';

/** A page that records what the steps did, so a recipe can be run without a browser. */
function fakePage(texts: string[] = []) {
  const did: string[] = [];
  const locator = (what: string): unknown => ({
    first: () => locator(what),
    nth: () => locator(what),
    filter: () => locator(what),
    click: async () => void did.push(`click ${what}`),
    fill: async (v: string) => void did.push(`fill ${what} with ${v}`),
    waitFor: async () => {
      if (!texts.includes(what)) {
        const e = new Error('timeout');
        e.name = 'TimeoutError';
        throw e;
      }
    },
  });
  const page = {
    getByRole: (role: string, o?: { name?: string }) => locator(`${role} ${o?.name ?? ''}`.trim()),
    getByLabel: (l: string) => locator(`field ${l}`),
    getByText: (t: string) => locator(t),
  };
  return { page, did };
}

const ctxOf = (page: unknown, data: Record<string, string> = {}) =>
  ({
    page,
    env: { baseUrl: 'http://x', timeoutMs: 50, pages: {}, data },
    log: createLogger(() => undefined),
    signal: new AbortController().signal,
  }) as unknown as ActionContext;

function setup(used: Record<string, string[]> = {}) {
  const config = new Map<string, unknown>();
  const registry = registerGenericActions(new ActionRegistry());
  const audits: string[] = [];
  const make = () =>
    new CustomStepService({
      store: { loadConfig: (k) => config.get(k), saveConfig: (k, v) => void config.set(k, v) },
      registry,
      casesUsing: (action) => used[action] ?? [],
      audit: (a, t) => void audits.push(`${a} ${t}`),
    });
  return { service: make(), make, registry, config, audits };
}

const permission = {
  key: 'check-permission',
  label: 'Check a permission',
  description: 'Open Roles and look for a permission.',
  inputs: [
    { name: 'role', label: 'Role', kind: 'text', required: true },
    { name: 'permission', label: 'Permission', kind: 'text', required: true },
  ],
  steps: [
    { action: 'click', params: { target: { role: 'button', name: '{{input.role}}' } } },
    { action: 'assert-text', params: { text: '{{input.permission}}' } },
  ],
};

describe('custom steps', () => {
  it('saves a project’s steps, registers them as actions and lists how they are drawn', () => {
    const { service, registry } = setup();
    const items = service.save(3, { items: [permission] });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ action: 'custom.3.check-permission', usedBy: 0 });
    const listed = registry.list().find((a) => a.name === 'custom.3.check-permission')!;
    expect(listed).toMatchObject({
      projectId: 3,
      ui: { label: 'Check a permission', group: 'Custom' },
    });
    expect(listed.ui!.fields.map((f) => f.name)).toEqual(['role', 'permission']);
    // Another project does not see it in its own list.
    expect(service.list(4)).toEqual([]);
  });

  it('survives a restart and replaces a project’s list as a whole', () => {
    const { service, make, registry } = setup();
    service.save(3, { items: [permission] });
    make();
    service.save(3, { items: [{ ...permission, key: 'other', label: 'Other' }] });
    expect(registry.get(customActionName(3, 'check-permission'))).toBeUndefined();
    expect(registry.get(customActionName(3, 'other'))).toBeDefined();
  });

  it('runs the recipe’s steps with the inputs filled in', async () => {
    const { service, registry } = setup();
    service.save(3, { items: [permission] });
    const { page, did } = fakePage(['Create']);
    const scenario: Scenario = {
      name: 'x',
      steps: [
        { action: 'custom.3.check-permission', params: { role: 'Admin', permission: 'Create' } },
      ],
    } as unknown as Scenario;
    const out = await runScenario(registry, scenario, ctxOf(page), { stepTimeoutMs: 1000 });
    expect(out.status).toBe('passed');
    expect(did).toEqual(['click button Admin']);
  });

  it('says which step of the recipe failed', async () => {
    const { service, registry } = setup();
    service.save(3, { items: [permission] });
    const { page } = fakePage([]);
    const out = await runScenario(
      registry,
      {
        name: 'x',
        steps: [
          { action: 'custom.3.check-permission', params: { role: 'Admin', permission: 'Delete' } },
        ],
      } as unknown as Scenario,
      ctxOf(page),
      { stepTimeoutMs: 1000 },
    );
    expect(out.status).toBe('failed');
    expect(out.failure?.message).toMatch(/^Check a permission, step 2:/);
  });

  it('blocks a case that leaves a required input empty', async () => {
    const { service, registry } = setup();
    service.save(3, { items: [permission] });
    const out = await runScenario(
      registry,
      {
        name: 'x',
        steps: [{ action: 'custom.3.check-permission', params: { role: 'Admin' } }],
      } as unknown as Scenario,
      ctxOf(fakePage().page),
      { stepTimeoutMs: 1000 },
    );
    expect(out.status).toBe('blocked');
  });

  it('keeps a number input a number, and is destructive when a step in it is', async () => {
    const { service, registry } = setup();
    service.save(3, {
      items: [
        {
          key: 'rows',
          label: 'Count rows',
          inputs: [{ name: 'n', label: 'How many', kind: 'number' }],
          steps: [
            { action: 'assert-count', params: { target: { role: 'row' }, count: '{{input.n}}' } },
          ],
        },
        {
          key: 'remove',
          label: 'Remove it',
          inputs: [],
          steps: [{ action: 'click', params: { target: { text: 'Delete' }, destructive: true } }],
        },
      ],
    });
    expect(registry.validate('custom.3.rows', { n: 2 }).ok).toBe(true);
    expect(registry.validate('custom.3.rows', { n: 'two' }).ok).toBe(false);
    expect(registry.isDestructive('custom.3.remove', {})).toBe(true);
    expect(registry.isDestructive('custom.3.rows', { n: 1 })).toBe(false);
  });

  it.each([
    [
      'an unknown step',
      { ...permission, steps: [{ action: 'no-such', params: {} }] },
      /does not exist/,
    ],
    [
      'an input nobody declared',
      { ...permission, steps: [{ action: 'assert-text', params: { text: '{{input.nope}}' } }] },
      /no input called "nope"/,
    ],
    [
      'a body with a bad parameter',
      { ...permission, steps: [{ action: 'press', params: { key: 'not a key!' } }] },
      /Step 1 \(press\)/,
    ],
    [
      'a choice without options',
      { ...permission, inputs: [{ name: 'x', label: 'X', kind: 'choice' }] },
      /list its options/,
    ],
  ])('refuses %s', (_n, def, message) => {
    const { service } = setup();
    expect(() => service.save(3, { items: [def] })).toThrowError(message);
  });

  it('refuses application and custom steps inside a recipe, so one can never loop', () => {
    const { service, registry } = setup();
    registry.register(
      defineAction({
        name: 'app.thing',
        description: '',
        source: 'app-source',
        params: z.object({}),
        run: async () => undefined,
      }),
    );
    service.save(3, { items: [permission] });
    const inside = (action: string) => ({
      ...permission,
      key: 'wrapper',
      steps: [{ action, params: {} }],
    });
    expect(() => service.save(3, { items: [permission, inside('app.thing')] })).toThrowError(
      /only use the standard steps/,
    );
    expect(() =>
      service.save(3, { items: [permission, inside('custom.3.check-permission')] }),
    ).toThrowError(/only use the standard steps/);
  });

  it('refuses two steps with the same name', () => {
    const { service } = setup();
    expect(() => service.save(3, { items: [permission, permission] })).toThrowError(HttpError);
  });

  it('will not remove a step that test cases use, but will once they do not', () => {
    const used = { 'custom.3.check-permission': ['TC_1', 'TC_2'] };
    const { service } = setup(used);
    service.save(3, { items: [permission] });
    expect(() => service.save(3, { items: [] })).toThrowError(/used by 2 test cases/);
    delete (used as Record<string, string[]>)['custom.3.check-permission'];
    expect(service.save(3, { items: [] })).toEqual([]);
  });
});

describe('forms for application steps', () => {
  it('draws text, number, yes/no and choice parameters, and leaves nested ones out', () => {
    const ui = uiFromSchema(
      'roles.assert-permission',
      z.toJSONSchema(
        z.object({
          role: z.string().min(1),
          count: z.number().optional(),
          strict: z.boolean().optional(),
          mode: z.enum(['a', 'b']),
          nested: z.object({ x: z.string() }).optional(),
        }),
      ),
    )!;
    expect(ui).toMatchObject({ label: 'Roles: assert permission', group: 'Application' });
    expect(ui.fields.map((f) => [f.name, f.kind, f.required])).toEqual([
      ['role', 'text', true],
      ['count', 'number', false],
      ['strict', 'boolean', false],
      ['mode', 'choice', true],
    ]);
  });
});

describe('custom steps over HTTP', () => {
  it('lists and saves a project’s steps, and says when the worker lacks them', async () => {
    const { service } = setup();
    const app = createApp(new MemoryStore(), { customSteps: service });
    const put = await app.inject({
      method: 'PUT',
      url: '/api/custom-steps/3',
      payload: { items: [permission] },
    });
    expect(put.statusCode).toBe(200);
    const get = await app.inject({ method: 'GET', url: '/api/custom-steps/3' });
    expect(get.json().items[0]).toMatchObject({ key: 'check-permission', usedBy: 0 });
    const bad = await app.inject({
      method: 'PUT',
      url: '/api/custom-steps/3',
      payload: { items: [{ ...permission, steps: [] }] },
    });
    expect(bad.statusCode).toBe(400);
    const info = await app.inject({ method: 'GET', url: '/api/automation' });
    expect(info.json().capabilities).toContain('custom-steps');
    await app.close();
  });
});
