import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@qa-studio/agents': fileURLToPath(
        new URL('./packages/agents/src/index.ts', import.meta.url),
      ),
      '@qa-studio/llm': fileURLToPath(new URL('./packages/llm/src/index.ts', import.meta.url)),
      '@qa-studio/knowledge': fileURLToPath(
        new URL('./packages/knowledge/src/index.ts', import.meta.url),
      ),
      '@qa-studio/reporting': fileURLToPath(
        new URL('./packages/reporting/src/index.ts', import.meta.url),
      ),
      '@qa-studio/execution-engine': fileURLToPath(
        new URL('./packages/execution-engine/src/index.ts', import.meta.url),
      ),
      '@qa-studio/automation-core': fileURLToPath(
        new URL('./packages/automation-core/src/index.ts', import.meta.url),
      ),
      '@qa-studio/test-case-import': fileURLToPath(
        new URL('./packages/test-case-import/src/index.ts', import.meta.url),
      ),
      '@qa-studio/shared': fileURLToPath(
        new URL('./packages/shared/src/index.ts', import.meta.url),
      ),
    },
  },
  test: {
    testTimeout: 30000,
    include: ['{packages,services}/*/src/**/*.test.ts'],
  },
});
