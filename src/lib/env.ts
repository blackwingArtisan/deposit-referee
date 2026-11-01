import { loadEnvFiles, readKitEnv, type KitEnv } from "./env-core";

export type { KitEnv, PayPalMode, AiMode } from "./env-core";
export { InvalidEnvError } from "./env-core";

let cached: KitEnv | null = null;

/**
 * Validated environment for server code. Loads .env.local and the shared env file on first
 * use. Throws InvalidEnvError if PAYPAL_MODE is anything but "mock" or "sandbox".
 */
export function getEnv(): KitEnv {
  if (cached) return cached;
  loadEnvFiles();
  cached = readKitEnv();
  return cached;
}

/** Tests only: forget the cached env so changes to process.env take effect. */
export function resetEnvCache() {
  cached = null;
}
