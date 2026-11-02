import type { NextConfig } from "next";
import { loadEnvFiles, readKitEnv } from "./src/lib/env-core";

// Load .env.local, then ../../.env.shared (apps/<slug>) or ../.env.shared (the kit), and
// refuse to start (dev, build or start) unless PAYPAL_MODE is "mock" or "sandbox".
loadEnvFiles();
const env = readKitEnv();
if (process.env.NEXT_PHASE !== "phase-production-build" || process.env.KIT_LOG_ENV) {
  console.log(`[kit] PayPal: ${env.paypalMode} · AI: ${env.aiMode} · daily AI cap $${env.aiDailyCapUsd}`);
}

// Sponsor UI is a build-time switch. The licence key only reaches the browser when it's on.
const sponsorUi = process.env.NEXT_PUBLIC_SPONSOR_UI === "1";
const studioKey = sponsorUi ? process.env.AG_STUDIO_LICENSE_KEY : undefined;
const SPONSOR_STUB = "./src/components/deposit/insights/sponsor-ui-stub.ts";

const nextConfig: NextConfig = {
  env: studioKey ? { AG_STUDIO_LICENSE_KEY: studioKey } : {},
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
    // With the switch off the sponsor's packages aren't built at all.
    resolveAlias: sponsorUi ? {} : { "ag-studio": SPONSOR_STUB, "ag-studio-react": SPONSOR_STUB },
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
