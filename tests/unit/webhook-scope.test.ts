import { beforeEach, describe, expect, it } from "vitest";
import { ingestPayPalResource, ledger } from "@/lib/paypal/ledger";
import { isOtherAppsEvent } from "@/lib/paypal/webhook-handler";
import type { AnyWebhookEvent } from "@/lib/paypal/webhooks";

const event = (event_type: string, resource: Record<string, unknown>) => ({ id: "WH-1", event_type, resource }) as unknown as AnyWebhookEvent;

const paymentOn = (orderId: string) => ({ id: "AUTH-1", supplementary_data: { related_ids: { order_id: orderId } } });

const usd = { currency_code: "USD", value: "200.00" };

beforeEach(() => {
  ledger.clear();
  ingestPayPalResource({ id: "ORDER-MINE", intent: "AUTHORIZE", status: "CREATED", purchase_units: [{ amount: usd }] });
  ingestPayPalResource({ id: "CAP-MINE", final_capture: true, status: "COMPLETED", amount: usd });
  ingestPayPalResource({ id: "INV2-MINE", status: "SENT", detail: { invoice_number: "0001" } });
});

describe("isOtherAppsEvent", () => {
  it("keeps a payment on this app's order", () => {
    expect(isOtherAppsEvent(event("PAYMENT.AUTHORIZATION.CREATED", paymentOn("ORDER-MINE")))).toBe(false);
  });

  it("drops a payment on another app's order", () => {
    expect(isOtherAppsEvent(event("PAYMENT.AUTHORIZATION.VOIDED", paymentOn("ORDER-THEIRS")))).toBe(true);
    expect(isOtherAppsEvent(event("PAYMENT.CAPTURE.COMPLETED", paymentOn("ORDER-THEIRS")))).toBe(true);
  });

  it("judges order events by the order itself", () => {
    expect(isOtherAppsEvent(event("CHECKOUT.ORDER.APPROVED", { id: "ORDER-MINE" }))).toBe(false);
    expect(isOtherAppsEvent(event("CHECKOUT.ORDER.APPROVED", { id: "ORDER-THEIRS" }))).toBe(true);
  });

  it("judges invoice events by the invoice, in both webhook shapes", () => {
    expect(isOtherAppsEvent(event("INVOICING.INVOICE.PAID", { id: "INV2-MINE" }))).toBe(false);
    expect(isOtherAppsEvent(event("INVOICING.INVOICE.PAID", { invoice: { id: "INV2-MINE" } }))).toBe(false);
    expect(isOtherAppsEvent(event("INVOICING.INVOICE.PAID", { invoice: { id: "INV2-THEIRS" } }))).toBe(true);
  });

  it("judges refunds by the capture they came from", () => {
    const refundOf = (id: string) => ({ id: "REF-1", links: [{ rel: "up", href: `https://api-m.sandbox.paypal.com/v2/payments/captures/${id}` }] });
    expect(isOtherAppsEvent(event("PAYMENT.CAPTURE.REFUNDED", refundOf("CAP-MINE")))).toBe(false);
    expect(isOtherAppsEvent(event("PAYMENT.CAPTURE.REFUNDED", refundOf("CAP-THEIRS")))).toBe(true);
  });

  it("keeps events that name nothing to check", () => {
    expect(isOtherAppsEvent(event("CUSTOMER.DISPUTE.CREATED", { dispute_id: "PP-D-1" }))).toBe(false);
    expect(isOtherAppsEvent(event("PAYMENT.PAYOUTSBATCH.SUCCESS", { batch_header: { payout_batch_id: "B1" } }))).toBe(false);
  });
});
