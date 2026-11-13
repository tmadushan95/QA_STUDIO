import {
  allowedEnvsFromEnv,
  mergeSettings,
  parseExecutionSettings,
  parseSettings,
  settingsFromEnv,
  ConfigError,
  type AppSettings,
  type DeepPartial,
} from '@qa-studio/shared';
import { HttpError } from './errors.js';
import { SETTINGS_NOTES, type SettingsView } from './settings.js';

export interface SettingsStore {
  loadSettings(): unknown;
  saveSettings(settings: unknown): void;
}

export interface SettingsServiceDeps {
  store: SettingsStore;
  env: Record<string, string | undefined>;
  audit(action: string, target: string, detail: string): void;
  info: Pick<SettingsView, 'paths' | 'runtime' | 'security'>;
}

const EDITABLE = [
  'envName',
  'appUrl',
  'browser',
  'headless',
  'slowMoMs',
  'workers',
  'timeoutMs',
  'login',
] as const;
const LOGIN_FIELDS = ['strategy', 'path', 'signedInMarker'] as const;

/** Reduce an arbitrary request body to the editable fields only. */
function pick(input: unknown): DeepPartial<AppSettings> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new HttpError(400, 'invalid-settings', 'Send the settings as a JSON object.');
  }
  const src = input as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of EDITABLE) if (k !== 'login' && k in src) out[k] = src[k];
  const login = src['login'];
  if (typeof login === 'object' && login !== null) {
    const l: Record<string, unknown> = {};
    for (const k of LOGIN_FIELDS)
      if (k in (login as object)) l[k] = (login as Record<string, unknown>)[k];
    out['login'] = l;
  }
  return out as DeepPartial<AppSettings>;
}

/**
 * The settings the QA engineer edits in the app. Layers: built-in defaults, then .env values, then values saved in
 * the app (which win). The environment allow-list is read from the environment only, so it cannot be widened here.
 */
export class SettingsService {
  private saved: DeepPartial<AppSettings> | undefined;
  private readonly allowedEnvs: string[];

  constructor(private readonly d: SettingsServiceDeps) {
    const stored = d.store.loadSettings();
    this.saved =
      typeof stored === 'object' && stored !== null
        ? (stored as DeepPartial<AppSettings>)
        : undefined;
    this.allowedEnvs = allowedEnvsFromEnv(d.env);
  }

  /** Current values, valid or not. */
  values(): AppSettings {
    return mergeSettings(settingsFromEnv(this.d.env), this.saved);
  }

  /** Current values, validated. Throws a ConfigError saying what to fix. Used by the executor for every case. */
  current(): AppSettings {
    try {
      return parseSettings(this.values(), this.allowedEnvs);
    } catch (e) {
      if (e instanceof ConfigError && !this.values().appUrl) {
        throw new ConfigError(
          'Enter the app address and choose an environment in Settings, then try again.',
          e.issues,
        );
      }
      throw e;
    }
  }

  availability(): { available: boolean; reason?: string } {
    try {
      this.current();
      return { available: true };
    } catch (e) {
      return {
        available: false,
        reason: e instanceof Error ? e.message : 'Settings are not valid.',
      };
    }
  }

  runDefaults(): { environment: string; browser: string; workers: number; loginRequired: boolean } {
    const v = this.values();
    return {
      environment: v.envName,
      browser: v.browser,
      workers: v.workers,
      loginRequired: v.login.strategy !== 'none',
    };
  }

  view(): SettingsView {
    const a = this.availability();
    const v = this.values();
    return {
      values: v,
      allowedEnvs: this.allowedEnvs,
      available: a.available,
      ...(a.reason !== undefined && { reason: a.reason }),
      loginRequired: v.login.strategy !== 'none',
      source: this.saved
        ? 'saved'
        : Object.keys(settingsFromEnv(this.d.env)).length > 0
          ? 'environment'
          : 'defaults',
      ...this.d.info,
      notes: SETTINGS_NOTES,
    };
  }

  /** Validate and save changes. Rejects the whole change if any field is wrong, naming each field. */
  update(patch: unknown): SettingsView {
    const change = pick(patch);
    const before = this.values();
    const merged = mergeSettings(settingsFromEnv(this.d.env), this.saved, change);
    try {
      // Addresses and sign-in now belong to projects, so saving execution options must not depend on them being set.
      const touchesTarget = 'appUrl' in change || 'envName' in change || 'login' in change;
      const valid = touchesTarget
        ? parseSettings(merged, this.allowedEnvs)
        : parseExecutionSettings(merged);
      this.saved = valid;
      this.d.store.saveSettings(valid);
      const diff = Object.keys(change).flatMap((k) => {
        const now = JSON.stringify((valid as unknown as Record<string, unknown>)[k]);
        return now === JSON.stringify((before as unknown as Record<string, unknown>)[k]) ? [] : [k];
      });
      // A save that changes nothing is not worth a history entry.
      if (diff.length > 0)
        this.d.audit('settings.update', 'settings', `Changed: ${diff.join(', ')}.`);
      return this.view();
    } catch (e) {
      if (e instanceof ConfigError) {
        const fields = Object.fromEntries(e.issues.map((i) => [i.path, i.message]));
        throw new HttpError(400, 'invalid-settings', e.message, fields);
      }
      throw e;
    }
  }
}
