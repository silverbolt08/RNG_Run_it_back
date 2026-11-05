import { defineConfig, devices } from '@playwright/test';

/**
 * QA probes for awkward journeys, kept apart from `npm run test:e2e` because some of them fail on
 * purpose until the defect they describe is fixed. Start tests/qa/start-server.ts first.
 */
export default defineConfig({
  testDir: 'browser',
  outputDir: '../../test-results/qa',
  timeout: 150_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.QA_BASE_URL ?? 'http://localhost:3200',
    ...devices['Pixel 5'],
    viewport: { width: 360, height: 780 },
    screenshot: 'only-on-failure',
  },
});
