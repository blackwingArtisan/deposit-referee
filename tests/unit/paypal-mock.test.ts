import { beforeEach, describe, expect, it } from "vitest";
import { MockPayPal, HONOR_PERIOD_MS } from "@/lib/paypal/mock";
import { isPayPalError, PayPalApiError } from "@/lib/paypal/errors";
import type { CreateOrderRequest, Order } from "@/lib/paypal/types";
import { signMockWebhook, verifyMockWebhook } from "@/lib/paypal/webhooks";

const DAY = 24 * 60 * 60 * 1000;
const usd = (value: string) => ({ currency_code: "USD", value });

function orderBody(intent: "CAPTURE" | "AUTHORIZE", value = "100.00"): CreateOrderRequest {
  return { intent, purchase_units: [{ amount: { currency_code: "USD", value }, description: "Test order" }] };
}

async function expectIssue(p: Promise<unknown>, issue: string) {
  const err = await p.then(
    () => null,
    (e) => e,
  );
  expect(err).toBeInstanceOf(PayPalApiError);
  expect(isPayPalError(err, issue)).toBe(true);
  return err as PayPalApiError;
}

let pp: MockPayPal;
beforeEach(() => {
  pp = new MockPayPal();
});

async function approvedOrder(intent: "CAPTURE" | "AUTHORIZE", value = "100.00"): Promise<Order> {
  const order = await pp.orders.create(orderBody(intent, value));
  return pp.simulateBuyerApproval(order.id);
}

async function authorization(value = "100.00") {
  const order = await approvedOrder("AUTHORIZE", value);
  const authorized = await pp.orders.authorize(order.id);
  return authorized.purchase_units![0].payments!.authorizations![0];
}

describe("orders", () => {
  it("creates realistic ids, links and status", async () => {
    const order = await pp.orders.create(orderBody("CAPTURE"));
    expect(order.id).toMatch(/^[0-9A-Z]{17}$/);
    expect(order.status).toBe("CREATED");
    expect(order.links.find((l) => l.rel === "approve")?.href).toContain(`checkoutnow?token=${order.id}`);
  });

  it("uses PAYER_ACTION_REQUIRED + payer-action link when experience_context is set", async () => {
    const order = await pp.orders.create({ ...orderBody("CAPTURE"), payment_source: { paypal: { experience_context: { return_url: "https://x/r", cancel_url: "https://x/c" } } } });
    expect(order.status).toBe("PAYER_ACTION_REQUIRED");
    expect(order.links.map((l) => l.rel)).toContain("payer-action");
  });

  it("follows CREATED -> APPROVED -> COMPLETED for CAPTURE", async () => {
    const created = await pp.orders.create(orderBody("CAPTURE"));
    await expectIssue(pp.orders.capture(created.id), "ORDER_NOT_APPROVED");
    const approved = await pp.simulateBuyerApproval(created.id);
    expect(approved.status).toBe("APPROVED");
    expect(approved.payer?.email_address).toBeTruthy();
    const captured = await pp.orders.capture(created.id);
    expect(captured.status).toBe("COMPLETED");
    const cap = captured.purchase_units![0].payments!.captures![0];
    expect(cap.status).toBe("COMPLETED");
    expect(cap.amount).toEqual(usd("100.00"));
    expect(Number(cap.seller_receivable_breakdown!.net_amount.value)).toBeLessThan(100);
    await expectIssue(pp.orders.capture(created.id), "ORDER_ALREADY_CAPTURED");
  });

  it("rejects capture on an AUTHORIZE order and vice versa", async () => {
    const a = await approvedOrder("AUTHORIZE");
    await expectIssue(pp.orders.capture(a.id), "ACTION_DOES_NOT_MATCH_INTENT");
    const c = await approvedOrder("CAPTURE");
    await expectIssue(pp.orders.authorize(c.id), "ACTION_DOES_NOT_MATCH_INTENT");
  });

  it("validates the amount breakdown", async () => {
    await expectIssue(
      pp.orders.create({
        intent: "CAPTURE",
        purchase_units: [{ amount: { currency_code: "USD", value: "50.00", breakdown: { item_total: usd("40.00") } }, items: [{ name: "x", quantity: "2", unit_amount: usd("20.00") }] }],
      }),
      "AMOUNT_MISMATCH",
    );
    await expectIssue(
      pp.orders.create({
        intent: "CAPTURE",
        purchase_units: [{ amount: { currency_code: "USD", value: "50.00", breakdown: { item_total: usd("50.00") } }, items: [{ name: "x", quantity: "2", unit_amount: usd("20.00") }] }],
      }),
      "ITEM_TOTAL_MISMATCH",
    );
  });

  it("rejects duplicate invoice ids", async () => {
    const body = { intent: "CAPTURE" as const, purchase_units: [{ amount: usd("10.00"), invoice_id: "INV-1" }] };
    await pp.orders.create(body);
    await expectIssue(pp.orders.create(body), "DUPLICATE_INVOICE_ID");
  });

  it("is atomic: a failed call leaves no state behind", async () => {
    await expectIssue(pp.orders.create({ intent: "CAPTURE", purchase_units: [{ amount: usd("10.00"), payee: {}, invoice_id: "A" }, { amount: usd("0.00") }] }), "CANNOT_BE_ZERO_OR_NEGATIVE");
    expect(pp.snapshot().orders).toHaveLength(0);
    expect(pp.events()).toHaveLength(0);
  });
});

describe("authorizations", () => {
  it("authorizes with a 29-day expiration", async () => {
    const auth = await authorization();
    expect(auth.status).toBe("CREATED");
    const days = (Date.parse(auth.expiration_time) - Date.parse(auth.create_time)) / DAY;
    expect(Math.round(days)).toBe(29);
    expect(auth.links.map((l) => l.rel)).toEqual(expect.arrayContaining(["capture", "void", "reauthorize"]));
  });

  it("sums partial captures correctly and moves to CAPTURED on final_capture", async () => {
    const auth = await authorization("100.00");
    const c1 = await pp.payments.captureAuthorization(auth.id, { amount: usd("30.10"), final_capture: false });
    const c2 = await pp.payments.captureAuthorization(auth.id, { amount: usd("19.95"), final_capture: false });
    expect(c1.final_capture).toBe(false);
    expect((await pp.payments.getAuthorization(auth.id)).status).toBe("PARTIALLY_CAPTURED");
    expect(pp.authorizationRemaining(auth.id)).toEqual(usd("49.95"));
    const c3 = await pp.payments.captureAuthorization(auth.id, { amount: usd("10.00"), final_capture: true });
    expect(c3.final_capture).toBe(true);
    const after = await pp.payments.getAuthorization(auth.id);
    expect(after.status).toBe("CAPTURED");
    const total = [c1, c2, c3].reduce((s, c) => s + Math.round(Number(c.amount.value) * 100), 0);
    expect(total).toBe(6005);
    await expectIssue(pp.payments.captureAuthorization(auth.id, { amount: usd("1.00") }), "AUTHORIZATION_ALREADY_CAPTURED");
  });

  it("captures the remaining amount when no amount is given", async () => {
    const auth = await authorization("80.00");
    await pp.payments.captureAuthorization(auth.id, { amount: usd("20.00") });
    const rest = await pp.payments.captureAuthorization(auth.id);
    expect(rest.amount).toEqual(usd("60.00"));
    expect(rest.final_capture).toBe(true);
    expect((await pp.payments.getAuthorization(auth.id)).status).toBe("CAPTURED");
  });

  it("enforces the 115% / +$75 overage limit", async () => {
    const small = await authorization("100.00");
    await pp.payments.captureAuthorization(small.id, { amount: usd("115.00") });
    const big = await authorization("1000.00");
    await expectIssue(pp.payments.captureAuthorization(big.id, { amount: usd("1075.01") }), "MAX_CAPTURE_AMOUNT_EXCEEDED");
  });

  it("voids the uncaptured remainder after a partial capture", async () => {
    const auth = await authorization("120.00");
    await pp.payments.captureAuthorization(auth.id, { amount: usd("45.00"), final_capture: false });
    const voided = await pp.payments.voidAuthorization(auth.id);
    expect(voided.status).toBe("VOIDED");
    await expectIssue(pp.payments.voidAuthorization(auth.id), "PREVIOUSLY_VOIDED");
    await expectIssue(pp.payments.captureAuthorization(auth.id, { amount: usd("1.00") }), "AUTHORIZATION_VOIDED");
    const order = await pp.orders.get(voided.supplementary_data!.related_ids.order_id);
    expect(order.status).toBe("COMPLETED"); // something was captured
    expect(order.purchase_units![0].payments!.captures).toHaveLength(1);
  });

  it("marks the order VOIDED when nothing was captured", async () => {
    const auth = await authorization();
    await pp.payments.voidAuthorization(auth.id);
    expect((await pp.orders.get(auth.supplementary_data!.related_ids.order_id)).status).toBe("VOIDED");
  });

  it("cannot void a fully captured authorization", async () => {
    const auth = await authorization();
    await pp.payments.captureAuthorization(auth.id);
    await expectIssue(pp.payments.voidAuthorization(auth.id), "PREVIOUSLY_CAPTURED");
  });

  it("reauthorizes only after the 3-day honor period, with a new id", async () => {
    const auth = await authorization("50.00");
    await expectIssue(pp.payments.reauthorize(auth.id), "REAUTHORIZATION_TOO_SOON");
    pp.advanceTime(HONOR_PERIOD_MS + 60_000);
    const re = await pp.payments.reauthorize(auth.id, { amount: usd("55.00") });
    expect(re.id).not.toBe(auth.id);
    expect(re.status).toBe("CREATED");
    expect(re.expiration_time).toBe(auth.expiration_time);
    await expectIssue(pp.payments.reauthorize(re.id), "REAUTHORIZATION_NOT_SUPPORTED");
    await expectIssue(pp.payments.voidAuthorization(re.id), "CANNOT_BE_VOIDED");
  });

  it("expires after 29 days", async () => {
    const auth = await authorization();
    pp.advanceTime(30 * DAY);
    await expectIssue(pp.payments.captureAuthorization(auth.id), "AUTHORIZATION_EXPIRED");
  });
});

describe("refunds", () => {
  async function capture(value = "100.00") {
    const order = await approvedOrder("CAPTURE", value);
    return (await pp.orders.capture(order.id)).purchase_units![0].payments!.captures![0];
  }

  it("supports repeated partial refunds then a final full refund of the rest", async () => {
    const cap = await capture("100.00");
    const r1 = await pp.payments.refundCapture(cap.id, { amount: usd("25.00") });
    expect(r1.status).toBe("COMPLETED");
    expect((await pp.payments.getCapture(cap.id)).status).toBe("PARTIALLY_REFUNDED");
    const r2 = await pp.payments.refundCapture(cap.id, { amount: usd("25.00") });
    expect(r2.seller_payable_breakdown!.total_refunded_amount).toEqual(usd("50.00"));
    await expectIssue(pp.payments.refundCapture(cap.id, { amount: usd("50.01") }), "REFUND_AMOUNT_EXCEEDED");
    const r3 = await pp.payments.refundCapture(cap.id);
    expect(r3.amount).toEqual(usd("50.00"));
    expect((await pp.payments.getCapture(cap.id)).status).toBe("REFUNDED");
    await expectIssue(pp.payments.refundCapture(cap.id), "CAPTURE_FULLY_REFUNDED");
  });

  it("refuses refunds after 180 days and currency mismatches", async () => {
    const cap = await capture();
    await expectIssue(pp.payments.refundCapture(cap.id, { amount: { currency_code: "EUR", value: "1.00" } }), "REFUND_CAPTURE_CURRENCY_MISMATCH");
    pp.advanceTime(181 * DAY);
    await expectIssue(pp.payments.refundCapture(cap.id), "REFUND_TIME_LIMIT_EXCEEDED");
  });
});

describe("idempotency (PayPal-Request-Id)", () => {
  it("replays the first result instead of capturing twice", async () => {
    const auth = await authorization("100.00");
    const first = await pp.payments.captureAuthorization(auth.id, { amount: usd("40.00") }, { requestId: "req-1" });
    const again = await pp.payments.captureAuthorization(auth.id, { amount: usd("40.00") }, { requestId: "req-1" });
    expect(again.id).toBe(first.id);
    expect(pp.authorizationRemaining(auth.id)).toEqual(usd("60.00"));
  });
});

describe("payouts", () => {
  it("goes PENDING -> PROCESSING -> SUCCESS with per-item outcomes", async () => {
    const res = await pp.payouts.create({
      sender_batch_header: { sender_batch_id: "batch-1", email_subject: "You have a payout" },
      items: [
        { recipient_type: "EMAIL", receiver: "ada@example.com", amount: { currency: "USD", value: "10.00" } },
        { recipient_type: "EMAIL", receiver: "unclaimed@example.com", amount: { currency: "USD", value: "5.00" } },
        { recipient_type: "EMAIL", receiver: "fail@example.com", amount: { currency: "USD", value: "1.00" } },
      ],
    });
    expect(res.batch_header.payout_batch_id).toMatch(/^[0-9A-Z]{13}$/);
    expect(res.batch_header.batch_status).toBe("PENDING");
    pp.advanceTime(2000);
    expect((await pp.payouts.get(res.batch_header.payout_batch_id)).batch_header.batch_status).toBe("PROCESSING");
    pp.advanceTime(3000);
    const done = await pp.payouts.get(res.batch_header.payout_batch_id);
    expect(done.batch_header.batch_status).toBe("SUCCESS");
    expect(done.items.map((i) => i.transaction_status)).toEqual(["SUCCESS", "UNCLAIMED", "FAILED"]);
    await expect(pp.payouts.create({ sender_batch_header: { sender_batch_id: "batch-1" }, items: [{ receiver: "x@example.com", amount: { currency: "USD", value: "1.00" } }] })).rejects.toThrow(/already exists/);
  });

  it("honors PayPal's documented sandbox negative-test notes", async () => {
    await expect(pp.payouts.create({ sender_batch_header: {}, items: [{ receiver: "a@example.com", note: "ERRPYO005", amount: { currency: "USD", value: "1.00" } }] })).rejects.toMatchObject({ paypalName: "INSUFFICIENT_FUNDS" });
  });
});

describe("invoicing", () => {
  const draft = () =>
    pp.invoicing.create({
      detail: { currency_code: "USD", note: "Thanks!" },
      primary_recipients: [{ billing_info: { email_address: "client@example.com" } }],
      items: [
        { name: "Design", quantity: "2", unit_amount: usd("50.00"), tax: { name: "Tax", percent: "10" } },
        { name: "Hosting", quantity: "1", unit_amount: usd("20.00"), discount: { percent: "50" } },
      ],
    });

  it("computes totals and walks DRAFT -> SENT -> PARTIALLY_PAID -> MARKED_AS_PAID", async () => {
    const inv = await draft();
    expect(inv.id).toMatch(/^INV2(-[A-Z0-9]{4}){4}$/);
    expect(inv.status).toBe("DRAFT");
    expect(inv.amount.value).toBe("120.00"); // 100 + 10 tax + 20 - 10 discount
    await expectIssue(pp.invoicing.cancel(inv.id), "INVALID_INVOICE_STATUS");
    const link = await pp.invoicing.send(inv.id);
    expect(link.rel).toBe("payer-view");
    expect((await pp.invoicing.get(inv.id)).status).toBe("SENT");
    await pp.invoicing.remind(inv.id);
    await pp.invoicing.remind(inv.id);
    await expect(pp.invoicing.remind(inv.id)).rejects.toMatchObject({ status: 429 });
    await pp.invoicing.recordPayment(inv.id, { method: "BANK_TRANSFER", amount: usd("20.00") });
    expect((await pp.invoicing.get(inv.id)).status).toBe("PARTIALLY_PAID");
    const { payment_id } = await pp.invoicing.recordPayment(inv.id, { method: "CASH" });
    expect(payment_id).toMatch(/^EXTR-/);
    const paid = await pp.invoicing.get(inv.id);
    expect(paid.status).toBe("MARKED_AS_PAID");
    expect(paid.due_amount).toEqual(usd("0.00"));
  });

  it("cancels sent invoices and lists newest first", async () => {
    const a = await draft();
    const b = await draft();
    await pp.invoicing.send(b.id);
    await pp.invoicing.cancel(b.id);
    expect((await pp.invoicing.get(b.id)).status).toBe("CANCELLED");
    const list = await pp.invoicing.list({ total_required: true });
    expect(list.total_items).toBe(2);
    expect(list.items.map((i) => i.id)).toEqual([b.id, a.id]);
  });
});

describe("disputes", () => {
  it("opens, takes evidence, and resolves by accepting the claim (refunds the buyer)", async () => {
    const order = await approvedOrder("CAPTURE", "60.00");
    const cap = (await pp.orders.capture(order.id)).purchase_units![0].payments!.captures![0];
    const dispute = await pp.simulateDispute({ captureId: cap.id, reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED" });
    expect(dispute.dispute_id).toMatch(/^PP-D-\d+$/);
    expect(dispute.status).toBe("WAITING_FOR_SELLER_RESPONSE");
    const list = await pp.disputes.list({ dispute_state: "REQUIRED_ACTION" });
    expect(list.items).toHaveLength(1);
    await expectIssue(pp.disputes.provideEvidence(dispute.dispute_id, { evidences: [{ evidence_type: "PROOF_OF_FULFILLMENT" }] }), "MISSING_TRACKING_INFO");
    await pp.disputes.provideEvidence(dispute.dispute_id, { evidences: [{ evidence_type: "PROOF_OF_FULFILLMENT", evidence_info: { tracking_info: [{ carrier_name: "UPS", tracking_number: "1Z999" }] } }] });
    expect((await pp.disputes.get(dispute.dispute_id)).status).toBe("UNDER_REVIEW");
    await pp.disputes.acceptClaim(dispute.dispute_id, { note: "Refunding in full" });
    const resolved = await pp.disputes.get(dispute.dispute_id);
    expect(resolved.status).toBe("RESOLVED");
    expect(resolved.dispute_outcome?.amount_refunded).toEqual(usd("60.00"));
    expect((await pp.payments.getCapture(cap.id)).status).toBe("REFUNDED");
  });
});

describe("transaction search", () => {
  it("returns captures and refunds and enforces the 31-day window", async () => {
    const order = await approvedOrder("CAPTURE", "30.00");
    const cap = (await pp.orders.capture(order.id)).purchase_units![0].payments!.captures![0];
    await pp.payments.refundCapture(cap.id, { amount: usd("5.00") });
    const end = new Date(pp.now() + 60_000).toISOString();
    const start = new Date(pp.now() - DAY).toISOString();
    const res = await pp.transactions.search({ start_date: start, end_date: end });
    expect(res.transaction_details.map((t) => t.transaction_info.transaction_event_code)).toEqual(["T0006", "T1107"]);
    expect(res.transaction_details[1].transaction_info.transaction_amount.value).toBe("-5.00");
    await expectIssue(pp.transactions.search({ start_date: new Date(pp.now() - 40 * DAY).toISOString(), end_date: end }), "INVALID_DATE_RANGE");
  });
});

describe("vault (buyer-not-present charges)", () => {
  it("setup token -> approve -> payment token -> merchant-initiated order completes immediately", async () => {
    const setup = await pp.vault.createSetupToken({ payment_source: { paypal: { usage_type: "MERCHANT", description: "Monthly refills" } } });
    expect(setup.status).toBe("PAYER_ACTION_REQUIRED");
    await expectIssue(pp.vault.createPaymentToken({ payment_source: { token: { id: setup.id, type: "SETUP_TOKEN" } } }), "PAYER_ACTION_REQUIRED");
    await pp.approveSetupToken(setup.id);
    const token = await pp.vault.createPaymentToken({ payment_source: { token: { id: setup.id, type: "SETUP_TOKEN" } } });
    expect(token.id).toMatch(/^[0-9a-z]{7}$/);
    await expectIssue(pp.vault.createPaymentToken({ payment_source: { token: { id: setup.id, type: "SETUP_TOKEN" } } }), "SETUP_TOKEN_ALREADY_TOKENIZED");
    const order = await pp.orders.create({
      intent: "CAPTURE",
      purchase_units: [{ amount: usd("12.00") }],
      payment_source: { paypal: { vault_id: token.id, stored_credential: { payment_initiator: "MERCHANT", usage: "SUBSEQUENT", usage_pattern: "UNSCHEDULED_PREPAID" } } },
    });
    expect(order.status).toBe("COMPLETED");
    expect(order.purchase_units![0].payments!.captures![0].status).toBe("COMPLETED");
    expect((await pp.vault.listPaymentTokens(token.customer.id)).payment_tokens).toHaveLength(1);
  });
});

describe("webhooks", () => {
  it("emits events for each transition and signs/verifies them", async () => {
    const received: string[] = [];
    pp.onEvent((e) => {
      received.push(e.event_type);
    });
    const auth = await authorization("40.00");
    await pp.payments.captureAuthorization(auth.id, { amount: usd("10.00") });
    await pp.payments.voidAuthorization(auth.id);
    await pp.flushWebhooks();
    expect(received).toEqual(["CHECKOUT.ORDER.APPROVED", "PAYMENT.AUTHORIZATION.CREATED", "PAYMENT.CAPTURE.COMPLETED", "PAYMENT.AUTHORIZATION.VOIDED"]);
    const event = pp.events().at(-1)!;
    expect(event.id).toMatch(/^WH-[0-9A-Z]{17}-[0-9A-Z]{17}$/);
    const raw = JSON.stringify(event);
    const headers = new Headers(signMockWebhook(raw, "tx-1"));
    expect(verifyMockWebhook(headers, raw).verified).toBe(true);
    expect(verifyMockWebhook(headers, raw.replace("VOIDED", "CAPTURED")).verified).toBe(false);
  });
});
