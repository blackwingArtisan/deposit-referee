/**
 * Runs once when the server starts. Validates the environment (throws on an unsupported
 * PAYPAL_MODE, so the server never serves requests with a bad config).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { getEnv } = await import("./lib/env");
  getEnv();
}
