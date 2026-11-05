import { defineConfig, devices } from '@playwright/test';

const PORT = 3100;
const OCR_DOWN_PORT = 3101;

/**
 * The real app, built for production, on its own copy of the database. The LLM key is deliberately
 * invalid, so these tests are exact, spend no quota and prove the journey survives a failing LLM.
 * LLM quality has its own live evaluation.
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
    command: 'npx tsx tests/e2e/start-servers.ts',
    url: `http://localhost:${OCR_DOWN_PORT}`,
    timeout: 300_000,
    reuseExistingServer: false,
  },
});
