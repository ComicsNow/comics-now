const { defineConfig, devices } = require('@playwright/test');
const path = require('path');

module.exports = defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3009',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    headless: true,
  },
  // Automatically start and stop your server before running tests
  webServer: {
    command: 'NODE_ENV=test DATA_DIR=tests/fixtures/data PORT=3009 node server.js',
    url: 'http://localhost:3009',
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
