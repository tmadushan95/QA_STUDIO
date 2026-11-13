/** Requests for a project's custom steps (Project settings › Custom steps). */
import { get, send } from '../../shared/api/http.js';
import { invalidateCatalog } from '../../shared/api/catalog.js';
import type { Step } from '../test-cases/api.js';

/** What a person fills in each time the custom step is used. */
export interface CustomInput {
  /** The name a body refers to it by, as `{{input.name}}`. */
  name: string;
  label: string;
  kind: 'text' | 'number' | 'choice' | 'boolean' | 'page';
  required: boolean;
  /** The allowed values of a `choice`. */
  options?: string[];
  help?: string;
}

/** A recipe of standard steps with inputs, as a project defines it. */
export interface CustomStep {
  /** Lowercase name that identifies it inside the project. */
  key: string;
  label: string;
  description?: string;
  inputs: CustomInput[];
  steps: Step[];
}

/** A custom step as listed: its definition, the action name test cases store, and how many cases use it. */
export interface CustomStepView extends CustomStep {
  action: string;
  usedBy: number;
}

export async function fetchCustomSteps(projectId: number): Promise<CustomStepView[]> {
  const r = await get<{ items?: CustomStepView[] }>(`/api/custom-steps/${projectId}`);
  return Array.isArray(r?.items) ? r.items : [];
}

/** Replace the project's custom steps. Test cases pick the change up at once (the step menu is reloaded). */
export async function saveCustomSteps(
  projectId: number,
  items: CustomStep[],
): Promise<CustomStepView[]> {
  const r = await send<{ items?: CustomStepView[] }>(
    `/api/custom-steps/${projectId}`,
    { items },
    'PUT',
  );
  invalidateCatalog();
  return Array.isArray(r?.items) ? r.items : [];
}

/** Without the view-only fields, as the server takes it. */
export const definitionOf = ({
  key,
  label,
  description,
  inputs,
  steps,
}: CustomStepView): CustomStep => ({
  key,
  label,
  ...(description && { description }),
  inputs,
  steps,
});

/** "Role name" → "roleName": a name usable as `{{input.roleName}}`. */
export function inputName(label: string): string {
  const words = label
    .replace(/[^A-Za-z0-9 ]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const camel = words
    .map((w, i) => (i === 0 ? w.toLowerCase() : w[0]!.toUpperCase() + w.slice(1).toLowerCase()))
    .join('');
  return /^[A-Za-z]/.test(camel) ? camel : camel ? `input${camel}` : '';
}

/** "Check a permission" → "check-a-permission". */
export function stepKey(label: string): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return /^[a-z]/.test(slug) ? slug : slug ? `step-${slug}` : '';
}

/** A ready-made example to start from, so a first custom step is one click away. */
export const EXAMPLE_STEP: CustomStep = {
  key: 'open-page-and-check-heading',
  label: 'Open a page and check its heading',
  description: 'Goes to a page and checks that its heading says what it should.',
  inputs: [
    { name: 'page', label: 'Page', kind: 'page', required: true },
    { name: 'heading', label: 'Heading', kind: 'text', required: true },
  ],
  steps: [
    { action: 'go-to-page', params: { page: '{{input.page}}' } },
    {
      action: 'assert-visible',
      params: { target: { role: 'heading', name: '{{input.heading}}' } },
    },
  ],
};
