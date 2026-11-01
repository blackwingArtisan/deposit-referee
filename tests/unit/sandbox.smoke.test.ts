/**
 * Real PayPal SANDBOX smoke test. Skipped unless sandbox credentials exist AND
 * SANDBOX_SMOKE=1 (use `npm run test:sandbox`), so `npm test` never needs the network.
 *
 * Steps that need a human buyer login (approve -> authorize/capture) cannot run headless;
 * they are covered by the mock tests and by the example page with the real PayPal button.
 */
import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { parseDotenv } from "@/lib/env-core";

function loadSharedCreds(): Record<string, string> | null {
  const candidates = [process.env.SANDBOX_ENV_FILE, path.resolve("../../.env.shared"), path.resolve("../.env.shared"), path.resolve(".env.local")].filter(Boolean) as string[];
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    const env = parseDotenv(fs.readFileSync(file, "utf8"));
    if (env.PAYPAL_CLIENT_ID && env.PAYPAL_CLIENT_SECRET) return env;
  }
  return null;
}

const creds = process.env.SANDBOX_SMOKE === "1" ? loadSharedCreds() : null;

describe.skipIf(!creds)("PayPal sandbox smoke (real API)", () => {
  // Loaded lazily so the module graph uses PAYPAL_MODE=sandbox.
  let pp: import("@/lib/paypal").PayPalApi;
  let lib: typeof import("@/lib/paypal");
  const buyer = () => creds!.PAYPAL_SANDBOX_BUYER_EMAIL || "buyer@personal.example.com";

  beforeAll(async () => {
    for (const k of ["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET", "PAYPAL_WEBHOOK_ID", "PAYPAL_SANDBOX_BUYER_EMAIL", "PAYPAL_SANDBOX_SELLER_EMAIL"]) {
      if (creds![k]) process.env[k] = creds![k];
    }
    process.env.PAYPAL_MODE = "sandbox";
    const { resetEnvCache } = await import("@/lib/env");
    const { resetSingletons } = await import("@/lib/singleton");
    resetEnvCache();
    resetSingletons("paypal:");
    lib = await import("@/lib/paypal");
    pp = lib.getPayPal();
    expect(pp.mode).toBe("sandbox");
  });

  it("gets an OAuth token", async () => {
    const token = await lib.getSandboxAccessToken();
    expect(token.length).toBeGreaterThan(20);
  });

  it("creates and reads an AUTHORIZE order, normalizes errors with debug_id, honors PayPal-Request-Id", async () => {
    const body = { intent: "AUTHORIZE" as const, purchase_units: [{ amount: { currency_code: "USD", value: "12.34" }, description: "Kit smoke test" }] };
    const requestId = crypto.randomUUID();
    const order = await pp.orders.create(body, { requestId });
    expect(order.id).toMatch(/^[0-9A-Z]{17}$/);
    expect(["CREATED", "PAYER_ACTION_REQUIRED"]).toContain(order.status);
    console.info(`[smoke] order ${order.status}, links: ${order.links.map((l) => l.rel).join(",")}`);
    expect(order.links.some((l) => l.rel === "approve" || l.rel === "payer-action")).toBe(true);
    const replay = await pp.orders.create(body, { requestId });
    expect(replay.id).toBe(order.id);
    const fetched = await pp.orders.get(order.id);
    expect(fetched.intent).toBe("AUTHORIZE");
    const err = await pp.orders.authorize(order.id).catch((e) => e);
    expect(lib.isPayPalError(err)).toBe(true);
    expect(err.status).toBe(422);
    expect(err.issue).toBe("ORDER_NOT_APPROVED");
    expect(err.debugId).toBeTruthy();
  });

  it("drafts, sends and cancels an invoice", async () => {
    const inv = await pp.invoicing.create({
      detail: { currency_code: "USD", note: "Kit smoke test" },
      primary_recipients: [{ billing_info: { email_address: buyer() } }],
      items: [{ name: "Smoke test", quantity: "1", unit_amount: { currency_code: "USD", value: "1.00" } }],
    });
    expect(inv.id).toMatch(/^INV2-/);
    expect(inv.status).toBe("DRAFT");
    const link = await pp.invoicing.send(inv.id);
    expect(link.href).toBeTruthy();
    const sent = await pp.invoicing.get(inv.id);
    expect(sent.status).toMatch(/SENT|UNPAID|SCHEDULED/);
    console.info(`[smoke] invoice ${inv.detail.invoice_number}: DRAFT -> ${sent.status}`);
    await pp.invoicing.cancel(inv.id);
    expect((await pp.invoicing.get(inv.id)).status).toBe("CANCELLED");
    const list = await pp.invoicing.list({ page_size: 5 });
    expect(Array.isArray(list.items)).toBe(true);
  });

  it("creates and reads a payout batch", async () => {
    const res = await pp.payouts.create({
      sender_batch_header: { sender_batch_id: `kit-smoke-${Date.now()}`, email_subject: "Kit smoke test payout" },
      items: [{ recipient_type: "EMAIL", receiver: buyer(), amount: { currency: "USD", value: "1.00" }, note: "Kit smoke test" }],
    });
    expect(res.batch_header.payout_batch_id).toBeTruthy();
    const batch = await pp.payouts.get(res.batch_header.payout_batch_id);
    expect(["PENDING", "PROCESSING", "SUCCESS", "DENIED"]).toContain(batch.batch_header.batch_status);
    console.info(`[smoke] payout batch status: ${res.batch_header.batch_status} -> ${batch.batch_header.batch_status}`);
  });

  it("lists disputes", async () => {
    const list = await pp.disputes.list({ page_size: 5 });
    expect(Array.isArray(list.items ?? [])).toBe(true);
  });

  it("searches transactions, or reports clearly that the reporting scope is missing", async () => {
    const end = new Date();
    const start = new Date(end.getTime() - 7 * 864e5);
    try {
      const res = await pp.transactions.search({ start_date: start.toISOString().replace(/\.\d{3}Z$/, "Z"), end_date: end.toISOString().replace(/\.\d{3}Z$/, "Z") });
      expect(Array.isArray(res.transaction_details)).toBe(true);
      console.info(`[smoke] transaction search OK: ${res.total_items} items`);
    } catch (e) {
      expect(lib.isPayPalError(e, lib.TRANSACTION_SEARCH_NOT_ENABLED)).toBe(true);
      console.info(`[smoke] transaction search: ${lib.TRANSACTION_SEARCH_NOT_ENABLED} (HTTP 403, debug_id ${(e as { debugId?: string }).debugId})`);
    }
  });

  it("creates a vault setup token (buyer approval link)", async () => {
    const setup = await pp.vault.createSetupToken({
      payment_source: { paypal: { usage_type: "MERCHANT", description: "Kit smoke test", experience_context: { return_url: "https://example.com/ok", cancel_url: "https://example.com/cancel" } } },
    });
    expect(setup.id).toBeTruthy();
    expect(setup.status).toMatch(/PAYER_ACTION_REQUIRED|CREATED/);
    expect(setup.links.some((l) => l.rel === "approve")).toBe(true);
    console.info(`[smoke] vault setup token status: ${setup.status}`);
  });

  it("rejects an unsigned webhook", async () => {
    const result = await pp.webhooks.verify(new Headers({ "paypal-transmission-id": "x", "paypal-transmission-time": new Date().toISOString(), "paypal-transmission-sig": "bad", "paypal-cert-url": "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-360caa42-fca2a594-a5cafa77", "paypal-auth-algo": "SHA256withRSA" }), JSON.stringify({ id: "WH-TEST", event_type: "PAYMENT.CAPTURE.COMPLETED", resource: {} })).catch((e) => ({ verified: false, status: "ERROR", reason: e.message }));
    expect(result.verified).toBe(false);
    console.info(`[smoke] unsigned webhook: ${result.status}${"reason" in result && result.reason ? ` (${result.reason})` : ""}`);
  });

  it("runs a PayPal Agent Toolkit tool against the sandbox through the guard", async () => {
    const { toolkitTools } = await import("@/lib/agent/tools/toolkit");
    const { Guard } = await import("@/lib/agent/guard");
    const order = await pp.orders.create({ intent: "CAPTURE", purchase_units: [{ amount: { currency_code: "USD", value: "3.00" } }] });
    const [getOrder] = toolkitTools(["get_order"], "sandbox");
    const guard = new Guard({ paypal: pp });
    const out = await guard.run(getOrder, getOrder.parse({ id: order.id }), { runId: "smoke", actor: "test", channel: "test" });
    expect(out.status).toBe("executed");
    expect((out as { result: { id: string } }).result.id).toBe(order.id);
  });
});
