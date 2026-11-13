/**
 * Custom steps: steps a project defines for itself, so the step editor never needs code for one application.
 *
 * A custom step is a named, reusable recipe built from the generic steps: it has **inputs** (what a person fills in each
 * time it is used) and a **body** (the generic steps it runs, which can mention an input as `{{input.name}}`). Using it
 * in a test case looks like any other step: choose it from the action list, fill its inputs.
 *
 * Example, for "Check a permission": inputs `role` and `permission`; body = go to the Roles page, click the role,
 * check that the permission text is shown. Test cases then say only which role and which permission.
 *
 * - Definitions are kept per project (a config block, written through to SQL Server like the other settings).
 * - Each one is registered in the action registry as `custom.<projectId>.<key>`, so validation, destructive-step rules,
 *   reports and the AI see it like any other action. The editor only offers a project's own custom steps to its cases.
 * - A body may use generic steps only (no custom step inside a custom step), so a recipe can never loop.
 * - Removing a step that test cases still use is refused: the cases would stop running.
 */
import { z } from 'zod';
import {
  AssertionFailure,
  AutomationError,
  defineAction,
  resolveData,
  type ActionField,
  type ActionRegistry,
} from '@qa-studio/automation-core';
import { HttpError } from './errors.js';

/** Config block holding every project's custom steps: `{ "<projectId>": CustomStep[] }`. */
export const CUSTOM_STEPS_KEY = 'custom-steps';

/** Most custom steps a project may hold, inputs a step may take, and steps a body may run. */
export const MAX_CUSTOM_STEPS = 100;
const MAX_INPUTS = 20;
const MAX_BODY = 50;

const NAME = /^[A-Za-z][\w-]{0,63}$/;
const INPUT_REF = /\{\{\s*input\.([A-Za-z][\w-]*)\s*\}\}/g;

const Input = z.object({
  name: z.string().regex(NAME, 'Use letters, digits, - or _, starting with a letter.'),
  label: z.string().trim().min(1, 'Give the input a label.').max(80),
  kind: z.enum(['text', 'number', 'choice', 'boolean', 'page']).default('text'),
  required: z.boolean().default(true),
  options: z.array(z.string().trim().min(1).max(100)).max(50).optional(),
  help: z.string().trim().max(200).optional(),
  default: z.union([z.string().max(500), z.number(), z.boolean()]).optional(),
});

const BodyStep = z.object({
  action: z.string().min(1).max(100),
  params: z.record(z.string(), z.unknown()).default({}),
});

export const CustomStep = z.object({
  key: z
    .string()
    .regex(
      /^[a-z][a-z0-9-]{0,47}$/,
      'Use lowercase letters, digits and -, starting with a letter.',
    ),
  label: z.string().trim().min(1, 'Give the step a name.').max(80),
  description: z.string().trim().max(500).optional(),
  inputs: z.array(Input).max(MAX_INPUTS).default([]),
  steps: z.array(BodyStep).min(1, 'Add at least one step to run.').max(MAX_BODY),
});
export type CustomStep = z.infer<typeof CustomStep>;
type InputDef = z.infer<typeof Input>;

const Save = z.object({ items: z.array(CustomStep).max(MAX_CUSTOM_STEPS) });
const Stored = z.record(z.string(), z.array(CustomStep));

/** A custom step as the web app lists it: its definition, its action name and how many cases use it. */
export interface CustomStepView extends CustomStep {
  action: string;
  usedBy: number;
}

export interface CustomStepDeps {
  store: { loadConfig(key: string): unknown; saveConfig(key: string, value: unknown): void };
  registry: ActionRegistry;
  /** Ids of the test cases whose steps (approved or draft) use this action. */
  casesUsing(action: string): string[];
  audit(action: string, target: string, detail: string): void;
}

/** The action name a project's custom step is registered under. */
export const customActionName = (projectId: number, key: string) => `custom.${projectId}.${key}`;

/** Replace `{{input.name}}` in every string of a step's params. A whole-string reference keeps the input's type. */
function substitute(value: unknown, values: Record<string, string | number | boolean>): unknown {
  if (typeof value === 'string') {
    const whole = /^\{\{\s*input\.([A-Za-z][\w-]*)\s*\}\}$/.exec(value);
    if (whole) {
      const v = values[whole[1] as string];
      return v === undefined ? '' : v;
    }
    return value.replace(INPUT_REF, (_m, n: string) => String(values[n] ?? ''));
  }
  if (Array.isArray(value)) return value.map((v) => substitute(v, values));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, substitute(v, values)]));
  }
  return value;
}

/** The input names a body refers to through `{{input.name}}`. */
function inputRefs(value: unknown): string[] {
  const found = new Set<string>();
  const walk = (v: unknown): void => {
    if (typeof v === 'string') for (const m of v.matchAll(INPUT_REF)) found.add(m[1] as string);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(value);
  return [...found];
}

/** A value that passes the input's own type, used to check a body before anyone has filled the inputs. */
function sample(i: InputDef): string | number | boolean {
  if (i.default !== undefined) return i.default;
  if (i.kind === 'number') return 1;
  if (i.kind === 'boolean') return true;
  if (i.kind === 'choice') return i.options?.[0] ?? 'x';
  return 'x';
}

/** The input schema of one custom step, from its inputs. */
function paramsOf(inputs: InputDef[]): z.ZodType {
  const shape: Record<string, z.ZodType> = {};
  for (const i of inputs) {
    let t: z.ZodType =
      i.kind === 'number'
        ? z.number()
        : i.kind === 'boolean'
          ? z.boolean()
          : i.kind === 'choice' && i.options?.length
            ? z.enum(i.options as [string, ...string[]])
            : z.string().min(1, 'Fill this in.');
    if (!i.required || i.default !== undefined || i.kind === 'boolean') t = t.optional();
    shape[i.name] = t;
  }
  return z.object(shape);
}

/** How the editor draws the inputs of one custom step. */
function fieldsOf(inputs: InputDef[]): ActionField[] {
  return inputs.map((i) => ({
    name: i.name,
    label: i.label,
    kind: i.kind === 'page' ? 'page' : i.kind === 'choice' && i.options?.length ? 'choice' : i.kind,
    required: i.required,
    ...(i.kind === 'choice' && i.options && { options: i.options }),
    ...(i.help && { help: i.help }),
    ...(i.default !== undefined && { default: i.default }),
  }));
}

export class CustomStepService {
  constructor(private readonly d: CustomStepDeps) {
    this.syncAll();
  }

  private all(): Record<string, CustomStep[]> {
    const p = Stored.safeParse(this.d.store.loadConfig(CUSTOM_STEPS_KEY));
    return p.success ? p.data : {};
  }

  /** Register every project's custom steps. Called at start-up. */
  syncAll(): void {
    for (const [id, items] of Object.entries(this.all())) this.register(Number(id), items);
  }

  /** Make a project's registered actions match its definitions. */
  private register(projectId: number, items: CustomStep[]): void {
    this.d.registry.unregisterProject(projectId);
    for (const def of items) {
      const name = customActionName(projectId, def.key);
      const registry = this.d.registry;
      const destructive = def.steps.some(
        (s) => registry.get(s.action)?.destructive || s.params['destructive'] === true,
      );
      registry.register(
        defineAction({
          name,
          description: def.description ?? `${def.label} (a custom step of this project).`,
          source: 'example',
          params: paramsOf(def.inputs),
          projectId,
          ...(destructive && { destructive: true }),
          ui: {
            label: def.label,
            group: 'Custom',
            summary: def.label,
            fields: fieldsOf(def.inputs),
          },
          async run(ctx, given) {
            const values: Record<string, string | number | boolean> = {};
            for (const i of def.inputs) if (i.default !== undefined) values[i.name] = i.default;
            Object.assign(values, given as Record<string, string | number | boolean>);
            for (const [n, sub] of def.steps.entries()) {
              const where = `${def.label}, step ${n + 1}`;
              const resolved = resolveData(substitute(sub.params, values), ctx.env.data ?? {});
              if (!resolved.ok) throw new AutomationError(`${where}: ${resolved.reason}`);
              const v = registry.validate(sub.action, resolved.value);
              if (!v.ok) throw new AutomationError(`${where}: ${v.reason}`);
              try {
                await registry.get(sub.action)!.run(ctx, v.params);
              } catch (e) {
                // Say which step of the recipe failed; keep the kind of failure (assertion, timeout…).
                if (e instanceof AssertionFailure) {
                  throw new AssertionFailure(`${where}: ${e.message}`, e.expected, e.actual);
                }
                if (e instanceof Error) e.message = `${where}: ${e.message}`;
                throw e;
              }
            }
          },
        }),
      );
    }
  }

  list(projectId: number): CustomStepView[] {
    return (this.all()[String(projectId)] ?? []).map((def) => {
      const action = customActionName(projectId, def.key);
      return { ...def, action, usedBy: this.d.casesUsing(action).length };
    });
  }

  /** Check one definition without saving: its body must be generic steps that accept the inputs. */
  private check(def: CustomStep): string[] {
    const problems: string[] = [];
    const names = new Set<string>();
    for (const i of def.inputs) {
      if (names.has(i.name)) problems.push(`Two inputs are called "${i.name}".`);
      names.add(i.name);
      if (i.kind === 'choice' && !i.options?.length) {
        problems.push(`Input "${i.label}" is a choice, so list its options.`);
      }
    }
    const values = Object.fromEntries(def.inputs.map((i) => [i.name, sample(i)]));
    const anything = new Proxy({}, { get: () => 'x' }) as Record<string, string>;
    def.steps.forEach((s, n) => {
      const where = `Step ${n + 1} (${s.action})`;
      const known = this.d.registry.get(s.action);
      if (!known) return void problems.push(`${where}: this step does not exist.`);
      if (known.source !== 'generic' || known.projectId !== undefined) {
        return void problems.push(
          `${where}: a custom step can only use the standard steps, not application or custom steps.`,
        );
      }
      for (const ref of inputRefs(s.params)) {
        if (!names.has(ref)) {
          problems.push(`${where}: uses {{input.${ref}}}, but there is no input called "${ref}".`);
        }
      }
      const filled = resolveData(substitute(s.params, values), anything);
      const v = this.d.registry.validate(s.action, filled.ok ? filled.value : s.params);
      if (!v.ok) problems.push(`${where}: ${v.reason}`);
    });
    return problems;
  }

  /** Replace a project's custom steps with the given list. All or nothing. */
  save(projectId: number, body: unknown): CustomStepView[] {
    const parsed = Save.safeParse(body);
    if (!parsed.success) {
      const fields: Record<string, string> = {};
      for (const i of parsed.error.issues) fields[i.path.join('.')] ??= i.message;
      throw new HttpError(
        400,
        'invalid-custom-steps',
        parsed.error.issues[0]?.message ?? 'The custom steps are not valid.',
        fields,
      );
    }
    const items = parsed.data.items;
    const seen = new Set<string>();
    for (const def of items) {
      if (seen.has(def.key)) {
        throw new HttpError(400, 'duplicate-custom-step', `Two steps use the name "${def.key}".`);
      }
      seen.add(def.key);
      const problems = this.check(def);
      if (problems.length > 0) {
        throw new HttpError(400, 'invalid-custom-steps', `"${def.label}": ${problems.join(' ')}`);
      }
    }
    // A step that cases still use cannot disappear, or those cases would stop running.
    for (const old of this.all()[String(projectId)] ?? []) {
      if (seen.has(old.key)) continue;
      const users = this.d.casesUsing(customActionName(projectId, old.key));
      if (users.length > 0) {
        throw new HttpError(
          409,
          'custom-step-in-use',
          `"${old.label}" is used by ${users.length} test case${users.length === 1 ? '' : 's'} (${users.slice(0, 3).join(', ')}${users.length > 3 ? '…' : ''}). Change those first.`,
        );
      }
    }
    const all = this.all();
    if (items.length === 0) delete all[String(projectId)];
    else all[String(projectId)] = items;
    this.d.store.saveConfig(CUSTOM_STEPS_KEY, all);
    this.register(projectId, items);
    this.d.audit('custom-steps.update', String(projectId), `Saved ${items.length} custom steps.`);
    return this.list(projectId);
  }
}
