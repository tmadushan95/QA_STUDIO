import { z } from 'zod';

export const BROWSERS = ['chromium', 'firefox', 'webkit'] as const;
export type BrowserName = (typeof BROWSERS)[number];

/**
 * How the tests sign in to the web app under test.
 * - none: the app needs no sign-in.
 * - login-form: a username/password form on the login page.
 * - microsoft-sso: a "Sign in with Microsoft" button that opens a popup (the flow the legacy suite used).
 */
export const LOGIN_STRATEGIES = ['none', 'login-form', 'microsoft-sso', 'saved-session'] as const;
export type LoginStrategy = (typeof LOGIN_STRATEGIES)[number];

/** Settings a QA engineer can change in the app. Contains no secrets: accounts are stored separately. */
export interface AppSettings {
  /** Environment name; must be on the allow-list. */
  envName: string;
  /** Address of the web app under test. No API address is needed. */
  appUrl: string;
  browser: BrowserName;
  /** false = show the browser window while tests run. */
  headless: boolean;
  /** Delay in ms added to each browser action so a person can follow along. */
  slowMoMs: number;
  /** How many browser windows may be open at once. */
  workers: number;
  timeoutMs: number;
  login: {
    strategy: LoginStrategy;
    /** Same-site path of the login page, such as /login. */
    path: string;
    /** Text that appears once signed in, such as "Welcome back,". */
    signedInMarker: string;
  };
}

/** What belongs to one project rather than to the install: where its application runs and how runs sign in to it. */
export type ProjectConnection = Pick<AppSettings, 'envName' | 'appUrl' | 'login'>;

export const DEFAULT_ALLOWED_ENVS = ['dev', 'qa', 'uat', 'staging'];

export const DEFAULT_SETTINGS: AppSettings = {
  envName: '',
  appUrl: '',
  browser: 'chromium',
  headless: false,
  slowMoMs: 0,
  workers: 1,
  timeoutMs: 60000,
  login: { strategy: 'microsoft-sso', path: '/login', signedInMarker: 'Welcome back,' },
};

export interface SettingsIssue {
  /** Dotted field path, for example "login.path". */
  path: string;
  message: string;
}

export class ConfigError extends Error {
  override name = 'ConfigError';
  constructor(
    message: string,
    readonly issues: SettingsIssue[] = [],
  ) {
    super(message);
  }
}

const SettingsSchema = z.object({
  envName: z.string().trim().min(1, 'Choose an environment.'),
  appUrl: z
    .string()
    .trim()
    .min(1, 'Enter the address of the web app under test.')
    .url('Enter a full address such as https://app-qa.example.com.'),
  browser: z.enum(BROWSERS, { message: 'Choose chromium, firefox or webkit.' }),
  headless: z.boolean({ message: 'Choose whether to show the browser.' }),
  slowMoMs: z
    .number({ message: 'Enter a number of milliseconds.' })
    .int()
    .min(0, 'Use 0 or more.')
    .max(2000, 'Use 2000 ms or less.'),
  workers: z
    .number({ message: 'Enter a number.' })
    .int()
    .min(1, 'Use at least 1.')
    .max(16, 'Use 16 or fewer.'),
  timeoutMs: z
    .number({ message: 'Enter a number of milliseconds.' })
    .int()
    .min(1000, 'Use at least 1000 ms.')
    .max(600000, 'Use 600000 ms or less.'),
  login: z.object({
    strategy: z.enum(LOGIN_STRATEGIES, { message: 'Choose a sign-in method.' }),
    path: z.string().regex(/^\/(?!\/)[^\s\\]*$/, 'Use a path on the same site, such as /login.'),
    signedInMarker: z.string().trim().max(200, 'Use 200 characters or fewer.'),
  }),
});

const ExecutionSchema = SettingsSchema.pick({
  browser: true,
  headless: true,
  slowMoMs: true,
  workers: true,
  timeoutMs: true,
});

const PROD_LIKE = /(^|[.-])(prod|production|live)([.-]|$)/i;

/**
 * Validate settings. Refuses environments that are not on the allow-list, and addresses that look like
 * production or carry credentials. Throws a ConfigError whose `issues` map to form fields.
 */
export function parseSettings(
  raw: unknown,
  allowedEnvs: string[] = DEFAULT_ALLOWED_ENVS,
): AppSettings {
  const parsed = SettingsSchema.safeParse(raw);
  const issues: SettingsIssue[] = parsed.success
    ? []
    : parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
  if (!parsed.success) throw fail(issues);

  const s = parsed.data;
  const envName = s.envName.toLowerCase();
  if (!allowedEnvs.includes(envName)) {
    issues.push({
      path: 'envName',
      message: `"${envName}" is not an allowed environment (${allowedEnvs.join(', ')}).`,
    });
  }
  const url = new URL(s.appUrl);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    issues.push({ path: 'appUrl', message: 'Use an http or https address.' });
  } else if (url.username || url.password) {
    issues.push({
      path: 'appUrl',
      message: 'Do not put a username or password in the address. Add a test account instead.',
    });
  } else if (PROD_LIKE.test(url.hostname)) {
    issues.push({
      path: 'appUrl',
      message: `Refusing to test a production-looking address (${url.hostname}).`,
    });
  }
  if (issues.length > 0) throw fail(issues);

  return { ...s, envName, appUrl: s.appUrl.replace(/\/+$/, '') };
}

/** Validate one project's connection, by the same rules as `parseSettings`. Issues map to form fields. */
export function parseProjectConnection(
  raw: unknown,
  allowedEnvs: string[] = DEFAULT_ALLOWED_ENVS,
): ProjectConnection {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<ProjectConnection>;
  const { envName, appUrl, login } = parseSettings(
    {
      ...DEFAULT_SETTINGS,
      envName: r.envName ?? '',
      appUrl: r.appUrl ?? '',
      login: r.login ?? DEFAULT_SETTINGS.login,
    },
    allowedEnvs,
  );
  return { envName, appUrl, login };
}

/** Validate only what applies to the whole install, which needs no project to be set up yet. */
export function parseExecutionSettings(settings: AppSettings): AppSettings {
  const parsed = ExecutionSchema.safeParse(settings);
  if (parsed.success) return { ...settings, ...parsed.data };
  throw fail(parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
}

function fail(issues: SettingsIssue[]): ConfigError {
  return new ConfigError(issues.map((i) => i.message).join(' '), issues);
}

const num = (v: string | undefined): number | undefined => {
  if (v === undefined || v.trim() === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

/** Allowed environments come from the environment only, so they cannot be widened from the browser. */
export function allowedEnvsFromEnv(env: Record<string, string | undefined>): string[] {
  const list = (env['QA_ALLOWED_ENVS'] ?? '')
    .split(',')
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
  return list.length > 0 ? list : DEFAULT_ALLOWED_ENVS;
}

/** Initial values from environment variables. Missing or unreadable values are simply left out; nothing throws. */
export function settingsFromEnv(env: Record<string, string | undefined>): DeepPartial<AppSettings> {
  const out: DeepPartial<AppSettings> = {};
  const set = <K extends keyof AppSettings>(k: K, v: AppSettings[K] | undefined) => {
    if (v !== undefined) out[k] = v as never;
  };
  set('envName', env['QA_ENV_NAME']?.trim().toLowerCase() || undefined);
  set('appUrl', (env['QA_APP_URL'] ?? env['QA_BASE_URL'])?.trim() || undefined);
  const browser = env['QA_BROWSER'];
  set(
    'browser',
    (BROWSERS as readonly string[]).includes(browser ?? '') ? (browser as BrowserName) : undefined,
  );
  const headless = env['QA_HEADLESS'];
  set('headless', headless === 'true' ? true : headless === 'false' ? false : undefined);
  set('slowMoMs', num(env['QA_SLOW_MO_MS']));
  set('workers', num(env['QA_WORKERS']));
  set('timeoutMs', num(env['QA_TIMEOUT_MS']));
  const strategy = env['QA_LOGIN_STRATEGY'];
  const login: DeepPartial<AppSettings['login']> = {};
  if ((LOGIN_STRATEGIES as readonly string[]).includes(strategy ?? ''))
    login.strategy = strategy as LoginStrategy;
  if (env['QA_LOGIN_PATH']) login.path = env['QA_LOGIN_PATH'];
  if (env['QA_SIGNED_IN_MARKER']) login.signedInMarker = env['QA_SIGNED_IN_MARKER'];
  if (Object.keys(login).length > 0) out.login = login;
  return out;
}

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

/** Layer partial settings over the defaults, one level deep for `login`. Later layers win. */
export function mergeSettings(...layers: (DeepPartial<AppSettings> | undefined)[]): AppSettings {
  let merged: AppSettings = { ...DEFAULT_SETTINGS, login: { ...DEFAULT_SETTINGS.login } };
  for (const layer of layers) {
    if (!layer) continue;
    const { login, ...rest } = layer;
    merged = {
      ...merged,
      ...(rest as Partial<AppSettings>),
      login: { ...merged.login, ...(login as Partial<AppSettings['login']>) },
    };
  }
  return merged;
}
