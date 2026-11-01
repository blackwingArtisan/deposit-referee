/**
 * npm run seed — load demo data into the current PAYPAL_MODE. Safe to run while `npm run dev`
 * is up: the server picks up the new state on its next request.
 * npm run seed:sandbox — the same, but refuses to run unless PAYPAL_MODE=sandbox. Running it
 * again adds nothing: see src/lib/demo/sandbox-seed.ts.
 */
import { loadEnvFiles } from "../src/lib/env-core";
import { getEnv } from "../src/lib/env";
import { getMockPayPal } from "../src/lib/paypal";
import { seedDemoData } from "../src/lib/demo/seed";
import { seedSandbox } from "../src/lib/demo/sandbox-seed";

async function main() {
  loadEnvFiles();
  const env = getEnv();
  if (env.paypalMode === "sandbox" || process.argv.includes("--sandbox")) {
    const { created, reused, ids } = await seedSandbox();
    console.log(`Created ${created}, reused ${reused}.`);
    console.log(ids);
    process.exit(0);
  }
  const reset = process.argv.includes("--reset");
  const mock = getMockPayPal();
  if (reset && mock) mock.reset();
  console.log(`Seeding demo data (PayPal ${env.paypalMode})…`);
  const result = await seedDemoData();
  if (mock) await mock.flushWebhooks();
  console.log("Created:", result.created);
  process.exit(0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
