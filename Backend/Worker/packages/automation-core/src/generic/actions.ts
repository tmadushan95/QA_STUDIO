/**
 * The generic step library: app-independent actions a test case is built from.
 *
 * Every action takes plain data (a target, a value, a page name), so a test case is a list of steps saved as JSON
 * and edited in the visual editor, and no code is written per application or per test case. String values may use
 * `{{data.name}}` (a test case parameter, filled before the run) and `{{var.name}}` (a value remembered earlier in the case,
 * filled when the step runs).
 */
import type { Locator } from 'playwright';
import { z } from 'zod';
import { AssertionFailure, AutomationError } from '../scenario.js';
import {
  defineAction,
  type ActionContext,
  type ActionDefinition,
  type ActionField,
  type ActionRegistry,
} from '../registry.js';
import { describeTarget, locate, locateAll, Target } from './target.js';

const VAR_REF = /\{\{\s*var\.([A-Za-z][\w-]*)\s*\}\}/g;

/** Fill `{{var.name}}` from values remembered earlier in this case. An unknown name is an automation error. */
export function fillVars(value: string, vars: Record<string, string>): string {
  return value.replace(VAR_REF, (_m, name: string) => {
    const v = vars[name];
    if (v === undefined) {
      throw new AutomationError(`"{{var.${name}}}" is used before a "Remember" step saved it.`);
    }
    return v;
  });
}

const safePath = z
  .string()
  .min(1)
  .regex(/^\/(?!\/)[^\s\\]*$/, 'Use a path on the application, such as "/projects".');
const varName = z
  .string()
  .regex(/^[A-Za-z][\w-]{0,63}$/, 'Use letters, digits, - or _, starting with a letter.');
/** Every step may say it changes or deletes data; such steps only run where deleting is allowed. */
const destructive = z.boolean().optional();

const TARGET: ActionField = { name: 'target', label: 'Element', kind: 'target', required: true };
const DESTRUCTIVE: ActionField = {
  name: 'destructive',
  label: 'Changes or deletes data',
  kind: 'boolean',
  help: 'Runs only in environments where deleting is allowed.',
};

/** Wait for an element and turn Playwright's timeout into a readable assertion failure. */
async function waitState(
  loc: Locator,
  state: 'visible' | 'hidden',
  what: string,
  timeout: number,
): Promise<void> {
  try {
    await loc.waitFor({ state, timeout });
  } catch (e) {
    if (e instanceof Error && e.name === 'TimeoutError') {
      throw new AssertionFailure(
        `Expected ${what} to be ${state}.`,
        state,
        state === 'visible' ? 'not visible' : 'still visible',
      );
    }
    throw e;
  }
}

/** Poll a check until it passes or the step's time is up, so assertions tolerate a page that is still updating. */
async function eventually(
  timeoutMs: number,
  check: () => Promise<{ ok: boolean; expected: string; actual: string; message: string }>,
): Promise<void> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const r = await check();
    if (r.ok) return;
    if (Date.now() >= until) throw new AssertionFailure(r.message, r.expected, r.actual);
    await new Promise((res) => setTimeout(res, 150));
  }
}

const el = (ctx: ActionContext, t: z.infer<typeof Target>) => locate(ctx.page, t);

export const open = defineAction({
  name: 'open',
  description: 'Open a path on the environment’s base URL (same site only).',
  source: 'generic',
  ui: {
    label: 'Open URL path',
    group: 'Navigate',
    summary: 'Open {path}',
    fields: [
      { name: 'path', label: 'Path', kind: 'text', required: true, help: 'For example /projects' },
    ],
  },
  params: z.object({ path: safePath }),
  async run(ctx, { path }) {
    await ctx.page.goto(new URL(fillVars(path, ctx.vars), ctx.env.baseUrl).toString(), {
      timeout: ctx.env.timeoutMs,
    });
  },
});

export const goToPage = defineAction({
  name: 'go-to-page',
  description: 'Open a page from the page list in Settings and wait until it has loaded.',
  source: 'generic',
  ui: {
    label: 'Go to page',
    group: 'Navigate',
    summary: 'Go to page {page}',
    fields: [{ name: 'page', label: 'Page', kind: 'page', required: true }],
  },
  params: z.object({ page: z.string().min(1) }),
  async run(ctx, { page: key }) {
    const spec = ctx.env.pages[key];
    if (!spec) {
      const known = Object.keys(ctx.env.pages);
      throw new AutomationError(
        `There is no page "${key}" in Settings › Pages.${known.length ? ` Known pages: ${known.join(', ')}.` : ''}`,
      );
    }
    await ctx.page.goto(new URL(spec.route, ctx.env.baseUrl).toString(), {
      timeout: ctx.env.timeoutMs,
    });
    if (spec.marker) {
      await waitState(
        ctx.page.getByText(spec.marker).first(),
        'visible',
        `"${spec.marker}"`,
        ctx.env.timeoutMs,
      );
    }
  },
});

export const back = defineAction({
  name: 'back',
  description: 'Go back to the previous page.',
  source: 'generic',
  ui: { label: 'Go back', group: 'Navigate', summary: 'Go back', fields: [] },
  params: z.object({}),
  async run(ctx) {
    await ctx.page.goBack({ timeout: ctx.env.timeoutMs });
  },
});

export const reload = defineAction({
  name: 'reload',
  description: 'Reload the current page.',
  source: 'generic',
  ui: { label: 'Reload page', group: 'Navigate', summary: 'Reload the page', fields: [] },
  params: z.object({}),
  async run(ctx) {
    await ctx.page.reload({ timeout: ctx.env.timeoutMs });
  },
});

export const click = defineAction({
  name: 'click',
  description: 'Click an element.',
  source: 'generic',
  ui: {
    label: 'Click',
    group: 'Interact',
    summary: 'Click {target}',
    fields: [TARGET, DESTRUCTIVE],
  },
  params: z.object({ target: Target, destructive }),
  async run(ctx, { target }) {
    await el(ctx, target).click({ timeout: ctx.env.timeoutMs });
  },
});

export const doubleClick = defineAction({
  name: 'double-click',
  description: 'Double-click an element.',
  source: 'generic',
  ui: {
    label: 'Double-click',
    group: 'Interact',
    summary: 'Double-click {target}',
    fields: [TARGET, DESTRUCTIVE],
  },
  params: z.object({ target: Target, destructive }),
  async run(ctx, { target }) {
    await el(ctx, target).dblclick({ timeout: ctx.env.timeoutMs });
  },
});

export const hover = defineAction({
  name: 'hover',
  description: 'Move the mouse over an element, for menus and tooltips.',
  source: 'generic',
  ui: { label: 'Hover', group: 'Interact', summary: 'Hover over {target}', fields: [TARGET] },
  params: z.object({ target: Target }),
  async run(ctx, { target }) {
    await el(ctx, target).hover({ timeout: ctx.env.timeoutMs });
  },
});

export const fill = defineAction({
  name: 'fill',
  description: 'Type a value into a field, replacing what was there.',
  source: 'generic',
  ui: {
    label: 'Fill field',
    group: 'Interact',
    summary: 'Fill {target} with {value}',
    fields: [
      { ...TARGET, label: 'Field' },
      { name: 'value', label: 'Value', kind: 'text', required: true },
    ],
  },
  params: z.object({ target: Target, value: z.string().max(5000) }),
  async run(ctx, { target, value }) {
    await el(ctx, target).fill(fillVars(value, ctx.vars), { timeout: ctx.env.timeoutMs });
  },
});

export const clear = defineAction({
  name: 'clear',
  description: 'Empty a field.',
  source: 'generic',
  ui: {
    label: 'Clear field',
    group: 'Interact',
    summary: 'Clear {target}',
    fields: [{ ...TARGET, label: 'Field' }],
  },
  params: z.object({ target: Target }),
  async run(ctx, { target }) {
    await el(ctx, target).clear({ timeout: ctx.env.timeoutMs });
  },
});

export const select = defineAction({
  name: 'select',
  description: 'Choose an option in a drop-down list by its visible text.',
  source: 'generic',
  ui: {
    label: 'Select option',
    group: 'Interact',
    summary: 'Select {option} in {target}',
    fields: [
      { ...TARGET, label: 'List' },
      { name: 'option', label: 'Option', kind: 'text', required: true },
    ],
  },
  params: z.object({ target: Target, option: z.string().min(1) }),
  async run(ctx, { target, option }) {
    await el(ctx, target).selectOption(
      { label: fillVars(option, ctx.vars) },
      { timeout: ctx.env.timeoutMs },
    );
  },
});

export const check = defineAction({
  name: 'check',
  description: 'Tick a checkbox or choose a radio button.',
  source: 'generic',
  ui: { label: 'Tick', group: 'Interact', summary: 'Tick {target}', fields: [TARGET] },
  params: z.object({ target: Target }),
  async run(ctx, { target }) {
    await el(ctx, target).check({ timeout: ctx.env.timeoutMs });
  },
});

export const uncheck = defineAction({
  name: 'uncheck',
  description: 'Untick a checkbox.',
  source: 'generic',
  ui: { label: 'Untick', group: 'Interact', summary: 'Untick {target}', fields: [TARGET] },
  params: z.object({ target: Target }),
  async run(ctx, { target }) {
    await el(ctx, target).uncheck({ timeout: ctx.env.timeoutMs });
  },
});

export const press = defineAction({
  name: 'press',
  description: 'Press a key, optionally in a given element (for example Enter in a search box).',
  source: 'generic',
  ui: {
    label: 'Press key',
    group: 'Interact',
    summary: 'Press {key}',
    fields: [
      {
        name: 'key',
        label: 'Key',
        kind: 'key',
        required: true,
        help: 'For example Enter, Escape, Tab',
      },
      { ...TARGET, required: false, label: 'In element (optional)' },
    ],
  },
  params: z.object({
    key: z.string().regex(/^[A-Za-z0-9+]{1,30}$/, 'Use a key name such as Enter or Control+A.'),
    target: Target.optional(),
  }),
  async run(ctx, { key, target }) {
    if (target) await el(ctx, target).press(key, { timeout: ctx.env.timeoutMs });
    else await ctx.page.keyboard.press(key);
  },
});

export const waitFor = defineAction({
  name: 'wait-for',
  description: 'Wait until an element appears or disappears.',
  source: 'generic',
  ui: {
    label: 'Wait for element',
    group: 'Wait',
    summary: 'Wait until {target} is {state}',
    fields: [
      TARGET,
      { name: 'state', label: 'Until it is', kind: 'choice', options: ['visible', 'hidden'] },
    ],
  },
  params: z.object({ target: Target, state: z.enum(['visible', 'hidden']).default('visible') }),
  async run(ctx, { target, state }) {
    await waitState(el(ctx, target), state, describeTarget(target), ctx.env.timeoutMs);
  },
});

export const assertVisible = defineAction({
  name: 'assert-visible',
  description: 'Check that an element is shown.',
  source: 'generic',
  ui: {
    label: 'Check element is shown',
    group: 'Check',
    summary: 'Check {target} is shown',
    fields: [TARGET],
  },
  params: z.object({ target: Target }),
  async run(ctx, { target }) {
    await waitState(el(ctx, target), 'visible', describeTarget(target), ctx.env.timeoutMs);
  },
});

export const assertHidden = defineAction({
  name: 'assert-hidden',
  description: 'Check that an element is not shown.',
  source: 'generic',
  ui: {
    label: 'Check element is not shown',
    group: 'Check',
    summary: 'Check {target} is not shown',
    fields: [TARGET],
  },
  params: z.object({ target: Target }),
  async run(ctx, { target }) {
    await waitState(el(ctx, target), 'hidden', describeTarget(target), ctx.env.timeoutMs);
  },
});

export const assertText = defineAction({
  name: 'assert-text',
  description: 'Check that some text is shown anywhere on the page.',
  source: 'generic',
  ui: {
    label: 'Check text is shown',
    group: 'Check',
    summary: 'Check “{text}” is shown',
    fields: [{ name: 'text', label: 'Text', kind: 'text', required: true }],
  },
  params: z.object({ text: z.string().min(1) }),
  async run(ctx, { text }) {
    const t = fillVars(text, ctx.vars);
    await waitState(ctx.page.getByText(t).first(), 'visible', `"${t}"`, ctx.env.timeoutMs);
  },
});

export const assertNoText = defineAction({
  name: 'assert-no-text',
  description: 'Check that some text is not shown on the page.',
  source: 'generic',
  ui: {
    label: 'Check text is not shown',
    group: 'Check',
    summary: 'Check “{text}” is not shown',
    fields: [{ name: 'text', label: 'Text', kind: 'text', required: true }],
  },
  params: z.object({ text: z.string().min(1) }),
  async run(ctx, { text }) {
    const t = fillVars(text, ctx.vars);
    await waitState(ctx.page.getByText(t).first(), 'hidden', `"${t}"`, ctx.env.timeoutMs);
  },
});

/** Build an enabled/disabled check; the two differ only in the expected state. */
function enabledCheck(name: string, enabled: boolean): ActionDefinition {
  const word = enabled ? 'enabled' : 'disabled';
  return defineAction({
    name,
    description: `Check that an element is ${word}.`,
    source: 'generic',
    ui: {
      label: `Check element is ${word}`,
      group: 'Check',
      summary: `Check {target} is ${word}`,
      fields: [TARGET],
    },
    params: z.object({ target: Target }),
    async run(ctx, { target }) {
      const loc = el(ctx, target);
      await waitState(loc, 'visible', describeTarget(target), ctx.env.timeoutMs);
      await eventually(ctx.env.timeoutMs, async () => {
        const is = await loc.isEnabled();
        return {
          ok: is === enabled,
          expected: word,
          actual: is ? 'enabled' : 'disabled',
          message: `Expected ${describeTarget(target)} to be ${word}.`,
        };
      });
    },
  });
}
export const assertEnabled = enabledCheck('assert-enabled', true);
export const assertDisabled = enabledCheck('assert-disabled', false);

export const assertValue = defineAction({
  name: 'assert-value',
  description: 'Check the value in a field.',
  source: 'generic',
  ui: {
    label: 'Check field value',
    group: 'Check',
    summary: 'Check {target} contains {value}',
    fields: [
      { ...TARGET, label: 'Field' },
      { name: 'value', label: 'Expected value', kind: 'text', required: true },
    ],
  },
  params: z.object({ target: Target, value: z.string() }),
  async run(ctx, { target, value }) {
    const expected = fillVars(value, ctx.vars);
    const loc = el(ctx, target);
    await eventually(ctx.env.timeoutMs, async () => {
      const actual = await loc.inputValue({ timeout: ctx.env.timeoutMs });
      return {
        ok: actual === expected,
        expected,
        actual,
        message: `Expected ${describeTarget(target)} to contain "${expected}".`,
      };
    });
  },
});

export const assertUrl = defineAction({
  name: 'assert-url',
  description: 'Check that the current address contains some text, such as a path.',
  source: 'generic',
  ui: {
    label: 'Check page address',
    group: 'Check',
    summary: 'Check the address contains {contains}',
    fields: [{ name: 'contains', label: 'Address contains', kind: 'text', required: true }],
  },
  params: z.object({ contains: z.string().min(1) }),
  async run(ctx, { contains }) {
    const want = fillVars(contains, ctx.vars);
    await eventually(ctx.env.timeoutMs, async () => {
      const actual = ctx.page.url();
      return {
        ok: actual.includes(want),
        expected: want,
        actual,
        message: `Expected the address to contain "${want}".`,
      };
    });
  },
});

export const assertCount = defineAction({
  name: 'assert-count',
  description: 'Check how many elements match, for example the number of rows in a table.',
  source: 'generic',
  ui: {
    label: 'Check number of elements',
    group: 'Check',
    summary: 'Check there are {count} of {target}',
    fields: [TARGET, { name: 'count', label: 'Expected number', kind: 'number', required: true }],
  },
  params: z.object({ target: Target, count: z.number().int().min(0) }),
  async run(ctx, { target, count }) {
    const all = locateAll(ctx.page, target);
    await eventually(ctx.env.timeoutMs, async () => {
      const actual = await all.count();
      return {
        ok: actual === count,
        expected: String(count),
        actual: String(actual),
        message: `Expected ${count} of ${describeTarget(target)}, found ${actual}.`,
      };
    });
  },
});

export const remember = defineAction({
  name: 'remember',
  description:
    'Save an element’s text or a field’s value, or the page address, to use in a later step as {{var.name}}.',
  source: 'generic',
  ui: {
    label: 'Remember a value',
    group: 'Remember',
    summary: 'Remember {from} of {target} as {as}',
    fields: [
      {
        name: 'from',
        label: 'What to remember',
        kind: 'choice',
        options: ['text', 'value', 'url'],
      },
      { ...TARGET, required: false, label: 'Element (not needed for the address)' },
      {
        name: 'as',
        label: 'Save as',
        kind: 'text',
        required: true,
        help: 'Use it later as {{var.name}}',
      },
    ],
  },
  params: z
    .object({
      from: z.enum(['text', 'value', 'url']).default('text'),
      target: Target.optional(),
      as: varName,
    })
    .refine((p) => p.from === 'url' || p.target, 'Choose the element to remember.'),
  async run(ctx, { from, target, as }) {
    if (from === 'url') ctx.vars[as] = ctx.page.url();
    else {
      const loc = el(ctx, target!);
      ctx.vars[as] =
        from === 'value'
          ? await loc.inputValue({ timeout: ctx.env.timeoutMs })
          : ((await loc.textContent({ timeout: ctx.env.timeoutMs })) ?? '').trim();
    }
    ctx.log.info('remembered value', { as });
  },
});

export const assertEquals = defineAction({
  name: 'assert-equals',
  description: 'Compare two values, typically a remembered value with what the page shows now.',
  source: 'generic',
  ui: {
    label: 'Check values match',
    group: 'Check',
    summary: 'Check {actual} equals {expected}',
    fields: [
      {
        name: 'actual',
        label: 'Value',
        kind: 'text',
        required: true,
        help: 'For example {{var.total}}',
      },
      { name: 'expected', label: 'Should equal', kind: 'text', required: true },
    ],
  },
  params: z.object({ actual: z.string(), expected: z.string() }),
  async run(ctx, p) {
    const actual = fillVars(p.actual, ctx.vars);
    const expected = fillVars(p.expected, ctx.vars);
    if (actual !== expected) {
      throw new AssertionFailure(`Expected "${actual}" to equal "${expected}".`, expected, actual);
    }
  },
});

/** Every generic action, in the order the editor lists them. */
export const GENERIC_ACTIONS: ActionDefinition[] = [
  open,
  goToPage,
  back,
  reload,
  click,
  doubleClick,
  hover,
  fill,
  clear,
  select,
  check,
  uncheck,
  press,
  waitFor,
  assertVisible,
  assertHidden,
  assertText,
  assertNoText,
  assertEnabled,
  assertDisabled,
  assertValue,
  assertUrl,
  assertCount,
  remember,
  assertEquals,
] as ActionDefinition[];

/** Add the generic step library to a registry. Needed by every workspace; application packs are optional. */
export function registerGenericActions(registry: ActionRegistry): ActionRegistry {
  for (const a of GENERIC_ACTIONS) registry.register(a);
  return registry;
}
