/**
 * Toolkit-style extensions: PayPal operations the Agent Toolkit 1.11 does not cover
 * (authorize / partial capture / void / reauthorize, payouts, vaulted charges), written in
 * the same snake_case style and guarded the same way.
 */
import { z } from "zod";
import { formatMoney, money, moneyFromMinor, toMinor, type Money } from "../../money";
import type { PayPalApi } from "../../paypal/api";
import type * as T from "../../paypal/types";
import { defineTool } from "../tool";

const amountString = z.string().regex(/^\d+(\.\d{1,2})?$/, 'Decimal string like "45.00"');
const currency = z.string().length(3).default("USD");

/** Authorized minus captured so far, computed from the order (works in sandbox and mock). */
export async function authorizationState(pp: PayPalApi, authorizationId: string) {
  const auth = await pp.payments.getAuthorization(authorizationId);
  const orderId = auth.supplementary_data?.related_ids.order_id;
  const order = orderId ? await pp.orders.get(orderId) : null;
  // Captures inside an order have no supplementary_data on the real API, only the "up" link.
  const belongsToAuth = (c: T.Capture) => c.supplementary_data?.related_ids.authorization_id === authorizationId || c.links.some((l) => l.rel === "up" && l.href.endsWith(`/authorizations/${authorizationId}`));
  const captures = (order?.purchase_units ?? []).flatMap((u) => u.payments?.captures ?? []).filter(belongsToAuth);
  const cur = auth.amount.currency_code;
  const capturedMinor = captures.filter((c) => c.status !== "DECLINED" && c.status !== "FAILED").reduce((s, c) => s + toMinor(c.amount.value, cur), 0);
  const remaining = moneyFromMinor(Math.max(0, toMinor(auth.amount.value, cur) - capturedMinor), cur);
  return { authorization: auth, orderId, captured: moneyFromMinor(capturedMinor, cur), remaining, captures, payer: order?.payer?.email_address };
}

export const createAuthorizationOrder = defineTool({
  name: "create_authorization_order",
  description:
    "Create a PayPal order with intent AUTHORIZE: after the buyer approves, funds are held (authorized) and can be captured later, partially or in full, then the remainder voided. Use for pay-on-delivery, deposits, or anything where the final amount is not known yet. Returns the order id and the buyer approval link.",
  risk: "write",
  source: "kit-extension",
  schema: z.object({
    amount: amountString.describe("Total to authorize"),
    currency_code: currency,
    description: z.string().max(127).optional(),
    invoice_id: z.string().max(127).optional().describe("Your reference; must be unique per order"),
  }),
  impact: async (i) => {
    const amount = money(i.amount, i.currency_code);
    return { amount, summary: `Create a ${formatMoney(amount)} AUTHORIZE order` };
  },
  execute: async (i, ctx) => {
    const order = await ctx.paypal.orders.create(
      { intent: "AUTHORIZE", purchase_units: [{ amount: { currency_code: i.currency_code, value: money(i.amount, i.currency_code).value }, description: i.description, invoice_id: i.invoice_id }] },
      { requestId: ctx.requestId },
    );
    return { id: order.id, status: order.status, approve_link: order.links.find((l) => l.rel === "approve" || l.rel === "payer-action")?.href };
  },
});

export const authorizeOrder = defineTool({
  name: "authorize_order",
  description: "Authorize a buyer-approved AUTHORIZE-intent order, placing a hold on the funds. Returns the authorization id and its expiry (29 days; the first 3 days are the honor period).",
  risk: "write",
  source: "kit-extension",
  schema: z.object({ order_id: z.string().min(10) }),
  impact: async (i, ctx) => {
    const o = await ctx.paypal.orders.get(i.order_id);
    const u = o.purchase_units?.[0];
    const amount = u ? money(u.amount.value, u.amount.currency_code) : undefined;
    return { amount, summary: `Authorize ${amount ? formatMoney(amount) : "order"} on ${i.order_id}` };
  },
  execute: async (i, ctx) => {
    const o = await ctx.paypal.orders.authorize(i.order_id, { requestId: ctx.requestId });
    const a = o.purchase_units?.[0]?.payments?.authorizations?.[0];
    return { order_id: o.id, order_status: o.status, authorization_id: a?.id, authorization_status: a?.status, amount: a?.amount, expiration_time: a?.expiration_time };
  },
});

export const getAuthorization = defineTool({
  name: "get_authorization",
  description: "Get an authorization's status, the authorized amount, how much has been captured, and how much remains capturable.",
  risk: "read",
  source: "kit-extension",
  schema: z.object({ authorization_id: z.string().min(10) }),
  title: (i) => `Check authorization ${i.authorization_id}`,
  execute: async (i, ctx) => {
    const s = await authorizationState(ctx.paypal, i.authorization_id);
    return {
      authorization_id: s.authorization.id,
      status: s.authorization.status,
      authorized: s.authorization.amount,
      captured: s.captured,
      remaining: s.remaining,
      expiration_time: s.authorization.expiration_time,
      order_id: s.orderId,
      captures: s.captures.map((c) => ({ id: c.id, amount: c.amount, status: c.status, final_capture: c.final_capture })),
    };
  },
});

export const captureAuthorization = defineTool({
  name: "capture_authorization",
  description:
    "Capture money from an authorization. Pass `amount` for a partial capture (repeatable) and final_capture=true on the last one; omit amount to capture everything that remains. Moves money from the buyer to the merchant.",
  risk: "money",
  source: "kit-extension",
  schema: z.object({
    authorization_id: z.string().min(10),
    amount: amountString.optional().describe("Omit to capture the full remaining amount"),
    currency_code: currency,
    final_capture: z.boolean().optional().describe("true = no more captures after this one"),
    invoice_id: z.string().max(127).optional(),
    note_to_payer: z.string().max(255).optional(),
    idempotency_key: z.string().optional().describe("Optional: same key => never captured twice"),
  }),
  impact: async (i, ctx) => {
    const s = await authorizationState(ctx.paypal, i.authorization_id);
    const amount: Money = i.amount ? money(i.amount, i.currency_code) : s.remaining;
    // Money flows in from the payer, so no counterparty allowlist check applies.
    return { amount, summary: `Capture ${formatMoney(amount)} of the ${formatMoney(s.authorization.amount)} authorization` };
  },
  execute: async (i, ctx) => {
    const cap = await ctx.paypal.payments.captureAuthorization(
      i.authorization_id,
      { ...(i.amount ? { amount: money(i.amount, i.currency_code) } : {}), final_capture: i.final_capture, invoice_id: i.invoice_id, note_to_payer: i.note_to_payer },
      { requestId: ctx.requestId },
    );
    return { capture_id: cap.id, status: cap.status, amount: cap.amount, final_capture: cap.final_capture, net_amount: cap.seller_receivable_breakdown?.net_amount };
  },
});

export const voidAuthorization = defineTool({
  name: "void_authorization",
  description: "Void an authorization, releasing whatever has not been captured back to the buyer. Irreversible. Fails if the authorization is already fully captured.",
  risk: "write",
  source: "kit-extension",
  schema: z.object({ authorization_id: z.string().min(10), reason: z.string().optional() }),
  impact: async (i, ctx) => {
    const s = await authorizationState(ctx.paypal, i.authorization_id);
    return { amount: s.remaining, summary: `Void the remaining ${formatMoney(s.remaining)} hold` };
  },
  execute: async (i, ctx) => {
    const a = await ctx.paypal.payments.voidAuthorization(i.authorization_id, { requestId: ctx.requestId });
    return { authorization_id: a.id, status: a.status };
  },
});

export const reauthorizeAuthorization = defineTool({
  name: "reauthorize_authorization",
  description: "Reauthorize an uncaptured authorization after its 3-day honor period (days 4-29) to refresh the funds hold. Returns a NEW authorization id. Amount may be up to 115% of the original (max +$75).",
  risk: "write",
  source: "kit-extension",
  schema: z.object({ authorization_id: z.string().min(10), amount: amountString.optional(), currency_code: currency }),
  impact: async (i, ctx) => {
    const a = await ctx.paypal.payments.getAuthorization(i.authorization_id);
    const amount = i.amount ? money(i.amount, i.currency_code) : money(a.amount.value, a.amount.currency_code);
    return { amount, summary: `Reauthorize ${formatMoney(amount)}` };
  },
  execute: async (i, ctx) => {
    const a = await ctx.paypal.payments.reauthorize(i.authorization_id, i.amount ? { amount: money(i.amount, i.currency_code) } : {}, { requestId: ctx.requestId });
    return { new_authorization_id: a.id, status: a.status, amount: a.amount, expiration_time: a.expiration_time };
  },
});

export const getCapture = defineTool({
  name: "get_capture",
  description: "Get a capture's status (COMPLETED, PARTIALLY_REFUNDED, REFUNDED...), amount and fees.",
  risk: "read",
  source: "kit-extension",
  schema: z.object({ capture_id: z.string().min(10) }),
  title: (i) => `Check capture ${i.capture_id}`,
  execute: async (i, ctx) => {
    const c = await ctx.paypal.payments.getCapture(i.capture_id);
    return { capture_id: c.id, status: c.status, amount: c.amount, final_capture: c.final_capture, breakdown: c.seller_receivable_breakdown, create_time: c.create_time };
  },
});

export const createPayout = defineTool({
  name: "create_payout",
  description:
    "Send money to one or more people by email using PayPal Payouts (batch). Each recipient gets a PayPal notification. The batch starts PENDING; check it with get_payout. Only pay recipients the user explicitly asked you to pay.",
  risk: "money",
  source: "kit-extension",
  schema: z.object({
    items: z
      .array(z.object({ receiver: z.string().email(), amount: amountString, currency: currency, note: z.string().max(4000).optional(), sender_item_id: z.string().max(63).optional() }))
      .min(1)
      .max(50),
    email_subject: z.string().max(255).optional(),
    email_message: z.string().max(1000).optional(),
    sender_batch_id: z.string().max(256).optional().describe("Your unique batch reference; reusing one is rejected for 30 days"),
  }),
  impact: async (i) => {
    const cur = i.items[0].currency;
    const totalMinor = i.items.reduce((s, it) => s + toMinor(it.amount, it.currency), 0);
    const amount = moneyFromMinor(totalMinor, cur);
    return { amount, counterparties: i.items.map((it) => it.receiver), summary: `Pay out ${formatMoney(amount)} to ${i.items.length} recipient${i.items.length === 1 ? "" : "s"}` };
  },
  execute: async (i, ctx) => {
    const body: T.CreatePayoutRequest = {
      sender_batch_header: { sender_batch_id: i.sender_batch_id ?? `kit-${ctx.idempotencyKey}`, email_subject: i.email_subject ?? "You have a payout!", email_message: i.email_message, recipient_type: "EMAIL" },
      items: i.items.map((it) => ({ recipient_type: "EMAIL", receiver: it.receiver, amount: { currency: it.currency, value: money(it.amount, it.currency).value }, note: it.note, sender_item_id: it.sender_item_id })),
    };
    const res = await ctx.paypal.payouts.create(body, { requestId: ctx.requestId });
    return { payout_batch_id: res.batch_header.payout_batch_id, batch_status: res.batch_header.batch_status };
  },
});

export const getPayout = defineTool({
  name: "get_payout",
  description: "Get a payout batch status and each item's status (SUCCESS, UNCLAIMED, FAILED...).",
  risk: "read",
  source: "kit-extension",
  schema: z.object({ payout_batch_id: z.string().min(5) }),
  title: (i) => `Check payout ${i.payout_batch_id}`,
  execute: async (i, ctx) => {
    const b = await ctx.paypal.payouts.get(i.payout_batch_id);
    return {
      payout_batch_id: b.batch_header.payout_batch_id,
      batch_status: b.batch_header.batch_status,
      amount: b.batch_header.amount,
      fees: b.batch_header.fees,
      items: b.items.map((it) => ({ receiver: it.payout_item.receiver, amount: it.payout_item.amount, status: it.transaction_status, error: it.errors?.message })),
    };
  },
});

export const chargeSavedPaymentMethod = defineTool({
  name: "charge_saved_payment_method",
  description:
    "Charge a buyer's saved PayPal wallet (Vault payment token) without the buyer present: a merchant-initiated, unscheduled charge that completes immediately. Only for customers who saved their PayPal for this purpose.",
  risk: "money",
  source: "kit-extension",
  schema: z.object({
    vault_id: z.string().min(5).describe("Payment token id from Vault"),
    amount: amountString,
    currency_code: currency,
    description: z.string().max(127).optional(),
    invoice_id: z.string().max(127).optional(),
  }),
  impact: async (i, ctx) => {
    const token = await ctx.paypal.vault.getPaymentToken(i.vault_id);
    const amount = money(i.amount, i.currency_code);
    const who = token.payment_source.paypal?.email_address ?? token.customer.id;
    return { amount, counterparties: [who], summary: `Charge ${formatMoney(amount)} to ${who}'s saved PayPal` };
  },
  execute: async (i, ctx) => {
    const order = await ctx.paypal.orders.create(
      {
        intent: "CAPTURE",
        purchase_units: [{ amount: { currency_code: i.currency_code, value: money(i.amount, i.currency_code).value }, description: i.description, invoice_id: i.invoice_id }],
        payment_source: { paypal: { vault_id: i.vault_id, stored_credential: { payment_initiator: "MERCHANT", usage: "SUBSEQUENT", usage_pattern: "UNSCHEDULED_PREPAID" } } },
      },
      { requestId: ctx.requestId },
    );
    const cap = order.purchase_units?.[0]?.payments?.captures?.[0];
    return { order_id: order.id, status: order.status, capture_id: cap?.id, capture_status: cap?.status, amount: cap?.amount };
  },
});

export const KIT_EXTENSION_TOOLS = [
  createAuthorizationOrder,
  authorizeOrder,
  getAuthorization,
  captureAuthorization,
  voidAuthorization,
  reauthorizeAuthorization,
  getCapture,
  createPayout,
  getPayout,
  chargeSavedPaymentMethod,
];
