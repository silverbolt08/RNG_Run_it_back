import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * QA probes for advisor and quote logic, kept apart from `npm test` because some fail on purpose
 * until the defect they describe is fixed. Run with: npx vitest run --config tests/qa/vitest.config.mts
 */
export default defineConfig({
  root: fileURLToPath(new URL('../..', import.meta.url)),
  resolve: { alias: { '@': fileURLToPath(new URL('../../src', import.meta.url)) } },
  test: {
    environment: 'node',
    include: ['tests/qa/logic/**/*.check.ts'],
    globalSetup: ['tests/helpers/global-setup.ts'],
    env: { APP_TODAY: '2026-07-15' },
  },
});
