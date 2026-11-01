import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Kit: generated output (e2e/demo builds, local data, test artifacts).
    ".next-*/**",
    ".data*/**",
    "test-results/**",
    "playwright-report/**",
    "videos/**",
  ]),
]);

export default eslintConfig;
