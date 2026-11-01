import { defineConfig, devices } from "@playwright/test";

/**
 * Demo recording (npm run demo:record). Builds the app, starts it, records demo/demo.spec.ts as
 * 1440x900 .webm and copies it to videos/. Mock PayPal unless PAYPAL_MODE=sandbox (or
 * DEMO_PAYPAL_MODE=sandbox); AI is mocked unless DEMO_AI_MODE=live.
 */
const PORT = Number(process.env.DEMO_PORT ?? 3400);
const SIZE = { width: 1440, height: 900 };
const PAYPAL_MODE = process.env.DEMO_PAYPAL_MODE ?? process.env.PAYPAL_MODE ?? "mock";
// Sandbox has no reset route, so start clean here and fill the ledger with the shared seed data.
const SANDBOX_SETUP = PAYPAL_MODE === "sandbox" ? "rm -rf .data-demo && npx tsx scripts/seed.ts --sandbox && " : "";

export default defineConfig({
  testDir: "demo",
  timeout: 240_000,
  expect: { timeout: 20_000 },
  workers: 1,
  reporter: [["list"]],
  outputDir: "test-results/demo",
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: SIZE,
    deviceScaleFactor: 1,
    video: { mode: "on", size: SIZE },
    launchOptions: { slowMo: 80 },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: SIZE, deviceScaleFactor: 1 } }],
  webServer: {
    // Production build: no dev reloads or overlays in the recording.
    command: `${SANDBOX_SETUP}npx next build && npx next start --port ${PORT}`,
    url: `http://localhost:${PORT}/api/kit/status`,
    reuseExistingServer: true,
    timeout: 300_000,
    env: {
      PAYPAL_MODE,
      AI_MODE: process.env.DEMO_AI_MODE ?? "mock",
      KIT_DATA_DIR: ".data-demo",
      MOCK_PAYPAL_LATENCY_MS: "250-600",
      DEMO_TEST_CARD: "1",
      NEXT_DIST_DIR: ".next-e2e",
    },
  },
});
