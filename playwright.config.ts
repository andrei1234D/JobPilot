import { defineConfig } from '@playwright/test';

// End-to-end tests run against the real server serving the built dashboard,
// on its own port and with its own settings folder, always on the sample data.
const PORT = 47399;

export default defineConfig({
  testDir: 'e2e',
  outputDir: 'test-results',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    // Locally, use the installed Chrome instead of downloading a browser.
    channel: process.env.CI || process.env.PW_BUNDLED ? undefined : 'chrome',
    viewport: { width: 1440, height: 900 },
    colorScheme: 'light',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node apps/server/node_modules/tsx/dist/cli.mjs apps/server/src/main.ts',
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      JOBPILOT_PORT: String(PORT),
      JOBPILOT_HOME: 'node_modules/.cache/jobpilot-e2e',
      JOBPILOT_APPLICATIONS_LOG: '',
      JOBPILOT_OUTREACH_LOG: '',
      JOBPILOT_BATCHES_DIR: '',
    },
  },
});
