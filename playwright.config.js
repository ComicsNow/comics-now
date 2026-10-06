const { defineConfig, devices } = require('@playwright/test');

// Local override: this dev machine already hosts another service (comics-mcp)
// on 3009, so the e2e port is env-configurable. Defaults match CI.
const E2E_PORT = process.env.E2E_PORT || '3009';
const E2E_URL = `http://localhost:${E2E_PORT}`;

module.exports = defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  reporter: 'list',
  use: {
    baseURL: E2E_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    headless: true,
  },
  // Automatically start and stop your server before running tests
  webServer: {
    command: `NODE_ENV=test DATA_DIR=tests/fixtures/data PORT=${E2E_PORT} node server.js`,
    url: E2E_URL,
    reuseExistingServer: false,
    timeout: 120 * 1000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    }
  ]
});
