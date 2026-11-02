import path from "node:path";
import os from "node:os";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
    // The JSON store is one file per data dir, so two test files can't write to it at once.
    fileParallelism: false,
    env: {
      // Tests never touch the shared credentials file or the real data dir.
      ENV_SHARED_PATH: path.join(os.tmpdir(), "kit-tests-no-shared-env"),
      KIT_DATA_DIR: path.join(os.tmpdir(), `kit-test-data-${process.pid}`),
      PAYPAL_MODE: "mock",
      MOCK_PAYPAL_LATENCY_MS: "0",
      AI_MODE: "mock",
      AGENT_SCRIPT_PAUSE_MS: "0",
    },
    testTimeout: 15_000,
  },
});
