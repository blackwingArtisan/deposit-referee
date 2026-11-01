import path from "node:path";
import os from "node:os";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
    env: {
      // Tests never touch the shared credentials file or the real data dir.
      ENV_SHARED_PATH: path.join(os.tmpdir(), "kit-tests-no-shared-env"),
      KIT_DATA_DIR: path.join(os.tmpdir(), `kit-test-data-${process.pid}`),
      PAYPAL_MODE: "mock",
      MOCK_PAYPAL_LATENCY_MS: "0",
      AI_MODE: "mock",
    },
    testTimeout: 15_000,
  },
});
