import { createRequire } from 'node:module';

/**
 * `node:sqlite` loaded through `require`: bundlers and test runners that do not know this built-in yet
 * (Vitest 2) cannot resolve a static ESM import of it. Types still come from the real module.
 */
export const DatabaseSync: typeof import('node:sqlite').DatabaseSync = createRequire(
  import.meta.url,
)('node:sqlite').DatabaseSync;
export type DatabaseSync = InstanceType<typeof DatabaseSync>;
