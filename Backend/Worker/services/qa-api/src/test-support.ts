import type { AccountsProvider, SettingsProvider } from './app.js';
import { HttpError } from './errors.js';
import { buildFakeView } from './test-view.js';

/** A settings provider for tests: runs are available unless told otherwise. */
export function fakeSettings(
  over: Partial<ReturnType<SettingsProvider['runDefaults']>> & {
    reason?: string;
    available?: boolean;
  } = {},
): SettingsProvider {
  const { reason, available = reason === undefined, ...defaults } = over;
  const d = {
    environment: 'qa',
    browser: 'chromium',
    workers: 1,
    loginRequired: false,
    ...defaults,
  };
  return {
    view: () =>
      buildFakeView({
        available,
        ...(reason !== undefined && { reason }),
        loginRequired: d.loginRequired,
      }),
    update: () => buildFakeView({ available, loginRequired: d.loginRequired }),
    availability: () => ({ available, ...(reason !== undefined && { reason }) }),
    runDefaults: () => d,
  };
}

/** An accounts provider for tests, backed by a plain list. */
export function fakeAccounts(
  accounts: { id: string; label: string; projectId?: number }[] = [],
): AccountsProvider {
  return {
    list: () =>
      accounts.map((a) => ({
        projectId: 1,
        ...a,
        username: `${a.label}-user`,
        hasPassword: true,
      })),
    create: () => {
      throw new Error('not used');
    },
    update: () => {
      throw new Error('not used');
    },
    remove: () => undefined,
    refs: (ids) =>
      ids.map((id) => {
        const a = accounts.find((x) => x.id === id);
        if (!a)
          throw new HttpError(
            404,
            'unknown-account',
            'One of the chosen accounts no longer exists.',
          );
        return a;
      }),
    test: async () => ({ ok: true, message: 'ok' }),
  };
}
