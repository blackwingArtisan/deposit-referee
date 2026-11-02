// Runs the mock browser suite on one other engine: ENGINE=webkit|firefox|iphone|android npm run test:e2e:engines
import { devices } from "@playwright/test";
import base from "./playwright.config";

const engines = {
  webkit: devices["Desktop Safari"],
  firefox: devices["Desktop Firefox"],
  iphone: devices["iPhone 15"],
  android: devices["Pixel 7"],
};

const name = (process.env.ENGINE ?? "webkit") as keyof typeof engines;

export default {
  ...base,
  outputDir: `test-results-${name}`,
  reporter: "line",
  projects: [{ name, testIgnore: "mic-flow.spec.ts", use: engines[name] }],
};
