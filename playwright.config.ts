import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure'
  },
  projects: [
    {
      name: 'mobile-safari',
      use: { ...devices['iPhone 14'] }
    }
  ],
  webServer: {
    command: 'npm run build && npm run preview -- --port 4173',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    // The server validates LUBELOGGER_* at boot (hooks.server.ts → loadEnv).
    // The e2e suite mocks all upstream calls at the browser layer, so these
    // placeholders just satisfy boot — no real LubeLogger is contacted. Keeps
    // e2e self-contained in CI (no .env on the runner) and locally.
    env: {
      LUBELOGGER_URL: 'http://localhost:9999',
      LUBELOGGER_API_KEY: 'e2e-test-key'
    }
  }
});
