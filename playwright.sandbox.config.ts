import { defineConfig, devices } from "@playwright/test";

/**
 * The deposit flow on the real PayPal sandbox (npm run test:e2e:sandbox). The deposit is paid
 * with PayPal's test card. AI is mocked unless E2E_AI_MODE=live, which spends real money.
 * Uses a production build: `next dev` can reload endlessly.
 * Set E2E_BASE_URL to run the same flow against a deployed copy instead of a local build.
 */
const PORT = Number(process.env.E2E_PORT ?? 3200);
const HOSTED = process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: ["deposit-flow.spec.ts", "insights.spec.ts"],
  timeout: 180_000,
  expect: { timeout: 15_000 },
  workers: 1,
  reporter: [["list"]],
  outputDir: "test-results/sandbox",
  use: {
    baseURL: HOSTED ?? `http://localhost:${PORT}`,
    viewport: { width: 1440, height: 1000 },
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } } }],
  webServer: HOSTED ? undefined : {
    command: `rm -rf .data-sandbox && npx next build && npx next start --port ${PORT}`,
    url: `http://localhost:${PORT}/api/kit/status`,
    reuseExistingServer: false,
    timeout: 300_000,
    env: {
      PAYPAL_MODE: "sandbox",
      AI_MODE: process.env.E2E_AI_MODE ?? "mock",
      DEMO_TEST_CARD: "1",
      KIT_DATA_DIR: ".data-sandbox",
      NEXT_DIST_DIR: ".next-e2e",
    },
  },
});
