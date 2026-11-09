import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests (npm run test:e2e). Starts the dev server in PayPal MOCK mode with its own
 * data dir. AI is mocked unless E2E_AI_MODE=live (then real Claude, tiny spend).
 * E2E_PROD=1 uses a production build instead: `next dev` can reload endlessly on heavy pages,
 * and npm run test:e2e:studio needs that for AG Studio.
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
    // A fresh data dir each run: the Guard's $2,000 daily cap counts captures across runs.
    command: `rm -rf .data-e2e && ${process.env.E2E_PROD ? `npx next build && npx next start --port ${PORT}` : `npx next dev --port ${PORT}`}`,
    url: `http://localhost:${PORT}/api/kit/status`,
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
    env: {
      PAYPAL_MODE: process.env.E2E_PAYPAL_MODE ?? "mock",
      AI_MODE: process.env.E2E_AI_MODE ?? "mock",
      KIT_DATA_DIR: ".data-e2e",
      MOCK_PAYPAL_LATENCY_MS: "60-160",
      // The whole mock suite captures more than the Guard's $2,000 a day; mock PayPal only (app.config.ts).
      ...((process.env.E2E_PAYPAL_MODE ?? "mock") === "mock" ? { MOCK_MAX_PER_DAY: "10000.00" } : {}),
      NEXT_DIST_DIR: ".next-e2e",
    },
  },
});
