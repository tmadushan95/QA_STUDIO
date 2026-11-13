export * from './types.js';
export * from './anthropic.js';
export * from './gemini.js';
export * from './fake.js';
export * from './gateway.js';
export type { FetchLike } from './http.js';

/** Defaults offered in Settings. Both are plain text fields there: model names change, so nothing is hard-wired. */
export const DEFAULT_MODELS = {
  anthropic: 'claude-sonnet-5-5',
  gemini: 'gemini-2.5-flash',
} as const;
