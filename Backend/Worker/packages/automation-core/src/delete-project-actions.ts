import type { Locator, Page } from 'playwright';
import { z } from 'zod';
import { AssertionFailure, AutomationError } from './scenario.js';
import { defineAction, type ActionContext, type ActionRegistry } from './registry.js';

/**
 * Delete-project actions. Written from the target application's web client source (DeleteProjectAction, the draft list
 * pages and routeTree), not yet run against a real environment: they are marked `app-source`, not `verified`.
 */

const LISTS = {
  draft: { route: '/projects/draft-list', title: 'Draft Projects' },
  lrp: { route: '/lrp/draft-list', title: 'Draft Long Range Plans' },
  clubbed: { route: '/clubbed/draft-list', title: undefined },
  // Not Draft lists, so a project cannot be opened for editing from them; used to check a code is absent.
  open: { route: '/open-projects', title: undefined },
  mine: { route: '/my-projects', title: undefined },
} as const;
type ListKey = keyof typeof LISTS;
const draftListKey = z.enum(['draft', 'lrp', 'clubbed']);
const anyListKey = z.enum(['draft', 'lrp', 'clubbed', 'open', 'mine']);

/** Same text as DeleteProjectAction.getDeleteConfirmationMessage. */
function confirmationText(kind: 'individual' | 'linked' | 'lrp', clubbedCode?: string): string {
  if (kind === 'lrp') {
    return 'Are you sure you want to delete this LRP? This action will permanently remove the project from the system and cannot be undone.';
  }
  if (kind === 'linked') {
    return `Are you sure you want to delete this project? The project is linked to parent project ${clubbedCode}. Deleting it will unlink the project and permanently remove it from the system and cannot be undone.`;
  }
  return 'Are you sure you want to delete this project? This action will permanently remove the project from the system and cannot be undone.';
}

const dialog = (page: Page): Locator => page.getByRole('alertdialog').or(page.getByRole('dialog'));
const deleteButton = (page: Page): Locator =>
  page.getByRole('button', { name: 'Delete', exact: true });
const EDIT_PAGE = /\/(draft|resubmit)(\?|$)/;

async function settle(page: Page, timeout: number): Promise<void> {
  // The lists and pages fetch after load; "idle" is the nearest signal there is.
  await page.waitForLoadState('networkidle', { timeout }).catch(() => undefined);
}

async function searchList(ctx: ActionContext, list: ListKey, code: string): Promise<Locator> {
  const { page, env } = ctx;
  const spec = LISTS[list];
  await page.goto(new URL(spec.route, env.baseUrl).toString(), { timeout: env.timeoutMs });
  const search = page.getByRole('searchbox').first();
  try {
    await search.waitFor({ state: 'visible', timeout: env.timeoutMs });
  } catch {
    throw new AssertionFailure(
      `The ${list} draft list did not load${spec.title ? ` (expected the heading "${spec.title}")` : ''}.`,
      spec.route,
      page.url(),
    );
  }
  await search.fill(code);
  // The list debounces the search by 300 ms before it asks the server.
  await page.waitForTimeout(500);
  await settle(page, env.timeoutMs);
  return page.getByRole('row').filter({ hasText: code });
}

export const draftsOpenProject = defineAction({
  name: 'drafts.open-project',
  description:
    'Find a project by its code in a Draft list (project, LRP or clubbed) and open it. A Rejected project opens its resubmit page.',
  source: 'app-source',
  params: z.object({ list: draftListKey, code: z.string().min(1) }),
  async run(ctx, { list, code }) {
    const rows = await searchList(ctx, list, code);
    if ((await rows.count()) === 0) {
      throw new AssertionFailure(
        `Project ${code} is not in the ${list} Draft list.`,
        `${code} listed`,
        'not listed',
      );
    }
    await rows.first().click({ timeout: ctx.env.timeoutMs });
    await ctx.page.waitForURL(EDIT_PAGE, { timeout: ctx.env.timeoutMs });
    await settle(ctx.page, ctx.env.timeoutMs);
    ctx.vars['projectUrl'] = ctx.page.url();
    ctx.vars['projectCode'] = code;
    ctx.vars['list'] = list;
  },
});

export const draftsAssertListed = defineAction({
  name: 'drafts.assert-listed',
  description:
    'Assert whether a project code appears in a list (Draft project/LRP/clubbed, Open projects or My projects).',
  source: 'app-source',
  params: z.object({ list: anyListKey, code: z.string().min(1), listed: z.boolean() }),
  async run(ctx, { list, code, listed }) {
    const count = await (await searchList(ctx, list, code)).count();
    if (listed && count === 0) {
      throw new AssertionFailure(
        `${code} is missing from the ${list} Draft list.`,
        'listed',
        'not listed',
      );
    }
    if (!listed && count > 0) {
      throw new AssertionFailure(
        `${code} is still in the ${list} Draft list.`,
        'not listed',
        'listed',
      );
    }
  },
});

export const projectAssertDeleteButton = defineAction({
  name: 'project.assert-delete-button',
  description:
    'On the open Draft/Rejected project page, assert the Delete button is shown or not shown.',
  source: 'app-source',
  params: z.object({ visible: z.boolean() }),
  async run({ page, env }, { visible }) {
    await settle(page, env.timeoutMs);
    const button = deleteButton(page);
    if (visible) {
      try {
        await button.first().waitFor({ state: 'visible', timeout: env.timeoutMs });
      } catch {
        throw new AssertionFailure(
          'The Delete button is not shown.',
          'Delete button shown',
          'not shown',
        );
      }
      if (await button.first().isDisabled()) {
        throw new AssertionFailure('The Delete button is disabled.', 'enabled', 'disabled');
      }
    } else if ((await button.count()) > 0) {
      throw new AssertionFailure(
        'The Delete button is shown.',
        'no Delete button',
        'Delete button shown',
      );
    }
  },
});

export const projectClickDelete = defineAction({
  name: 'project.click-delete',
  description:
    'Click Delete on the open project page. This only opens the confirmation; nothing is deleted yet.',
  source: 'app-source',
  params: z.object({}),
  async run({ page, env }) {
    await deleteButton(page).first().click({ timeout: env.timeoutMs });
  },
});

export const projectAssertDeleteDialog = defineAction({
  name: 'project.assert-delete-dialog',
  description:
    'Assert the delete confirmation: title "Delete Project?", the message for this kind of project, and the Confirm and Cancel buttons.',
  source: 'app-source',
  params: z
    .object({
      kind: z.enum(['individual', 'linked', 'lrp']),
      clubbedCode: z.string().min(1).optional(),
    })
    .refine((p) => p.kind !== 'linked' || p.clubbedCode, {
      message: 'clubbedCode is required when kind is "linked".',
      path: ['clubbedCode'],
    }),
  async run({ page, env }, { kind, clubbedCode }) {
    const box = dialog(page).first();
    try {
      await box.waitFor({ state: 'visible', timeout: env.timeoutMs });
    } catch {
      throw new AssertionFailure(
        'The delete confirmation did not open.',
        'dialog shown',
        'no dialog',
      );
    }
    const expected = confirmationText(kind, clubbedCode);
    const actual = ((await box.innerText()) || '').replace(/\s+/g, ' ').trim();
    for (const want of ['Delete Project?', expected]) {
      if (!actual.includes(want)) {
        throw new AssertionFailure('The delete confirmation text is different.', want, actual);
      }
    }
    for (const name of ['Confirm', 'Cancel']) {
      if ((await box.getByRole('button', { name, exact: true }).count()) === 0) {
        throw new AssertionFailure(`The delete confirmation has no ${name} button.`, name, actual);
      }
    }
  },
});

export const projectCancelDelete = defineAction({
  name: 'project.cancel-delete',
  description:
    'Click Cancel in the delete confirmation and assert it closes and the page stays on the project.',
  source: 'app-source',
  params: z.object({}),
  async run({ page, env, vars }) {
    const box = dialog(page).first();
    await box
      .getByRole('button', { name: 'Cancel', exact: true })
      .click({ timeout: env.timeoutMs });
    try {
      await box.waitFor({ state: 'hidden', timeout: env.timeoutMs });
    } catch {
      throw new AssertionFailure(
        'The dialog stayed open after Cancel.',
        'dialog closed',
        'dialog open',
      );
    }
    if (vars['projectUrl'] && !EDIT_PAGE.test(page.url())) {
      throw new AssertionFailure('Cancel left the project page.', vars['projectUrl'], page.url());
    }
  },
});

export const projectConfirmDelete = defineAction({
  name: 'project.confirm-delete',
  description:
    'Click Confirm in the delete confirmation. THIS DELETES THE PROJECT. Waits for the success message and for the page to return to the list.',
  source: 'app-source',
  destructive: true,
  params: z.object({ lrp: z.boolean().default(false) }),
  async run({ page, env }, { lrp }) {
    const box = dialog(page).first();
    await box
      .getByRole('button', { name: 'Confirm', exact: true })
      .click({ timeout: env.timeoutMs });
    const message = lrp ? 'LRP deleted successfully.' : 'Project deleted successfully.';
    try {
      await page
        .getByText(message, { exact: false })
        .first()
        .waitFor({ state: 'visible', timeout: env.timeoutMs });
    } catch {
      throw new AssertionFailure(
        `The success message "${message}" did not appear.`,
        message,
        'not shown',
      );
    }
    try {
      await page.waitForURL((u) => !EDIT_PAGE.test(u.toString()), { timeout: env.timeoutMs });
    } catch {
      throw new AssertionFailure(
        'The page did not return to the list after deleting.',
        'list page',
        page.url(),
      );
    }
  },
});

export const projectAssertGone = defineAction({
  name: 'project.assert-gone',
  description:
    'Open the address of the project opened earlier in this case and assert it is no longer available (the app returns to a list).',
  source: 'app-source',
  params: z.object({}),
  async run({ page, env, vars }) {
    const url = vars['projectUrl'];
    if (!url)
      throw new AutomationError(
        'No project was opened earlier in this case (use drafts.open-project first).',
      );
    await page.goto(url, { timeout: env.timeoutMs });
    try {
      await page.waitForURL((u) => !EDIT_PAGE.test(u.toString()), { timeout: env.timeoutMs });
    } catch {
      throw new AssertionFailure(
        'The deleted project can still be opened.',
        'not available',
        page.url(),
      );
    }
  },
});

export const projectConfirmDeleteExpectError = defineAction({
  name: 'project.confirm-delete-expect-error',
  description:
    'Click Confirm in the delete confirmation and assert the app REFUSES, showing the given message, and stays on the project. If the app deletes instead, the case fails. Still counts as destructive: a faulty app would delete.',
  source: 'app-source',
  destructive: true,
  params: z.object({ message: z.string().min(1) }),
  async run({ page, env }, { message }) {
    const box = dialog(page).first();
    await box
      .getByRole('button', { name: 'Confirm', exact: true })
      .click({ timeout: env.timeoutMs });
    try {
      await page
        .getByText(message, { exact: false })
        .first()
        .waitFor({ state: 'visible', timeout: env.timeoutMs });
    } catch {
      // A real delete shows the success message and then leaves the page, so either is proof.
      const deleted =
        (await page.getByText(/deleted successfully/i).count()) +
        (EDIT_PAGE.test(page.url()) ? 0 : 1);
      throw new AssertionFailure(
        deleted > 0
          ? 'The app deleted the project, but it should have refused.'
          : `The message "${message}" did not appear.`,
        message,
        deleted > 0 ? 'deleted successfully' : 'not shown',
      );
    }
    if (!EDIT_PAGE.test(page.url())) {
      throw new AssertionFailure(
        'The app left the project page after a refused delete.',
        'stay on project',
        page.url(),
      );
    }
  },
});

export const projectsOpenFromList = defineAction({
  name: 'projects.open-from-list',
  description:
    'Find a project by its code in Open projects or My projects and open its page (not an edit page, so a non-Draft project).',
  source: 'app-source',
  params: z.object({ list: z.enum(['open', 'mine']), code: z.string().min(1) }),
  async run(ctx, { list, code }) {
    const rows = await searchList(ctx, list, code);
    if ((await rows.count()) === 0) {
      throw new AssertionFailure(
        `Project ${code} is not in the ${list} list.`,
        `${code} listed`,
        'not listed',
      );
    }
    await rows.first().click({ timeout: ctx.env.timeoutMs });
    await ctx.page.waitForURL(/\/(projects|lrp)\/[^/?]+/, { timeout: ctx.env.timeoutMs });
    await settle(ctx.page, ctx.env.timeoutMs);
    ctx.vars['projectUrl'] = ctx.page.url();
    ctx.vars['projectCode'] = code;
  },
});

export const rolesAssertPermission = defineAction({
  name: 'roles.assert-permission',
  description:
    'On Roles and permissions, expand a role and assert a permission is listed under its resource heading, with its description. Changes nothing.',
  source: 'app-source',
  params: z.object({
    role: z.string().min(1),
    resource: z.string().min(1),
    action: z.string().min(1),
    description: z.string().min(1).optional(),
  }),
  async run({ page, env }, { role, resource, action, description }) {
    await page.goto(new URL('/roles-and-permissions', env.baseUrl).toString(), {
      timeout: env.timeoutMs,
    });
    const card = page.locator('[data-role-id]').filter({ hasText: role }).first();
    try {
      await card.waitFor({ state: 'visible', timeout: env.timeoutMs });
    } catch {
      throw new AssertionFailure(`The role "${role}" is not listed.`, role, 'not listed');
    }
    await card
      .getByRole('button', { name: 'Expand', exact: true })
      .click({ timeout: env.timeoutMs });
    const group = card.locator('h4', { hasText: resource }).locator('xpath=..');
    const item = group.locator('div.rounded-lg').filter({ hasText: action });
    const wanted = description ? item.filter({ hasText: description }) : item;
    if ((await wanted.count()) === 0) {
      throw new AssertionFailure(
        `Role "${role}" has no "${action}" permission under "${resource}"${description ? ' with that description' : ''}.`,
        `${resource} › ${action}`,
        'not listed',
      );
    }
  },
});

const rowTexts = async (page: Page): Promise<string[]> =>
  (await page.getByRole('row').allInnerTexts())
    .map((t) => t.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

export const clubbedRememberChildren = defineAction({
  name: 'clubbed.remember-children',
  description:
    'Open a clubbed project from the clubbed Draft list and remember its children (their row text) for a later comparison.',
  source: 'app-source',
  params: z.object({ code: z.string().min(1) }),
  async run(ctx, { code }) {
    const rows = await searchList(ctx, 'clubbed', code);
    if ((await rows.count()) === 0) {
      throw new AssertionFailure(
        `Clubbed project ${code} is not in the clubbed Draft list.`,
        `${code} listed`,
        'not listed',
      );
    }
    await rows.first().click({ timeout: ctx.env.timeoutMs });
    await ctx.page.waitForURL(/\/clubbed\/[^/?]+/, { timeout: ctx.env.timeoutMs });
    const id = /\/clubbed\/([^/?]+)/.exec(ctx.page.url())?.[1];
    if (!id || id === 'draft-list')
      throw new AssertionFailure(
        'Could not open the clubbed project.',
        'clubbed page',
        ctx.page.url(),
      );
    const children = new URL(`/clubbed/${id}/children`, ctx.env.baseUrl).toString();
    await ctx.page.goto(children, { timeout: ctx.env.timeoutMs });
    await settle(ctx.page, ctx.env.timeoutMs);
    const before = await rowTexts(ctx.page);
    if (before.length < 2) {
      throw new AssertionFailure(
        `Clubbed project ${code} lists too few children to compare (found ${Math.max(0, before.length - 1)}).`,
        'at least 1 child',
        String(before.length),
      );
    }
    ctx.vars['childrenUrl'] = children;
    ctx.vars['childrenBefore'] = JSON.stringify(before);
  },
});

export const clubbedAssertChildrenUnchanged = defineAction({
  name: 'clubbed.assert-children-unchanged',
  description:
    'Reopen the clubbed project remembered earlier and assert the deleted child is gone while every other child row is exactly as before.',
  source: 'app-source',
  params: z.object({ deletedCode: z.string().min(1) }),
  async run(ctx, { deletedCode }) {
    const url = ctx.vars['childrenUrl'];
    const raw = ctx.vars['childrenBefore'];
    if (!url || !raw)
      throw new AutomationError(
        'No children were remembered (use clubbed.remember-children first).',
      );
    await ctx.page.goto(url, { timeout: ctx.env.timeoutMs });
    await settle(ctx.page, ctx.env.timeoutMs);
    const after = await rowTexts(ctx.page);
    if (after.some((r) => r.includes(deletedCode))) {
      throw new AssertionFailure(
        `${deletedCode} is still listed under the clubbed project.`,
        'not listed',
        'listed',
      );
    }
    const expected = (JSON.parse(raw) as string[]).filter((r) => !r.includes(deletedCode));
    const changed = expected.filter((r) => !after.includes(r));
    if (changed.length > 0) {
      throw new AssertionFailure(
        `${changed.length} remaining child row(s) are different after the delete.`,
        changed.join(' | '),
        after.join(' | '),
      );
    }
  },
});

export function registerDeleteProjectActions(registry: ActionRegistry): ActionRegistry {
  return registry
    .register(projectConfirmDeleteExpectError)
    .register(projectsOpenFromList)
    .register(rolesAssertPermission)
    .register(clubbedRememberChildren)
    .register(clubbedAssertChildrenUnchanged)
    .register(draftsOpenProject)
    .register(draftsAssertListed)
    .register(projectAssertDeleteButton)
    .register(projectClickDelete)
    .register(projectAssertDeleteDialog)
    .register(projectCancelDelete)
    .register(projectConfirmDelete)
    .register(projectAssertGone);
}
