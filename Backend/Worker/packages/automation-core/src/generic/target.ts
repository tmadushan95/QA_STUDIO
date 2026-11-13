/**
 * Element targets for generic steps.
 *
 * A target describes an element the way a person or a screen reader would ("the button named Delete inside the
 * dialog"), never by CSS class or XPath. That keeps steps readable for testers and stable when an application is
 * restyled, and it is what lets one step library test any web application.
 */
import type { Locator, Page } from 'playwright';
import { z } from 'zod';

/** ARIA roles a target may name. Kept to the roles testers actually use, so the editor list stays short. */
export const TARGET_ROLES = [
  'button',
  'link',
  'textbox',
  'searchbox',
  'checkbox',
  'radio',
  'combobox',
  'option',
  'switch',
  'tab',
  'menuitem',
  'heading',
  'dialog',
  'alert',
  'row',
  'cell',
  'columnheader',
  'listitem',
  'img',
  'navigation',
  'region',
  'table',
] as const;
export type TargetRole = (typeof TARGET_ROLES)[number];

/** How to find the container a target sits in, for example "the row containing PRJ-001" or "the dialog". */
export const Scope = z
  .object({
    role: z.enum(TARGET_ROLES).optional(),
    name: z.string().min(1).optional(),
    text: z.string().min(1).optional(),
    testId: z.string().min(1).optional(),
  })
  .refine((s) => s.role || s.text || s.testId, 'Say which container: a role, a text or a test id.');
export type Scope = z.infer<typeof Scope>;

/**
 * One element. At least one way of finding it is required; when several are given the first in this order wins:
 * test id, role (with its accessible name), label, placeholder, text.
 */
export const Target = z
  .object({
    role: z.enum(TARGET_ROLES).optional(),
    /** Accessible name for `role`, such as a button's text. */
    name: z.string().min(1).optional(),
    /** Label of a form field. */
    label: z.string().min(1).optional(),
    placeholder: z.string().min(1).optional(),
    /** Visible text of any element. */
    text: z.string().min(1).optional(),
    /** A `data-testid` the application team added for hard-to-describe elements. */
    testId: z.string().min(1).optional(),
    /** Match the whole name or text instead of a part of it. */
    exact: z.boolean().optional(),
    within: Scope.optional(),
    /** Which match to use when several elements fit, counting from 0. Defaults to the first. */
    nth: z.number().int().min(0).max(500).optional(),
  })
  .refine(
    (t) => t.role || t.label || t.placeholder || t.text || t.testId,
    'Say how to find the element: a role, a label, a placeholder, a text or a test id.',
  );
export type Target = z.infer<typeof Target>;

type Root = Page | Locator;

function find(root: Root, t: Omit<Target, 'within' | 'nth'> | Scope): Locator {
  // Only pass `exact` when it was set, so Playwright keeps its default (a part of the text matches).
  const exact = 'exact' in t && t.exact !== undefined ? { exact: t.exact } : {};
  if (t.testId) return root.getByTestId(t.testId);
  if (t.role) return root.getByRole(t.role, { ...(t.name && { name: t.name }), ...exact });
  if ('label' in t && t.label) return root.getByLabel(t.label, exact);
  if ('placeholder' in t && t.placeholder) return root.getByPlaceholder(t.placeholder, exact);
  return root.getByText(t.text ?? '', exact);
}

/** Every element a target matches (ignoring `nth`), for counting. */
export function locateAll(page: Page, target: Omit<Target, 'nth'>): Locator {
  const { within, ...self } = target;
  let root: Root = page;
  if (within) {
    // A row "containing" some text: rows rarely have an accessible name, so match on their text instead.
    const scope = find(page, within);
    root = (within.text && within.role ? scope.filter({ hasText: within.text }) : scope).first();
  }
  return find(root, self);
}

/** Turn a target into a Playwright locator. Every match narrows to one element, the first unless `nth` is set. */
export function locate(page: Page, target: Target): Locator {
  const all = locateAll(page, target);
  return target.nth === undefined ? all.first() : all.nth(target.nth);
}

/** A short human description of a target for reports and failure messages, e.g. `button "Delete" in dialog`. */
export function describeTarget(t: Target): string {
  const what = t.testId
    ? `test id "${t.testId}"`
    : t.role
      ? `${t.role}${t.name ? ` "${t.name}"` : ''}`
      : t.label
        ? `field "${t.label}"`
        : t.placeholder
          ? `field with placeholder "${t.placeholder}"`
          : `text "${t.text}"`;
  const where = t.within
    ? ` in ${t.within.role ?? 'element'}${t.within.name ? ` "${t.within.name}"` : ''}${t.within.text ? ` containing "${t.within.text}"` : ''}`
    : '';
  return `${what}${where}${t.nth ? ` (match ${t.nth + 1})` : ''}`;
}
