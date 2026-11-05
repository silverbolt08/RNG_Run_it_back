import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Real OCR and PDF rendering share the CPU with the rest, and the first test in a file also loads
    // the whole app. A slow machine shouldn't fail a test that has nothing wrong with it.
    testTimeout: 20_000,
    globalSetup: ['tests/helpers/global-setup.ts'],
    env: {
      APP_TODAY: '2026-07-15',
    },
  },
});
