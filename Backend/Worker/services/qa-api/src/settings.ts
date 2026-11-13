import type { AppSettings } from '@qa-studio/shared';

/** Everything the Settings screen needs. Contains no secrets: accounts are listed separately, without passwords. */
export interface SettingsView {
  /** The current values, for the form. They may not be valid yet (for example before the app address is entered). */
  values: AppSettings;
  allowedEnvs: string[];
  /** Whether runs can start with these settings, and if not, why. */
  available: boolean;
  reason?: string;
  /** True when tests must sign in, so a run needs at least one chosen account. */
  loginRequired: boolean;
  source: 'saved' | 'environment' | 'defaults';
  paths: {
    database: string;
    artifacts: string;
    scenarios: string;
    dashboard: string | null;
  };
  runtime: { node: string; platform: string; frameworkVersion: string };
  security: {
    /** The API needs an access token (QA_ADMIN_TOKEN). */
    accessTokenRequired: boolean;
    /** Where the API is listening, for example 127.0.0.1:4000. */
    listening: string;
    /** Steps that delete data may run (QA_ALLOW_DESTRUCTIVE). Read from the environment only. */
    destructiveAllowed?: boolean;
  };
  notes: string[];
}

export const SETTINGS_NOTES = [
  'Settings and test accounts are saved by the app. Passwords are encrypted and are never shown again.',
  'Each project has its own application address, sign-in method and test accounts (Project settings).',
  "Runs are refused unless the project's environment is on the allow-list (set by QA_ALLOWED_ENVS) and its address does not look like production.",
  'Each test case opens its own browser, signs in as the chosen account, then runs. Turn on "Show the browser" to watch it happen.',
];
