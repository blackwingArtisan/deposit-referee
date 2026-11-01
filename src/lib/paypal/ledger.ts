/**
 * Local ledger of every PayPal object this app has touched (orders, authorizations,
 * captures, refunds, payouts, invoices, disputes, saved payment tokens).
 *
 * Why: PayPal has no "list my orders" API and sandbox Transaction Search lags ~3 hours, so
 * demo grids read this instead. It is filled automatically from API responses and webhooks.
 */
import { collection } from "../store/collection";
import { sumMoney, type Money } from "../money";
import type * as T from "./types";
import type { MoneyDirection } from "../events/types";

export type LedgerKind = "order" | "authorization" | "capture" | "refund" | "payout" | "invoice" | "dispute" | "payment_token";

export interface LedgerEntry {
  id: string;
  /** PayPal id of the object */
  paypalId: string;
  kind: LedgerKind;
  status: string;
  amount?: Money;
  direction: MoneyDirection;
  orderId?: string;
  parentId?: string;
  counterparty?: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  /** Insertion order; breaks ties between objects created in the same second. */
  seq: number;
}

const store = () => collection<LedgerEntry>("paypal-ledger");
let seqCounter = 0;

function upsert(entry: Omit<LedgerEntry, "id" | "createdAt" | "updatedAt" | "seq"> & { createdAt?: string }) {
  const id = `${entry.kind}:${entry.paypalId}`;
  const prev = store().get(id);
  const now = new Date().toISOString();
  const next: LedgerEntry = {
    ...prev,
    ...Object.fromEntries(Object.entries(entry).filter(([, v]) => v !== undefined)),
    id,
    createdAt: prev?.createdAt ?? entry.createdAt ?? now,
    updatedAt: now,
    seq: prev?.seq ?? Date.now() * 1000 + (seqCounter++ % 1000),
  } as LedgerEntry;
  store().upsert(next);
}

const upLink = (links: T.Link[] | undefined) => links?.find((l) => l.rel === "up")?.href.split("/").pop();

function ingestOrder(o: T.Order) {
  const units = o.purchase_units ?? [];
  const amounts = units.map((u) => ({ currency_code: u.amount.currency_code, value: u.amount.value }));
  const payer = o.payer?.email_address ?? o.payment_source?.card?.name;
  upsert({
    paypalId: o.id,
    kind: "order",
    status: o.status,
    amount: amounts.length ? sumMoney(amounts) : undefined,
    direction: "neutral",
    counterparty: payer,
    description: [o.intent, units[0]?.description].filter(Boolean).join(" · "),
    createdAt: o.create_time,
  });
  for (const u of units) {
    u.payments?.authorizations?.forEach((a) => ingestAuthorization(a, o.id, payer));
    u.payments?.captures?.forEach((c) => ingestCapture(c, o.id, payer));
    u.payments?.refunds?.forEach((r) => ingestRefund(r));
  }
}

function ingestAuthorization(a: T.Authorization, orderId?: string, payer?: string) {
  upsert({
    paypalId: a.id,
    kind: "authorization",
    status: a.status,
    amount: a.amount,
    direction: "hold",
    orderId: orderId ?? a.supplementary_data?.related_ids.order_id,
    parentId: orderId ?? a.supplementary_data?.related_ids.order_id,
    counterparty: payer,
    description: `Expires ${a.expiration_time?.slice(0, 10)}`,
    createdAt: a.create_time,
  });
}

function ingestCapture(c: T.Capture, orderId?: string, payer?: string) {
  upsert({
    paypalId: c.id,
    kind: "capture",
    status: c.status,
    amount: c.amount,
    direction: "in",
    orderId: orderId ?? c.supplementary_data?.related_ids.order_id,
    parentId: c.supplementary_data?.related_ids.authorization_id ?? orderId ?? c.supplementary_data?.related_ids.order_id,
    counterparty: payer,
    description: c.final_capture ? "Final capture" : "Partial capture",
    createdAt: c.create_time,
  });
}

function ingestRefund(r: T.Refund) {
  upsert({
    paypalId: r.id,
    kind: "refund",
    status: r.status,
    amount: r.amount,
    direction: "out",
    parentId: upLink(r.links),
    description: r.note_to_payer,
    createdAt: r.create_time,
  });
}

function ingestPayout(b: T.PayoutBatch | T.CreatePayoutResponse, request?: T.CreatePayoutRequest) {
  const items = "items" in b ? b.items.map((i) => i.payout_item) : request?.items;
  const amount = items?.length ? sumMoney(items.map((i) => ({ currency_code: i.amount.currency, value: i.amount.value }))) : undefined;
  upsert({
    paypalId: b.batch_header.payout_batch_id,
    kind: "payout",
    status: b.batch_header.batch_status,
    amount,
    direction: "out",
    counterparty: items?.map((i) => i.receiver).join(", "),
    description: items ? `${items.length} recipient${items.length === 1 ? "" : "s"}` : undefined,
    createdAt: b.batch_header.time_created,
  });
}

function ingestInvoice(i: T.Invoice) {
  upsert({
    paypalId: i.id,
    kind: "invoice",
    status: i.status,
    amount: i.amount ? { currency_code: i.amount.currency_code, value: i.amount.value } : undefined,
    direction: "in",
    counterparty: i.primary_recipients?.[0]?.billing_info?.email_address,
    description: i.detail?.invoice_number,
    createdAt: i.detail?.metadata?.create_time,
  });
}

function ingestDispute(d: T.DisputeSummary | T.Dispute) {
  upsert({
    paypalId: d.dispute_id,
    kind: "dispute",
    status: d.status,
    amount: d.dispute_amount,
    direction: "hold",
    parentId: "disputed_transactions" in d ? d.disputed_transactions?.[0]?.seller_transaction_id : undefined,
    description: d.reason,
    createdAt: d.create_time,
  });
}

/** Best-effort: recognizes any PayPal resource (or list of them) and records it. Never throws. */
export function ingestPayPalResource(value: unknown, request?: unknown) {
  try {
    if (!value || typeof value !== "object") return;
    const v = value as Record<string, unknown>;
    if ("batch_header" in v) return ingestPayout(v as unknown as T.PayoutBatch, request as T.CreatePayoutRequest);
    if ("dispute_id" in v) return ingestDispute(v as unknown as T.Dispute);
    if ("detail" in v && typeof v.detail === "object" && v.detail && "invoice_number" in (v.detail as object)) return ingestInvoice(v as unknown as T.Invoice);
    if ("invoice" in v && typeof v.invoice === "object") return ingestPayPalResource(v.invoice);
    if (Array.isArray(v.items)) return (v.items as unknown[]).forEach((i) => ingestPayPalResource(i));
    if (Array.isArray(v.payment_tokens)) return;
    if (typeof v.id !== "string") return;
    if ("purchase_units" in v || "intent" in v) return ingestOrder(v as unknown as T.Order);
    if ("expiration_time" in v) return ingestAuthorization(v as unknown as T.Authorization);
    if ("final_capture" in v) return ingestCapture(v as unknown as T.Capture);
    if ("seller_payable_breakdown" in v || (Array.isArray(v.links) && (v.links as T.Link[]).some((l) => l.rel === "up" && l.href.includes("/captures/")))) {
      return ingestRefund(v as unknown as T.Refund);
    }
    if ("customer" in v && "payment_source" in v && !("status" in v)) {
      const t = v as unknown as T.PaymentToken;
      return upsert({ paypalId: t.id, kind: "payment_token", status: "VAULTED", direction: "neutral", counterparty: t.payment_source.paypal?.email_address, description: `Customer ${t.customer.id}` });
    }
  } catch {
    /* ledger is a convenience; never break a payment flow over it */
  }
}

export const ledger = {
  list(filter: { kind?: LedgerKind } = {}): LedgerEntry[] {
    return store()
      .list()
      .filter((e) => !filter.kind || e.kind === filter.kind)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || (b.seq ?? 0) - (a.seq ?? 0));
  },
  get(kind: LedgerKind, paypalId: string) {
    return store().get(`${kind}:${paypalId}`);
  },
  clear() {
    store().clear();
  },
};
