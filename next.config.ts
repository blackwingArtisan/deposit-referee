import type { NextConfig } from "next";
import { loadEnvFiles, readKitEnv } from "./src/lib/env-core";

// Load .env.local, then ../../.env.shared (apps/<slug>) or ../.env.shared (the kit), and
// refuse to start (dev, build or start) unless PAYPAL_MODE is "mock" or "sandbox".
loadEnvFiles();
const env = readKitEnv();
if (process.env.NEXT_PHASE !== "phase-production-build" || process.env.KIT_LOG_ENV) {
  console.log(`[kit] PayPal: ${env.paypalMode} · AI: ${env.aiMode} · daily AI cap $${env.aiDailyCapUsd}`);
}

const nextConfig: NextConfig = {
  // Lets e2e/demo runs use their own build dir next to a running `npm run dev`.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // A separate build dir gets its own tsconfig so Next never rewrites the main one.
  typescript: { tsconfigPath: process.env.NEXT_DIST_DIR ? "tsconfig.e2e.json" : "tsconfig.json" },
  cacheComponents: true,
  partialPrefetching: true,
  // CommonJS + Node-only deps (axios, paypal-server-sdk, an npm package named "os").
  serverExternalPackages: ["@paypal/agent-toolkit"],
  poweredByHeader: false,
  // No floating dev badge: it would show up in demo recordings.
  devIndicators: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
