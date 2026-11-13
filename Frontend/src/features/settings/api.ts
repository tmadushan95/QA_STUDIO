/**
 * Requests of the Settings feature: execution settings, the page list, AI provider, clearing data with its backups,
 * and the audit trail. Secrets (API keys) are write-only: the server never sends them back.
 */
import { get, send, seg } from '../../shared/api/http.js';
import type { PageEntry } from '../../shared/api/catalog.js';

/** How runs sign in to the application under test. */
export type LoginStrategy = 'none' | 'login-form' | 'microsoft-sso' | 'saved-session';

/** The settings a person can change. */
export interface SettingsValues {
  envName: string;
  appUrl: string;
  browser: 'chromium' | 'firefox' | 'webkit';
  headless: boolean;
  slowMoMs: number;
  workers: number;
  timeoutMs: number;
  login: { strategy: LoginStrategy; path: string; signedInMarker: string };
}

/** The settings, with what is read-only about this install. */
export interface SettingsData {
  values: SettingsValues;
  allowedEnvs: string[];
  available: boolean;
  reason?: string;
  loginRequired: boolean;
  source: 'saved' | 'environment' | 'defaults';
  paths: {
    database: string;
    artifacts: string;
    scenarios: string;
    dashboard: string | null;
  };
  runtime: { node: string; platform: string; frameworkVersion: string };
  security: { accessTokenRequired: boolean; listening: string; destructiveAllowed?: boolean };
  notes: string[];
}

/** Read the settings. */
export const fetchSettings = () => get<SettingsData>('/api/settings');
/**
 * Save the execution settings. Only those are sent: the address and sign-in belong to projects now, and must not stand
 * in the way of saving these. Wrong fields come back as per-field errors.
 */
export const saveSettings = ({ browser, headless, slowMoMs, workers, timeoutMs }: SettingsValues) =>
  send<SettingsData>('/api/settings', { browser, headless, slowMoMs, workers, timeoutMs }, 'PUT');

/** Save the page list. */
/** Save the shared page list, or one project's own list (its pages win over shared ones with the same name). */
export async function savePages(pages: PageEntry[], projectId?: number): Promise<PageEntry[]> {
  const r = await send<{ items?: PageEntry[] }>(
    '/api/pages',
    { pages, ...(projectId ? { projectId } : {}) },
    'PUT',
  );
  return Array.isArray(r?.items) ? r.items : [];
}

/** The AI providers supported. */
export type AiProvider = 'anthropic' | 'gemini';
/** A provider as shown: its model and whether a key is set, never the key. */
export interface AiProviderView {
  model: string;
  hasKey: boolean;
  keySource: 'app' | 'environment' | 'none';
  suggestions: string[];
}
/** The AI settings. */
export interface AiData {
  provider: 'none' | AiProvider;
  anthropic: AiProviderView;
  gemini: AiProviderView;
  limits: { maxOutputTokens: number; maxCallsPerTask: number };
  ready: boolean;
  reason?: string;
}
/** Read the AI settings. */
export const fetchAi = () => get<AiData>('/api/ai');
/** Save changed AI settings. */
export const saveAi = (
  patch: Partial<{
    provider: AiData['provider'];
    anthropic: { model: string };
    gemini: { model: string };
    limits: Partial<AiData['limits']>;
  }>,
) => send<AiData>('/api/ai', patch, 'PUT');
/** Set a provider's key. It is write-only from here on. */
export const saveAiKey = (p: AiProvider, key: string) =>
  send<AiData>(`/api/ai/keys/${p}`, { key }, 'PUT');
/** Remove a provider's key. */
export const removeAiKey = (p: AiProvider) =>
  send<AiData>(`/api/ai/keys/${p}`, undefined, 'DELETE');
/** Check that a provider answers. */
export const testAi = (provider?: AiProvider) =>
  send<{ ok: boolean; message: string; ms: number }>('/api/ai/test', provider ? { provider } : {});

/** What "Clear all data" removed. */
export interface ClearResult {
  deletedCases: number;
  deletedRuns: number;
  deletedScenarios: number;
  deletedFiles: number;
  clearedValues: number;
  backupId?: string;
}
/** Clear test cases, and with them their steps and parameters unless told to keep them. */
export const clearAll = (o: { runs: boolean; scenarios: boolean; parameters: boolean }) =>
  send<ClearResult>(
    `/api/inventory?runs=${o.runs}&scenarios=${o.scenarios}&parameters=${o.parameters}`,
    undefined,
    'DELETE',
  );

/** A snapshot taken before clearing, as listed. */
export interface Backup {
  id: string;
  createdAt: string;
  reason: string;
  cases: number;
  scenarios: number;
  /** How many test cases had parameters in the snapshot. */
  parameterSets: number;
}
/** Snapshots still kept. */
export async function fetchBackups(): Promise<Backup[]> {
  const r = await get<{ items?: Backup[] }>('/api/backups');
  return Array.isArray(r?.items) ? r.items : [];
}
/** Put a snapshot's data back. Restoring adds; it deletes nothing. */
export const restoreBackup = (id: string) => send<Backup>(`/api/backups/${seg(id)}/restore`);

/** One entry of the audit log. */
export interface AuditEntry {
  id: number;
  at: string;
  action: string;
  target: string;
  detail: string;
}
/** The newest audit entries. */
export async function fetchAudit(): Promise<AuditEntry[]> {
  const r = await get<{ items?: AuditEntry[] }>('/api/audit');
  return Array.isArray(r?.items) ? r.items : [];
}
