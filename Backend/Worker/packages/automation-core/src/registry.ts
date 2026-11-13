import type { Page } from 'playwright';
import { z } from 'zod';
import type { Logger } from '@qa-studio/shared';

export interface PageSpec {
  route: string;
  /** Text that proves the page has loaded. */
  marker: string;
}

export interface ActionEnv {
  baseUrl: string;
  timeoutMs: number;
  pages: Record<string, PageSpec>;
  /** The test case's parameters (for example project codes), referenced in scenarios as `{{data.name}}`. */
  data?: Record<string, string>;
}

export interface ActionContext {
  page: Page;
  env: ActionEnv;
  log: Logger;
  signal: AbortSignal;
  /** Values one step leaves for a later step of the same case (for example a remembered URL). */
  vars: Record<string, string>;
}

/**
 * Where an action's behaviour was established. Only 'verified' means checked against the live application.
 * 'app-source' means written from reading the application's source code, but not yet run against a real environment.
 */
export type ActionSource = 'verified' | 'app-source' | 'legacy-csharp' | 'example' | 'generic';

/** The kind of input an editor shows for one step field. */
export type FieldKind = 'target' | 'text' | 'page' | 'number' | 'key' | 'choice' | 'boolean';

/** One input of a step, as the visual step editor presents it. */
export interface ActionField {
  /** Parameter name in the step's `params`. */
  name: string;
  label: string;
  kind: FieldKind;
  required?: boolean;
  /** Allowed values for `choice`. */
  options?: string[];
  help?: string;
  /** A value to start with when a step of this action is added. */
  default?: string | number | boolean;
}

/**
 * How the visual editor shows an action: a friendly label, a group for the action menu, and its fields in order.
 * Actions without it still run; the editor then offers them only in the advanced view.
 */
export interface ActionUi {
  label: string;
  /**
   * Where the editor's action menu lists it. The first five are the generic library; "Custom" steps are defined by a
   * project (Project settings › Custom steps); "Application" steps are code written for one application.
   */
  group: 'Navigate' | 'Interact' | 'Wait' | 'Check' | 'Remember' | 'Custom' | 'Application';
  /** A short sentence template for the step list, e.g. "Click {target}". */
  summary: string;
  fields: ActionField[];
}

export interface ActionDefinition<S extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  params: S;
  /** Destructive actions run only when the caller explicitly allows them. */
  destructive?: boolean;
  source: ActionSource;
  ui?: ActionUi;
  /** Set for a step a project defined itself: only that project's test cases may use it. */
  projectId?: number;
  run(ctx: ActionContext, params: z.infer<S>): Promise<void>;
}

export const defineAction = <S extends z.ZodType>(def: ActionDefinition<S>): ActionDefinition<S> =>
  def;

export type ValidationResult = { ok: true; params: unknown } | { ok: false; reason: string };

export class ActionRegistry {
  private readonly actions = new Map<string, ActionDefinition>();

  register(def: ActionDefinition): this {
    if (this.actions.has(def.name)) throw new Error(`Action "${def.name}" is already registered.`);
    this.actions.set(def.name, def);
    return this;
  }

  get(name: string): ActionDefinition | undefined {
    return this.actions.get(name);
  }

  /** Remove every action a project defined (before its steps are registered again after an edit). */
  unregisterProject(projectId: number): void {
    for (const [name, a] of this.actions) if (a.projectId === projectId) this.actions.delete(name);
  }

  /**
   * Whether a step changes or deletes data: either the action always does (an application pack's "delete"), or a
   * generic step was marked so by its author (`destructive: true`), since a plain click cannot know what it does.
   */
  isDestructive(name: string, params: unknown): boolean {
    if (this.actions.get(name)?.destructive) return true;
    return (params as { destructive?: unknown } | null)?.destructive === true;
  }

  /** Check an action exists and its params satisfy the schema, without running anything. */
  validate(name: string, params: unknown): ValidationResult {
    const def = this.actions.get(name);
    if (!def)
      return {
        ok: false,
        reason: `Unknown action "${name}". A new approved capability is required.`,
      };
    const parsed = def.params.safeParse(params);
    if (!parsed.success) {
      return {
        ok: false,
        reason: `Invalid parameters for "${name}": ${parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`,
      };
    }
    return { ok: true, params: parsed.data };
  }

  /**
   * Describe all actions, including a JSON Schema for each parameter set, for the UI and for review. An action without
   * editor metadata (an application pack) gets a form derived from its schema, so no action is ever edited as raw JSON.
   */
  list() {
    return [...this.actions.values()].map((a) => {
      const params = z.toJSONSchema(a.params);
      const ui = a.ui ?? uiFromSchema(a.name, params);
      return {
        name: a.name,
        description: a.description,
        destructive: a.destructive ?? false,
        source: a.source,
        ...(a.projectId !== undefined && { projectId: a.projectId }),
        ...(ui && { ui }),
        params,
      };
    });
  }
}

/** "roles.assert-permission" → "Roles: assert permission"; "drafts.open-project" → "Drafts: open project". */
export function humanizeActionName(name: string): string {
  const [head, ...rest] = name.split('.');
  const words = (t: string) => t.replace(/[-_]+/g, ' ').trim();
  const first = words(rest.length ? rest.join(' ') : (head ?? name));
  const title = rest.length ? `${words(head ?? '')}: ${first}` : first;
  return title.charAt(0).toUpperCase() + title.slice(1);
}

interface SchemaProp {
  type?: string;
  enum?: unknown[];
  description?: string;
  default?: unknown;
}

/**
 * A form for an action that has no editor metadata, read from its parameter schema: text, number, yes/no and choice
 * fields. Parameters of other shapes (objects, lists) are left out; the editor offers those as extra settings.
 */
export function uiFromSchema(name: string, schema: unknown): ActionUi | undefined {
  const s = schema as { properties?: Record<string, SchemaProp>; required?: string[] } | undefined;
  if (!s || typeof s !== 'object') return undefined;
  const required = new Set(s.required ?? []);
  const fields: ActionField[] = [];
  for (const [key, p] of Object.entries(s.properties ?? {})) {
    const label = key.charAt(0).toUpperCase() + key.slice(1).replace(/[-_]+/g, ' ');
    const base = {
      name: key,
      label,
      required: required.has(key),
      ...(p.description && { help: p.description }),
    };
    if (Array.isArray(p.enum) && p.enum.every((o) => typeof o === 'string')) {
      fields.push({ ...base, kind: 'choice', options: p.enum as string[] });
    } else if (p.type === 'string') fields.push({ ...base, kind: 'text' });
    else if (p.type === 'number' || p.type === 'integer') fields.push({ ...base, kind: 'number' });
    else if (p.type === 'boolean') fields.push({ ...base, kind: 'boolean' });
  }
  return {
    label: humanizeActionName(name),
    group: 'Application',
    summary: humanizeActionName(name),
    fields,
  };
}
