import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_FRONTEND_PORT || 3173);

const HEADLESS = process.env.E2E_HEADLESS
  ? process.env.E2E_HEADLESS !== 'false'
  : true; // default: headless to avoid lingering UIs

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  fullyParallel: true,
  // stdout-friendly reporter; no HTML UI so runs don't linger
  reporter: process.env.CI ? 'dot' : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    headless: HEADLESS,
    trace: 'on-first-retry',
  },
  webServer: {
    // Start the frontend dev server and let Playwright manage its lifecycle.
    command: `cd frontend && npm run dev -- --port ${PORT} --strictPort --host`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
