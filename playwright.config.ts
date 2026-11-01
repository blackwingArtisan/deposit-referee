import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests (npm run test:e2e). Starts the dev server in PayPal MOCK mode with its own
 * data dir. AI is mocked unless E2E_AI_MODE=live (then real Claude, tiny spend).
 */
const PORT = Number(process.env.E2E_PORT ?? 3100);

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 180_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1440, height: 1000 },
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } } }],
  webServer: {
    command: `npx next dev --port ${PORT}`,
    url: `http://localhost:${PORT}/api/kit/status`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      PAYPAL_MODE: process.env.E2E_PAYPAL_MODE ?? "mock",
      AI_MODE: process.env.E2E_AI_MODE ?? "mock",
      KIT_DATA_DIR: ".data-e2e",
      MOCK_PAYPAL_LATENCY_MS: "60-160",
      NEXT_DIST_DIR: ".next-e2e",
    },
  },
});
