import type { Page } from 'playwright';
import { z } from 'zod';
import { AssertionFailure, AutomationError } from './scenario.js';
import { defineAction, type ActionRegistry, type PageSpec } from './registry.js';

/**
 * Page keys, routes and load markers ported from the legacy C# suite (PageUrlMapping, NavigationBar).
 * The current app may differ (for example `/operational-areas`); override via configuration.
 */
export const LEGACY_PAGES: Record<string, PageSpec> = {
  dashboard: { route: '/dashboard', marker: 'Welcome back,' },
  'operational-units': {
    route: '/operational-units',
    marker:
      'View all scopes in a hierarchical tree structure. Expand or collapse nodes to navigate the hierarchy.',
  },
};

async function expectVisible(page: Page, text: string, timeout: number): Promise<void> {
  const loc = page.getByText(text, { exact: false }).first();
  try {
    await loc.waitFor({ state: 'visible', timeout });
  } catch (e) {
    if (e instanceof Error && e.name === 'TimeoutError') {
      throw new AssertionFailure(`Expected text to be visible: "${text}"`, text, 'not visible');
    }
    throw e;
  }
}

const safePath = z
  .string()
  .regex(/^\/(?!\/)[^\s\\]*$/, 'Must be a same-origin path such as "/dashboard".');

export const appOpen = defineAction({
  name: 'app.open',
  description: 'Open a path on the configured base URL (same origin only).',
  source: 'verified',
  params: z.object({ path: safePath }),
  async run({ page, env }, { path }) {
    await page.goto(new URL(path, env.baseUrl).toString(), { timeout: env.timeoutMs });
  },
});

export const assertTextVisible = defineAction({
  name: 'assert.text-visible',
  description: 'Assert that text is visible on the current page.',
  source: 'verified',
  params: z.object({ text: z.string().min(1) }),
  async run({ page, env }, { text }) {
    await expectVisible(page, text, env.timeoutMs);
  },
});

export const authAssertSignedIn = defineAction({
  name: 'auth.assert-signed-in',
  description:
    'Assert the session is signed in (the welcome message is shown). Sign-in itself uses a saved Playwright storage state; credentials are never passed to actions.',
  source: 'legacy-csharp',
  params: z.object({}),
  async run({ page, env }) {
    const marker = env.pages['dashboard']?.marker;
    if (!marker) throw new AutomationError('No "dashboard" page marker is configured.');
    await expectVisible(page, marker, env.timeoutMs);
  },
});

export const navOpenPage = defineAction({
  name: 'nav.open-page',
  description: 'Open a page through the navigation bar and verify it loaded.',
  source: 'legacy-csharp',
  params: z.object({ page: z.string().min(1) }),
  async run({ page, env }, { page: key }) {
    const spec = env.pages[key];
    if (!spec) {
      throw new AutomationError(
        `Unknown page "${key}". Configured pages: ${Object.keys(env.pages).join(', ')}.`,
      );
    }
    await Promise.all([
      page.waitForURL(`**${spec.route}`, { timeout: env.timeoutMs }),
      page.locator('nav').locator(`a[href='${spec.route}']`).click({ timeout: env.timeoutMs }),
    ]);
    await expectVisible(page, spec.marker, env.timeoutMs);
  },
});

export const operationalUnitsView = defineAction({
  name: 'operational-units.view',
  description: 'Open the details of a named operational unit from the list.',
  source: 'legacy-csharp',
  params: z.object({ name: z.string().min(1) }),
  async run({ page, env }, { name }) {
    await page
      .getByRole('row', { name })
      .getByRole('button', { name: 'View' })
      .first()
      .click({ timeout: env.timeoutMs });
    await expectVisible(page, name, env.timeoutMs);
  },
});

export function registerAppActions(registry: ActionRegistry): ActionRegistry {
  return registry
    .register(appOpen)
    .register(assertTextVisible)
    .register(authAssertSignedIn)
    .register(navOpenPage)
    .register(operationalUnitsView);
}
