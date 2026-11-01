/**
 * Entry point for PayPal in server code.
 *
 *   import { getPayPal } from "@/lib/paypal";
 *   const order = await getPayPal().orders.create({ intent: "AUTHORIZE", purchase_units: [...] });
 *
 * getPayPal() returns the sandbox or mock implementation (PAYPAL_MODE), wrapped so every call
 * appears on the timeline and in the ledger. Mock-only helpers: getMockPayPal().
 */
import { getEnv } from "../env";
import { singleton } from "../singleton";
import { dataPath } from "../store/files";
import type { PayPalApi } from "./api";
import { instrument } from "./instrument";
import { MockPayPal } from "./mock";
import { SandboxPayPal } from "./sandbox";
import { signMockWebhook } from "./webhooks";

export type { PayPalApi, RequestOptions } from "./api";
export * from "./errors";
export type * from "./types";
export { MockPayPal } from "./mock";
export { SANDBOX_API_BASE, TRANSACTION_SEARCH_NOT_ENABLED } from "./sandbox";
export { ledger, type LedgerEntry, type LedgerKind } from "./ledger";
export { onWebhook, isWebhookEvent, parseWebhookEvent, invoiceFromEvent } from "./webhooks";
export type { AnyWebhookEvent, WebhookEvent, KnownWebhookEventType } from "./webhooks";

function createMock(): MockPayPal {
  const env = getEnv();
  const mock = new MockPayPal({
    latencyMs: env.mockLatency,
    persistFile: dataPath("paypal-mock.json"),
    webhookDelayMs: 350,
    autoAdvancePayouts: true,
    defaultBuyer: { email: env.sandboxBuyerEmail, givenName: "Sam", surname: "Buyer" },
    merchantEmail: env.sandboxSellerEmail,
  });
  // Deliver mock webhooks through the same HTTP handler PayPal would hit (signature check included).
  mock.onEvent(async (event) => {
    const { handleWebhookRequest } = await import("./webhook-handler");
    const raw = JSON.stringify(event);
    const headers = signMockWebhook(raw, crypto.randomUUID());
    await handleWebhookRequest(new Request("http://localhost/api/paypal/webhooks", { method: "POST", headers, body: raw }));
  });
  return mock;
}

function rawClient(): MockPayPal | SandboxPayPal {
  const env = getEnv();
  if (env.paypalMode === "sandbox") {
    return singleton("paypal:sandbox", () => new SandboxPayPal({ clientId: env.paypalClientId!, clientSecret: env.paypalClientSecret!, webhookId: env.paypalWebhookId }));
  }
  return singleton("paypal:mock", createMock);
}

/** The PayPal client for the current PAYPAL_MODE (instrumented). */
export function getPayPal(): PayPalApi {
  const raw = rawClient();
  return singleton(`paypal:instrumented:${raw.mode}`, () => instrument(raw));
}

export function isMockMode(): boolean {
  return getEnv().paypalMode === "mock";
}

/** The raw MockPayPal (simulate approval, advance time, disputes...). Null in sandbox mode. */
export function getMockPayPal(): MockPayPal | null {
  const raw = rawClient();
  return raw instanceof MockPayPal ? raw : null;
}

/** Sandbox OAuth token (cached). Used to hand PayPal's Agent Toolkit a token. Sandbox mode only. */
export async function getSandboxAccessToken(): Promise<string> {
  const raw = rawClient();
  if (!(raw instanceof SandboxPayPal)) throw new Error("getSandboxAccessToken() is only available in PAYPAL_MODE=sandbox");
  return raw.getAccessToken();
}

/** Client id for the browser JS SDK (safe to expose). Undefined in mock mode. */
export function getBrowserClientId(): string | undefined {
  const env = getEnv();
  return env.paypalMode === "sandbox" ? env.paypalClientId : undefined;
}
