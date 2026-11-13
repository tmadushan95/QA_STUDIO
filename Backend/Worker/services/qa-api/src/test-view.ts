import { DEFAULT_SETTINGS } from '@qa-studio/shared';
import type { SettingsView } from './settings.js';

export function buildFakeView(over: Partial<SettingsView> = {}): SettingsView {
  return {
    values: { ...DEFAULT_SETTINGS, envName: 'qa', appUrl: 'http://localhost:3000' },
    allowedEnvs: ['dev', 'qa', 'uat', 'staging'],
    available: true,
    loginRequired: false,
    source: 'saved',
    paths: { database: '/d', artifacts: '/a', scenarios: '/s', dashboard: null },
    runtime: { node: 'v24', platform: 'win32', frameworkVersion: '0.1.0' },
    security: { accessTokenRequired: false, listening: '127.0.0.1:4000' },
    notes: [],
    ...over,
  };
}
