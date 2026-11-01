/**
 * Webhook event types, parsing and the handler registry.
 *
 *   onWebhook("PAYMENT.CAPTURE.COMPLETED", async (event) => {
 *     event.resource.amount // typed as Capture
 *   });
 *
 * Incoming requests are handled by handleWebhookRequest() (webhook-handler.ts), which
 * verifies the signature (sandbox: PayPal postback API, mock: local HMAC) then dispatches here.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { singleton } from "../singleton";
import type * as T from "./types";

export interface WebhookVerification {
  verified: boolean;
  status: "SUCCESS" | "FAILURE" | "NOT_CONFIGURED";
  reason?: string;
}

export interface InvoiceEventResource {
  invoice: T.Invoice;
}

export interface WebhookResourceMap {
  "CHECKOUT.ORDER.APPROVED": T.Order;
  "CHECKOUT.ORDER.COMPLETED": T.Order;
  "PAYMENT.AUTHORIZATION.CREATED": T.Authorization;
  "PAYMENT.AUTHORIZATION.VOIDED": T.Authorization;
  "PAYMENT.CAPTURE.COMPLETED": T.Capture;
  "PAYMENT.CAPTURE.PENDING": T.Capture;
  "PAYMENT.CAPTURE.DECLINED": T.Capture;
  "PAYMENT.CAPTURE.REFUNDED": T.Refund;
  "PAYMENT.CAPTURE.REVERSED": T.Refund;
  "PAYMENT.PAYOUTSBATCH.PROCESSING": T.PayoutBatch;
  "PAYMENT.PAYOUTSBATCH.SUCCESS": T.PayoutBatch;
  "PAYMENT.PAYOUTSBATCH.DENIED": T.PayoutBatch;
  "PAYMENT.PAYOUTS-ITEM.SUCCEEDED": T.PayoutItem;
  "PAYMENT.PAYOUTS-ITEM.FAILED": T.PayoutItem;
  "PAYMENT.PAYOUTS-ITEM.UNCLAIMED": T.PayoutItem;
  "PAYMENT.PAYOUTS-ITEM.RETURNED": T.PayoutItem;
  "PAYMENT.PAYOUTS-ITEM.BLOCKED": T.PayoutItem;
  "PAYMENT.PAYOUTS-ITEM.HELD": T.PayoutItem;
  "PAYMENT.PAYOUTS-ITEM.CANCELED": T.PayoutItem;
  "PAYMENT.PAYOUTS-ITEM.REFUNDED": T.PayoutItem;
  "INVOICING.INVOICE.CREATED": InvoiceEventResource;
  "INVOICING.INVOICE.UPDATED": InvoiceEventResource;
  "INVOICING.INVOICE.SCHEDULED": InvoiceEventResource;
  "INVOICING.INVOICE.PAID": InvoiceEventResource;
  "INVOICING.INVOICE.CANCELLED": InvoiceEventResource;
  "INVOICING.INVOICE.REFUNDED": InvoiceEventResource;
  "CUSTOMER.DISPUTE.CREATED": T.Dispute;
  "CUSTOMER.DISPUTE.UPDATED": T.Dispute;
  "CUSTOMER.DISPUTE.RESOLVED": T.Dispute;
  "VAULT.PAYMENT-TOKEN.CREATED": T.PaymentToken;
  "VAULT.PAYMENT-TOKEN.DELETED": T.PaymentToken;
}

export type KnownWebhookEventType = keyof WebhookResourceMap;
export type WebhookEvent<K extends KnownWebhookEventType> = T.WebhookEventEnvelope<K, WebhookResourceMap[K]>;
/** Any parsed event; narrow with isWebhookEvent(). */
export type AnyWebhookEvent = T.WebhookEventEnvelope<string, unknown>;

export const RESOURCE_TYPES: Record<string, string> = {
  CHECKOUT: "checkout-order",
  "PAYMENT.AUTHORIZATION": "authorization",
  "PAYMENT.CAPTURE.REFUNDED": "refund",
  "PAYMENT.CAPTURE.REVERSED": "refund",
  "PAYMENT.CAPTURE": "capture",
  "PAYMENT.PAYOUTSBATCH": "payouts",
  "PAYMENT.PAYOUTS-ITEM": "payouts_item",
  INVOICING: "invoices",
  "CUSTOMER.DISPUTE": "dispute",
  VAULT: "payment_token",
};

export function resourceTypeFor(eventType: string): string {
  const match = Object.keys(RESOURCE_TYPES)
    .sort((a, b) => b.length - a.length)
    .find((prefix) => eventType.startsWith(prefix));
  return match ? RESOURCE_TYPES[match] : "unknown";
}

const envelopeSchema = z.object({
  id: z.string().min(1),
  event_type: z.string().min(1),
  create_time: z.string(),
  resource_type: z.string().default("unknown"),
  resource_version: z.string().optional(),
  event_version: z.string().default("1.0"),
  summary: z.string().default(""),
  resource: z.record(z.string(), z.unknown()),
  links: z.array(z.object({ href: z.string(), rel: z.string(), method: z.string().optional() })).default([]),
});

export function parseWebhookEvent(input: unknown): AnyWebhookEvent {
  const json = typeof input === "string" ? JSON.parse(input) : input;
  return envelopeSchema.parse(json) as AnyWebhookEvent;
}

export function isWebhookEvent<K extends KnownWebhookEventType>(event: AnyWebhookEvent, type: K): event is WebhookEvent<K> {
  return event.event_type === type;
}

/** Invoicing events wrap the invoice ({ invoice }); accept a bare invoice too. */
export function invoiceFromEvent(event: AnyWebhookEvent): T.Invoice | undefined {
  const r = event.resource as Partial<InvoiceEventResource> & Partial<T.Invoice>;
  return r.invoice ?? (r.id ? (r as T.Invoice) : undefined);
}

// ───────────────────────────── handler registry ─────────────────────────────

type Handler = (event: AnyWebhookEvent) => void | Promise<void>;

const registry = singleton("paypal:webhook-handlers", () => new Map<string, Set<Handler>>());

/** Register a handler for one event type, or "*" for all. Returns an unsubscribe function. */
export function onWebhook<K extends KnownWebhookEventType>(type: K, handler: (event: WebhookEvent<K>) => void | Promise<void>): () => void;
export function onWebhook(type: "*", handler: Handler): () => void;
export function onWebhook(type: string, handler: Handler): () => void {
  if (!registry.has(type)) registry.set(type, new Set());
  registry.get(type)!.add(handler);
  return () => registry.get(type)?.delete(handler);
}

export async function dispatchWebhook(event: AnyWebhookEvent): Promise<{ handled: number; errors: string[] }> {
  const handlers = [...(registry.get(event.event_type) ?? []), ...(registry.get("*") ?? [])];
  const errors: string[] = [];
  for (const h of handlers) {
    try {
      await h(event);
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }
  return { handled: handlers.length, errors };
}

// ───────────────────────────── mock signing ─────────────────────────────
// Mirrors PayPal's signed string: transmissionId|transmissionTime|webhookId|crc32(rawBody),
// but signed with a local HMAC instead of PayPal's RSA cert.

export const MOCK_WEBHOOK_ID = "WH-MOCK-KIT";
export const MOCK_AUTH_ALGO = "HMACSHA256-KITMOCK";
const mockSecret = () => process.env.MOCK_WEBHOOK_SECRET || "kit-mock-webhook-secret";

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(input: string): number {
  const bytes = new TextEncoder().encode(input);
  let crc = 0xffffffff;
  for (const b of bytes) crc = CRC_TABLE[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export function signMockWebhook(rawBody: string, transmissionId: string, transmissionTime = new Date().toISOString()): Record<string, string> {
  const signed = `${transmissionId}|${transmissionTime}|${MOCK_WEBHOOK_ID}|${crc32(rawBody)}`;
  const sig = createHmac("sha256", mockSecret()).update(signed).digest("base64");
  return {
    "paypal-transmission-id": transmissionId,
    "paypal-transmission-time": transmissionTime,
    "paypal-transmission-sig": sig,
    "paypal-cert-url": "mock://paypal-kit/webhook-cert",
    "paypal-auth-algo": MOCK_AUTH_ALGO,
    "content-type": "application/json",
  };
}

export function verifyMockWebhook(headers: Headers, rawBody: string): WebhookVerification {
  const id = headers.get("paypal-transmission-id");
  const time = headers.get("paypal-transmission-time");
  const sig = headers.get("paypal-transmission-sig");
  if (!id || !time || !sig) return { verified: false, status: "FAILURE", reason: "Missing PayPal transmission headers" };
  if (headers.get("paypal-auth-algo") !== MOCK_AUTH_ALGO) return { verified: false, status: "FAILURE", reason: "Unexpected auth algo for mock" };
  const expected = createHmac("sha256", mockSecret()).update(`${id}|${time}|${MOCK_WEBHOOK_ID}|${crc32(rawBody)}`).digest();
  const given = Buffer.from(sig, "base64");
  const ok = given.length === expected.length && timingSafeEqual(given, expected);
  return ok ? { verified: true, status: "SUCCESS" } : { verified: false, status: "FAILURE", reason: "Signature mismatch" };
}
