import { defineConfig, devices } from '@playwright/test';

const PORT = 3100;

/**
 * The real app, built for production, on its own copy of the database. The LLM is off by default,
 * so these tests are exact and spend no quota. LLM quality has its own live evaluation.
 */
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    ...devices['Pixel 5'],
    viewport: { width: 360, height: 780 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: `npx tsx tests/e2e/prepare-db.ts && npx next build && npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    timeout: 300_000,
    reuseExistingServer: false,
    env: {
      DATABASE_URL: 'file:storage/e2e.db',
      DOCUMENT_DIR: './storage/e2e-documents',
      LLM_PROVIDER: 'off',
      COOKIE_SECURE: 'false',
      ADMIN_TOKEN: 'e2e-admin-token-not-a-secret',
      NEXT_TELEMETRY_DISABLED: '1',
    },
  },
});
