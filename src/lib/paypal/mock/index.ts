/**
 * MockPayPal: an in-memory PayPal with the same shapes, statuses, transitions and error codes
 * as the sandbox, so every app can demo end-to-end with no credentials.
 *
 * Realism:
 *   - ids look like PayPal's (17-char order/capture ids, INV2-..., PP-D-..., WH-...)
 *   - status machines follow PayPal's docs (see comments per method)
 *   - PayPal-Request-Id idempotency: same id + same operation => stored result replayed
 *   - webhook events are emitted on every transition (and can be replayed via /api/dev/webhooks)
 *   - latency is simulated (MOCK_PAYPAL_LATENCY_MS)
 *   - a controllable clock (advanceTime) for honor periods, expiry, payout progress
 *
 * Dev-only helpers start with `simulate` / `advance` and have no PayPal REST equivalent.
 */
import { randomUUID } from "node:crypto";
import type { PayPalApi, RequestOptions } from "../api";
import { PayPalApiError } from "../errors";
import { recordCallMeta } from "../meta";
import type * as T from "../types";
import { resourceTypeFor, verifyMockWebhook } from "../webhooks";
import { apiError, invalidRequest, notFound, payoutsError, unprocessable } from "./errors";
import { mockIds } from "./ids";
import { fileMtimeMs, readJsonFile, writeJsonFile } from "../../store/files";
import {
  addMoney,
  compareMoney,
  fromMinor,
  money,
  moneyFromMinor,
  scaleMoney,
  subtractMoney,
  sumMoney,
  toMinor,
  type Money,
} from "../../money";

const API = "https://api-m.sandbox.paypal.com";
const WEB = "https://www.sandbox.paypal.com";
const DAY = 24 * 60 * 60 * 1000;
export const HONOR_PERIOD_MS = 3 * DAY;
export const AUTHORIZATION_VALIDITY_MS = 29 * DAY;
export const REFUND_WINDOW_MS = 180 * DAY;

/** Approximate PayPal US checkout fee used for seller_receivable_breakdown (3.49% + $0.49). */
const FEE_RATE = 0.0349;
const FEE_FIXED_MINOR = 49;

// ───────────────────────────── internal state ─────────────────────────────

interface OrderRecord {
  order: T.Order;
  authorizationIds: string[];
  captureIds: string[];
}
interface AuthRecord {
  auth: T.Authorization;
  orderId: string;
  referenceId: string;
  capturedMinor: number;
  captureIds: string[];
  parentId?: string;
  childIds: string[];
  honorUntil: number;
  payerEmail?: string;
}
interface CaptureRecord {
  capture: T.Capture;
  orderId?: string;
  authorizationId?: string;
  referenceId: string;
  refundedMinor: number;
  refundIds: string[];
  feeMinor: number;
  payerEmail?: string;
}
interface RefundRecord {
  refund: T.Refund;
  captureId: string;
}
interface PayoutRecord {
  batch: T.PayoutBatch;
  createdAt: number;
  phase: "PENDING" | "PROCESSING" | "DONE";
}
interface InvoiceRecord {
  invoice: T.Invoice;
  reminders: { day: string; count: number };
}
interface DisputeRecord {
  dispute: T.Dispute;
  captureId: string;
}
interface SetupTokenRecord {
  token: T.SetupToken;
  payerEmail?: string;
  payerId?: string;
}

export interface MockState {
  version: 1;
  clockOffsetMs: number;
  merchantId: string;
  orders: Record<string, OrderRecord>;
  authorizations: Record<string, AuthRecord>;
  captures: Record<string, CaptureRecord>;
  refunds: Record<string, RefundRecord>;
  payouts: Record<string, PayoutRecord>;
  senderBatchIds: Record<string, string>;
  invoices: Record<string, InvoiceRecord>;
  invoiceSeq: number;
  disputes: Record<string, DisputeRecord>;
  setupTokens: Record<string, SetupTokenRecord>;
  paymentTokens: Record<string, T.PaymentToken>;
  transactions: T.TransactionSearchResponse["transaction_details"];
  events: T.WebhookEventEnvelope[];
  idempotency: Record<string, { result: unknown; status: number }>;
}

function emptyState(): MockState {
  return {
    version: 1,
    clockOffsetMs: 0,
    merchantId: mockIds.merchant(),
    orders: {},
    authorizations: {},
    captures: {},
    refunds: {},
    payouts: {},
    senderBatchIds: {},
    invoices: {},
    invoiceSeq: 1000,
    disputes: {},
    setupTokens: {},
    paymentTokens: {},
    transactions: [],
    events: [],
    idempotency: {},
  };
}

export interface MockPayPalOptions {
  /** [min, max] simulated latency per call in ms. Default [0, 0]. */
  latencyMs?: [number, number];
  /** JSON snapshot path; state is loaded from and saved to it. Omit for pure in-memory. */
  persistFile?: string;
  /** Delay before webhook listeners are called. Default 0. */
  webhookDelayMs?: number;
  /** Advance payout batches automatically with timers. Default false. */
  autoAdvancePayouts?: boolean;
  /** Max captures per authorization (PayPal: account setting). Default 10. */
  maxCapturesPerAuthorization?: number;
  /** PayPal docs disagree (once vs many). Default 1. */
  maxReauthorizations?: number;
  /** Buyer used by simulateBuyerApproval when none is given. */
  defaultBuyer?: { email: string; givenName?: string; surname?: string };
  merchantEmail?: string;
}

type Listener = (event: T.WebhookEventEnvelope) => void | Promise<void>;
interface IoContext {
  status: number;
}

const clone = <V>(v: V): V => structuredClone(v);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function assertMoney(m: Money | undefined, field: string): Money {
  if (!m || typeof m.value !== "string" || typeof m.currency_code !== "string" || m.currency_code.length !== 3) {
    throw invalidRequest("MISSING_REQUIRED_PARAMETER", `${field} (currency_code + value) is required.`);
  }
  try {
    return money(m.value, m.currency_code);
  } catch {
    throw invalidRequest("DECIMAL_PRECISION", `${field}.value "${m.value}" is not a valid amount for ${m.currency_code}.`);
  }
}

/** PayPal's capture/reauthorization overage limit: 115% of the original, at most +$75 (USD). */
function overageLimitMinor(authorized: Money): number {
  const minor = toMinor(authorized.value, authorized.currency_code);
  const pct = Math.floor(minor * 1.15);
  return authorized.currency_code === "USD" ? Math.min(pct, minor + 7500) : pct;
}

function feeFor(gross: Money): Money {
  const minor = toMinor(gross.value, gross.currency_code);
  return moneyFromMinor(Math.round(minor * FEE_RATE) + (gross.currency_code === "USD" ? FEE_FIXED_MINOR : 0), gross.currency_code);
}

export class MockPayPal implements PayPalApi {
  readonly mode = "mock" as const;
  private state: MockState;
  private listeners = new Set<Listener>();
  private pendingDeliveries = new Set<Promise<void>>();
  /** Events raised by the current operation; delivered only if it succeeds. */
  private outbox: T.WebhookEventEnvelope[] = [];
  private loadedMtime = 0;
  private readonly opts: Required<Omit<MockPayPalOptions, "persistFile">> & { persistFile?: string };

  constructor(options: MockPayPalOptions = {}) {
    this.opts = {
      latencyMs: options.latencyMs ?? [0, 0],
      webhookDelayMs: options.webhookDelayMs ?? 0,
      autoAdvancePayouts: options.autoAdvancePayouts ?? false,
      maxCapturesPerAuthorization: options.maxCapturesPerAuthorization ?? 10,
      maxReauthorizations: options.maxReauthorizations ?? 1,
      defaultBuyer: options.defaultBuyer ?? { email: "buyer@personal.example.com", givenName: "Sam", surname: "Buyer" },
      merchantEmail: options.merchantEmail ?? "seller@business.example.com",
      persistFile: options.persistFile,
    };
    this.state = emptyState();
    if (this.opts.persistFile) this.loadFromDisk();
  }

  // ───────────── clock, persistence, io ─────────────

  now(): number {
    return Date.now() + this.state.clockOffsetMs;
  }
  private iso(at = this.now()) {
    return new Date(at).toISOString().replace(/\.\d{3}Z$/, "Z");
  }
  /** Dev helper: move the mock clock forward (honor period, expiry, payout progress). */
  advanceTime(ms: number) {
    this.state.clockOffsetMs += ms;
    this.save();
  }

  private loadFromDisk() {
    const file = this.opts.persistFile!;
    const loaded = readJsonFile<MockState | null>(file, null);
    if (loaded?.version === 1) this.state = { ...emptyState(), ...loaded };
    this.loadedMtime = fileMtimeMs(file);
  }
  /** Picks up changes written by another process (e.g. `npm run seed`). */
  private syncFromDisk() {
    if (!this.opts.persistFile) return;
    const mtime = fileMtimeMs(this.opts.persistFile);
    if (mtime && mtime !== this.loadedMtime) this.loadFromDisk();
  }
  private save() {
    if (!this.opts.persistFile) return;
    this.state.events = this.state.events.slice(-500);
    writeJsonFile(this.opts.persistFile, this.state);
    this.loadedMtime = fileMtimeMs(this.opts.persistFile);
  }

  private async io<R>(op: string, opts: RequestOptions | undefined, fn: (ctx: IoContext) => R, defaultStatus = 200): Promise<R> {
    const [min, max] = this.opts.latencyMs;
    if (max > 0) await sleep(min + Math.random() * (max - min));
    this.syncFromDisk();
    const key = opts?.requestId ? `${op}:${opts.requestId}` : undefined;
    if (key && this.state.idempotency[key]) {
      const stored = this.state.idempotency[key];
      recordCallMeta({ httpStatus: 200, debugId: mockIds.debugId(), requestId: opts?.requestId, replayed: true });
      return clone(stored.result) as R;
    }
    if (opts?.mockResponse?.mock_application_codes) {
      const code = opts.mockResponse.mock_application_codes;
      const e = unprocessable(code, `Negative test (PayPal-Mock-Response): ${code}`);
      recordCallMeta({ httpStatus: 422, debugId: e.debugId, requestId: opts.requestId });
      throw e;
    }
    const ctx: IoContext = { status: defaultStatus };
    // Operations are atomic: on any error the state rolls back and no webhook is delivered.
    const backup = JSON.stringify(this.state);
    this.outbox = [];
    try {
      const result = fn(ctx);
      if (key) this.state.idempotency[key] = { result: clone(result), status: ctx.status };
      this.state.events.push(...this.outbox);
      this.save();
      for (const event of this.outbox) this.deliver(event);
      recordCallMeta({ httpStatus: ctx.status, debugId: mockIds.debugId(), requestId: opts?.requestId });
      return clone(result);
    } catch (e) {
      this.state = JSON.parse(backup) as MockState;
      if (e instanceof PayPalApiError) recordCallMeta({ httpStatus: e.status, debugId: e.debugId, requestId: opts?.requestId });
      throw e;
    } finally {
      this.outbox = [];
    }
  }

  // ───────────── webhooks ─────────────

  onEvent(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  events(): T.WebhookEventEnvelope[] {
    this.syncFromDisk();
    return clone(this.state.events);
  }
  /** Resolves once queued webhook deliveries have run (tests). */
  async flushWebhooks() {
    while (this.pendingDeliveries.size) await Promise.all([...this.pendingDeliveries]);
  }

  private emit(eventType: string, resource: unknown, summary: string) {
    const event: T.WebhookEventEnvelope = {
      id: mockIds.webhookEvent(),
      event_version: "1.0",
      create_time: this.iso(),
      resource_type: resourceTypeFor(eventType),
      resource_version: eventType.startsWith("PAYMENT.PAYOUTS") ? "1.0" : "2.0",
      event_type: eventType,
      summary,
      resource: clone(resource),
      links: [],
    };
    event.links = [
      { href: `${API}/v1/notifications/webhooks-events/${event.id}`, rel: "self", method: "GET" },
      { href: `${API}/v1/notifications/webhooks-events/${event.id}/resend`, rel: "resend", method: "POST" },
    ];
    this.outbox.push(event);
  }

  private deliver(event: T.WebhookEventEnvelope) {
    const delivery = (async () => {
      if (this.opts.webhookDelayMs) await sleep(this.opts.webhookDelayMs);
      for (const l of this.listeners) {
        try {
          await l(clone(event));
        } catch {
          /* listener errors are the app's problem, not the mock's */
        }
      }
    })();
    this.pendingDeliveries.add(delivery);
    void delivery.finally(() => this.pendingDeliveries.delete(delivery));
  }

  // ───────────── rendering helpers ─────────────

  private renderOrder(id: string): T.Order {
    const rec = this.state.orders[id];
    if (!rec) throw notFound("order", id);
    const order = clone(rec.order);
    for (const pu of order.purchase_units ?? []) {
      const auths = rec.authorizationIds.map((a) => this.state.authorizations[a]).filter((a) => a && a.referenceId === pu.reference_id);
      const caps = rec.captureIds
        .concat(auths.flatMap((a) => a.captureIds))
        .filter((c, i, all) => all.indexOf(c) === i)
        .map((c) => this.state.captures[c])
        .filter((c) => c && c.referenceId === pu.reference_id);
      const refunds = caps.flatMap((c) => c.refundIds.map((r) => this.state.refunds[r]?.refund)).filter(Boolean) as T.Refund[];
      if (auths.length || caps.length) {
        pu.payments = {
          ...(auths.length ? { authorizations: auths.map((a) => clone(a.auth)) } : {}),
          ...(caps.length ? { captures: caps.map((c) => clone(c.capture)) } : {}),
          ...(refunds.length ? { refunds: clone(refunds) } : {}),
        };
      }
    }
    return order;
  }

  private orderLinks(order: T.Order): T.Link[] {
    const self = { href: `${API}/v2/checkout/orders/${order.id}`, rel: "self", method: "GET" as const };
    const action = order.intent === "AUTHORIZE" ? "authorize" : "capture";
    switch (order.status) {
      case "CREATED":
        return [
          self,
          { href: `${WEB}/checkoutnow?token=${order.id}`, rel: "approve", method: "GET" },
          { href: `${API}/v2/checkout/orders/${order.id}`, rel: "update", method: "PATCH" },
          { href: `${API}/v2/checkout/orders/${order.id}/${action}`, rel: action, method: "POST" },
        ];
      case "PAYER_ACTION_REQUIRED":
        return [self, { href: `${WEB}/checkoutnow?token=${order.id}`, rel: "payer-action", method: "GET" }];
      case "APPROVED":
        return [
          self,
          { href: `${API}/v2/checkout/orders/${order.id}`, rel: "update", method: "PATCH" },
          { href: `${API}/v2/checkout/orders/${order.id}/${action}`, rel: action, method: "POST" },
        ];
      default:
        return [self];
    }
  }

  private authLinks(rec: AuthRecord): T.Link[] {
    const base = `${API}/v2/payments/authorizations/${rec.auth.id}`;
    const links: T.Link[] = [{ href: base, rel: "self", method: "GET" }];
    if (rec.auth.status === "CREATED" || rec.auth.status === "PARTIALLY_CAPTURED") {
      links.push({ href: `${base}/capture`, rel: "capture", method: "POST" }, { href: `${base}/void`, rel: "void", method: "POST" });
      if (rec.auth.status === "CREATED" && !rec.parentId) links.push({ href: `${base}/reauthorize`, rel: "reauthorize", method: "POST" });
    }
    links.push({ href: `${API}/v2/checkout/orders/${rec.orderId}`, rel: "up", method: "GET" });
    return links;
  }

  private captureLinks(rec: CaptureRecord): T.Link[] {
    const base = `${API}/v2/payments/captures/${rec.capture.id}`;
    const links: T.Link[] = [{ href: base, rel: "self", method: "GET" }];
    if (rec.capture.status === "COMPLETED" || rec.capture.status === "PARTIALLY_REFUNDED") {
      links.push({ href: `${base}/refund`, rel: "refund", method: "POST" });
    }
    links.push(
      rec.authorizationId
        ? { href: `${API}/v2/payments/authorizations/${rec.authorizationId}`, rel: "up", method: "GET" }
        : { href: `${API}/v2/checkout/orders/${rec.orderId}`, rel: "up", method: "GET" },
    );
    return links;
  }

  private touchOrder(orderId: string, status?: T.OrderStatus) {
    const rec = this.state.orders[orderId];
    if (!rec) return;
    if (status) rec.order.status = status;
    rec.order.update_time = this.iso();
    rec.order.links = this.orderLinks(rec.order);
  }

  private ensureUniqueInvoiceId(invoiceId?: string) {
    if (!invoiceId) return;
    const used =
      Object.values(this.state.orders).some((o) => o.order.purchase_units?.some((p) => p.invoice_id === invoiceId)) ||
      Object.values(this.state.captures).some((c) => c.capture.invoice_id === invoiceId);
    if (used) throw unprocessable("DUPLICATE_INVOICE_ID", "Duplicate Invoice ID detected. To avoid a potential duplicate transaction your account setting requires that Invoice Id be unique for each transaction.");
  }

  private recordTransaction(info: Omit<T.TransactionInfo, "transaction_initiation_date" | "transaction_updated_date" | "transaction_status"> & { status?: T.TransactionStatusCode }, payerEmail?: string) {
    const { status, ...rest } = info;
    this.state.transactions.push({
      transaction_info: {
        ...rest,
        paypal_account_id: this.state.merchantId,
        transaction_initiation_date: this.iso(),
        transaction_updated_date: this.iso(),
        transaction_status: status ?? "S",
      },
      payer_info: payerEmail ? { email_address: payerEmail } : undefined,
    });
  }

  // ───────────── capture creation (shared by orders, authorizations, vault, invoices) ─────────────

  private createCapture(input: {
    amount: Money;
    referenceId: string;
    orderId?: string;
    authorizationId?: string;
    finalCapture: boolean;
    invoiceId?: string;
    customId?: string;
    noteToPayer?: string;
    payerEmail?: string;
  }): CaptureRecord {
    const fee = feeFor(input.amount);
    const now = this.iso();
    const capture: T.Capture = {
      id: mockIds.capture(),
      status: "COMPLETED",
      amount: clone(input.amount),
      final_capture: input.finalCapture,
      disbursement_mode: "INSTANT",
      seller_protection: { status: "ELIGIBLE", dispute_categories: ["ITEM_NOT_RECEIVED", "UNAUTHORIZED_TRANSACTION"] },
      seller_receivable_breakdown: { gross_amount: clone(input.amount), paypal_fee: fee, net_amount: subtractMoney(input.amount, fee) },
      ...(input.invoiceId ? { invoice_id: input.invoiceId } : {}),
      ...(input.customId ? { custom_id: input.customId } : {}),
      ...(input.noteToPayer ? { note_to_payer: input.noteToPayer } : {}),
      supplementary_data: { related_ids: { ...(input.orderId ? { order_id: input.orderId } : {}), ...(input.authorizationId ? { authorization_id: input.authorizationId } : {}) } },
      links: [],
      create_time: now,
      update_time: now,
    };
    const rec: CaptureRecord = {
      capture,
      orderId: input.orderId,
      authorizationId: input.authorizationId,
      referenceId: input.referenceId,
      refundedMinor: 0,
      refundIds: [],
      feeMinor: toMinor(fee.value, fee.currency_code),
      payerEmail: input.payerEmail,
    };
    rec.capture.links = this.captureLinks(rec);
    this.state.captures[capture.id] = rec;
    this.recordTransaction(
      {
        transaction_id: capture.id,
        paypal_reference_id: input.orderId ?? input.authorizationId,
        paypal_reference_id_type: input.orderId ? "ODR" : "TXN",
        transaction_event_code: "T0006",
        transaction_amount: clone(input.amount),
        fee_amount: { currency_code: fee.currency_code, value: fromMinor(-toMinor(fee.value, fee.currency_code), fee.currency_code) },
        invoice_id: input.invoiceId,
        custom_field: input.customId,
      },
      input.payerEmail,
    );
    this.emit("PAYMENT.CAPTURE.COMPLETED", capture, `Payment completed for ${capture.amount.value} ${capture.amount.currency_code}`);
    return rec;
  }

  private createAuthorization(input: { orderId: string; referenceId: string; amount: Money; invoiceId?: string; customId?: string; payerEmail?: string; parentId?: string; expiresAt?: number }): AuthRecord {
    const nowMs = this.now();
    const auth: T.Authorization = {
      id: mockIds.authorization(),
      status: "CREATED",
      amount: clone(input.amount),
      ...(input.invoiceId ? { invoice_id: input.invoiceId } : {}),
      ...(input.customId ? { custom_id: input.customId } : {}),
      seller_protection: { status: "ELIGIBLE", dispute_categories: ["ITEM_NOT_RECEIVED", "UNAUTHORIZED_TRANSACTION"] },
      expiration_time: this.iso(input.expiresAt ?? nowMs + AUTHORIZATION_VALIDITY_MS),
      create_time: this.iso(nowMs),
      update_time: this.iso(nowMs),
      links: [],
      supplementary_data: { related_ids: { order_id: input.orderId } },
      payee: { email_address: this.opts.merchantEmail, merchant_id: this.state.merchantId },
    };
    const rec: AuthRecord = {
      auth,
      orderId: input.orderId,
      referenceId: input.referenceId,
      capturedMinor: 0,
      captureIds: [],
      parentId: input.parentId,
      childIds: [],
      honorUntil: nowMs + HONOR_PERIOD_MS,
      payerEmail: input.payerEmail,
    };
    auth.links = this.authLinks(rec);
    this.state.authorizations[auth.id] = rec;
    this.emit("PAYMENT.AUTHORIZATION.CREATED", auth, `Payment authorized for ${auth.amount.value} ${auth.amount.currency_code}`);
    return rec;
  }

  // ───────────── Orders v2 ─────────────

  orders: PayPalApi["orders"] = {
    create: (body, opts) =>
      this.io("orders.create", opts, (ctx) => {
        ctx.status = 201;
        if (body?.intent !== "CAPTURE" && body?.intent !== "AUTHORIZE") throw invalidRequest("INVALID_PARAMETER_VALUE", "intent must be CAPTURE or AUTHORIZE.");
        const units = body.purchase_units ?? [];
        if (units.length < 1 || units.length > 10) throw invalidRequest("INVALID_ARRAY_MAX_ITEMS", "purchase_units must contain 1 to 10 items.");
        if (body.intent === "AUTHORIZE" && units.length > 1) {
          throw unprocessable("MULTI_PURCHASE_UNIT_NOT_SUPPORTED", "Intent AUTHORIZE is not supported with more than one purchase_unit.");
        }
        const refs = new Set<string>();
        const purchaseUnits: T.PurchaseUnit[] = units.map((pu, i) => {
          const amount = assertMoney(pu.amount, `purchase_units[${i}].amount`);
          if (toMinor(amount.value, amount.currency_code) <= 0) throw unprocessable("CANNOT_BE_ZERO_OR_NEGATIVE", "Amount must be greater than zero.");
          const b = pu.amount.breakdown;
          if (pu.items?.length && !b?.item_total) throw unprocessable("ITEM_TOTAL_REQUIRED", "If item details are specified, item_total is required.");
          if (b) {
            const c = amount.currency_code;
            const z = moneyFromMinor(0, c);
            const expected = subtractMoney(
              sumMoney([b.item_total ?? z, b.tax_total ?? z, b.shipping ?? z, b.handling ?? z, b.insurance ?? z].map((m) => assertMoney(m, "breakdown"))),
              sumMoney([b.shipping_discount ?? z, b.discount ?? z].map((m) => assertMoney(m, "breakdown"))),
            );
            if (compareMoney(expected, amount) !== 0) throw unprocessable("AMOUNT_MISMATCH", "Should equal item_total + tax_total + shipping + handling + insurance - shipping_discount - discount.");
            if (pu.items?.length) {
              const items = sumMoney(pu.items.map((it) => scaleMoney(assertMoney(it.unit_amount, "items.unit_amount"), Number(it.quantity))), c);
              if (compareMoney(items, assertMoney(b.item_total, "item_total")) !== 0) throw unprocessable("ITEM_TOTAL_MISMATCH", "Should equal sum of (unit_amount * quantity) across all items.");
              if (b.tax_total && pu.items.some((it) => it.tax)) {
                const tax = sumMoney(pu.items.map((it) => scaleMoney(it.tax ? assertMoney(it.tax, "items.tax") : z, Number(it.quantity))), c);
                if (compareMoney(tax, assertMoney(b.tax_total, "tax_total")) !== 0) throw unprocessable("TAX_TOTAL_MISMATCH", "Should equal sum of (tax * quantity) across all items.");
              }
            }
          }
          this.ensureUniqueInvoiceId(pu.invoice_id);
          const reference_id = pu.reference_id ?? (units.length === 1 ? "default" : `PUHF${i}`);
          if (refs.has(reference_id)) throw unprocessable("DUPLICATE_REFERENCE_ID", "reference_id must be unique across purchase_units.");
          refs.add(reference_id);
          return { ...clone(pu), reference_id, amount: { ...clone(pu.amount), value: amount.value }, payee: pu.payee ?? { email_address: this.opts.merchantEmail, merchant_id: this.state.merchantId } };
        });

        const now = this.iso();
        const paypal = body.payment_source?.paypal;
        const order: T.Order = {
          id: mockIds.order(),
          intent: body.intent,
          status: paypal?.experience_context ? "PAYER_ACTION_REQUIRED" : "CREATED",
          purchase_units: purchaseUnits,
          create_time: now,
          update_time: now,
          links: [],
        };
        if (paypal) {
          order.payment_source = { paypal: { ...(paypal.email_address ? { email_address: paypal.email_address } : {}), ...(paypal.attributes?.vault ? { attributes: { vault: { status: "CREATED" } } } : {}) } };
        }
        const rec: OrderRecord = { order, authorizationIds: [], captureIds: [] };
        this.state.orders[order.id] = rec;

        // Merchant-initiated charge of a saved PayPal wallet (buyer not present): completes immediately.
        if (paypal?.vault_id) {
          const token = this.state.paymentTokens[paypal.vault_id];
          if (!token) throw notFound("payment token (vault_id)", paypal.vault_id);
          const email = token.payment_source.paypal?.email_address;
          order.payer = { payer_id: token.payment_source.paypal?.payer_id ?? mockIds.payer(), email_address: email };
          order.payment_source = { paypal: { email_address: email, account_id: order.payer.payer_id, account_status: "VERIFIED", attributes: { vault: { id: token.id, status: "VAULTED", customer: { id: token.customer.id } } } } };
          order.status = "COMPLETED";
          for (const pu of purchaseUnits) {
            const amount = money(pu.amount.value, pu.amount.currency_code);
            if (body.intent === "CAPTURE") {
              rec.captureIds.push(this.createCapture({ amount, referenceId: pu.reference_id, orderId: order.id, finalCapture: true, invoiceId: pu.invoice_id, customId: pu.custom_id, payerEmail: email }).capture.id);
            } else {
              rec.authorizationIds.push(this.createAuthorization({ orderId: order.id, referenceId: pu.reference_id, amount, invoiceId: pu.invoice_id, customId: pu.custom_id, payerEmail: email }).auth.id);
            }
          }
          this.emit("CHECKOUT.ORDER.COMPLETED", this.renderOrder(order.id), "Checkout Order Completed");
        }
        order.links = this.orderLinks(order);
        return this.renderOrder(order.id);
      }, 201),

    get: (id) => this.io("orders.get", undefined, () => this.renderOrder(id)),

    capture: (id, opts) =>
      this.io("orders.capture", opts, (ctx) => {
        ctx.status = 201;
        const rec = this.state.orders[id];
        if (!rec) throw notFound("order", id);
        if (rec.order.intent !== "CAPTURE") throw unprocessable("ACTION_DOES_NOT_MATCH_INTENT", "Order was created with an intent to 'AUTHORIZE'. Please use authorize instead.");
        if (rec.order.status === "COMPLETED") throw unprocessable("ORDER_ALREADY_CAPTURED", "Order already captured. If 'intent=CAPTURE' only one capture per order is allowed.");
        if (rec.order.status !== "APPROVED") throw unprocessable("ORDER_NOT_APPROVED", "Payer has not yet approved the Order for payment.");
        const email = rec.order.payer?.email_address;
        for (const pu of rec.order.purchase_units ?? []) {
          const amount = money(pu.amount.value, pu.amount.currency_code);
          rec.captureIds.push(this.createCapture({ amount, referenceId: pu.reference_id, orderId: id, finalCapture: true, invoiceId: pu.invoice_id, customId: pu.custom_id, payerEmail: email }).capture.id);
        }
        this.vaultIfRequested(rec);
        this.touchOrder(id, "COMPLETED");
        this.emit("CHECKOUT.ORDER.COMPLETED", this.renderOrder(id), "Checkout Order Completed");
        return this.renderOrder(id);
      }, 201),

    authorize: (id, opts) =>
      this.io("orders.authorize", opts, (ctx) => {
        ctx.status = 201;
        const rec = this.state.orders[id];
        if (!rec) throw notFound("order", id);
        if (rec.order.intent !== "AUTHORIZE") throw unprocessable("ACTION_DOES_NOT_MATCH_INTENT", "Order was created with an intent to 'CAPTURE'. Please use capture instead.");
        if (rec.order.status === "COMPLETED" || rec.order.status === "VOIDED") throw unprocessable("ORDER_ALREADY_AUTHORIZED", "Order already authorized. If 'intent=AUTHORIZE' only one authorization per order is allowed.");
        if (rec.order.status !== "APPROVED") throw unprocessable("ORDER_NOT_APPROVED", "Payer has not yet approved the Order for payment.");
        const pu = rec.order.purchase_units![0];
        const authRec = this.createAuthorization({
          orderId: id,
          referenceId: pu.reference_id,
          amount: money(pu.amount.value, pu.amount.currency_code),
          invoiceId: pu.invoice_id,
          customId: pu.custom_id,
          payerEmail: rec.order.payer?.email_address,
        });
        rec.authorizationIds.push(authRec.auth.id);
        this.vaultIfRequested(rec);
        this.touchOrder(id, "COMPLETED");
        return this.renderOrder(id);
      }, 201),
  };

  private vaultIfRequested(rec: OrderRecord) {
    if (rec.order.payment_source?.paypal?.attributes?.vault?.status !== "CREATED") return;
    const token = this.storePaymentToken({ email: rec.order.payer?.email_address, payerId: rec.order.payer?.payer_id, description: "Saved during purchase" });
    rec.order.payment_source.paypal.attributes.vault = {
      id: token.id,
      status: "VAULTED",
      customer: { id: token.customer.id },
      links: [{ href: `${API}/v3/vault/payment-tokens/${token.id}`, rel: "self", method: "GET" }],
    };
  }

  /** Dev helper: what the buyer does in the PayPal popup. CREATED/PAYER_ACTION_REQUIRED -> APPROVED. */
  simulateBuyerApproval(orderId: string, buyer?: { email?: string; givenName?: string; surname?: string }): Promise<T.Order> {
    return this.io("dev.approveOrder", undefined, () => {
      const rec = this.state.orders[orderId];
      if (!rec) throw notFound("order", orderId);
      if (rec.order.status !== "CREATED" && rec.order.status !== "PAYER_ACTION_REQUIRED") {
        throw unprocessable("ORDER_NOT_APPROVABLE", `Order is ${rec.order.status}; only CREATED or PAYER_ACTION_REQUIRED orders can be approved.`);
      }
      const b = { ...this.opts.defaultBuyer, ...buyer };
      const payerId = mockIds.payer();
      rec.order.payer = { payer_id: payerId, email_address: b.email, name: { given_name: b.givenName, surname: b.surname }, address: { country_code: "US" } };
      rec.order.payment_source = {
        paypal: {
          ...rec.order.payment_source?.paypal,
          email_address: b.email,
          account_id: payerId,
          account_status: "VERIFIED",
          name: { given_name: b.givenName, surname: b.surname },
        },
      };
      this.touchOrder(orderId, "APPROVED");
      const order = this.renderOrder(orderId);
      this.emit("CHECKOUT.ORDER.APPROVED", order, `An order has been approved by buyer ${b.email}`);
      return order;
    });
  }

  // ───────────── Payments v2 ─────────────

  payments: PayPalApi["payments"] = {
    getAuthorization: (id) =>
      this.io("payments.getAuthorization", undefined, () => {
        const rec = this.state.authorizations[id];
        if (!rec) throw notFound("authorization", id);
        return rec.auth;
      }),

    captureAuthorization: (id, body = {}, opts) =>
      this.io("payments.captureAuthorization", opts, (ctx) => {
        ctx.status = 201;
        const rec = this.state.authorizations[id];
        if (!rec) throw notFound("authorization", id);
        const a = rec.auth;
        if (a.status === "VOIDED") throw unprocessable("AUTHORIZATION_VOIDED", "A voided authorization cannot be captured or reauthorized.", "payments/v2");
        if (a.status === "CAPTURED") throw unprocessable("AUTHORIZATION_ALREADY_CAPTURED", "Authorization has been previously captured and hence cannot be captured again.", "payments/v2");
        if (a.status === "DENIED") throw unprocessable("AUTHORIZATION_DENIED", "A denied authorization cannot be captured.", "payments/v2");
        if (this.now() > Date.parse(a.expiration_time)) throw unprocessable("AUTHORIZATION_EXPIRED", "An expired authorization cannot be captured.", "payments/v2");
        if (rec.captureIds.length >= this.opts.maxCapturesPerAuthorization) throw unprocessable("MAX_CAPTURE_COUNT_EXCEEDED", "Maximum number of allowable captures has been reached.", "payments/v2");
        const authorizedMinor = toMinor(a.amount.value, a.amount.currency_code);
        const remainingMinor = Math.max(0, authorizedMinor - rec.capturedMinor);
        let amount: Money;
        if (body.amount) {
          amount = assertMoney(body.amount, "amount");
          if (amount.currency_code !== a.amount.currency_code) throw unprocessable("AUTH_CAPTURE_CURRENCY_MISMATCH", "Currency of capture must be the same as currency of authorization.", "payments/v2");
        } else {
          amount = moneyFromMinor(remainingMinor, a.amount.currency_code);
        }
        const amountMinor = toMinor(amount.value, amount.currency_code);
        if (amountMinor <= 0) throw unprocessable("CANNOT_BE_ZERO_OR_NEGATIVE", "Capture amount must be greater than zero.", "payments/v2");
        if (rec.capturedMinor + amountMinor > overageLimitMinor(a.amount)) {
          throw unprocessable("MAX_CAPTURE_AMOUNT_EXCEEDED", "Capture amount exceeds allowable limit (115% of the authorized amount, at most +$75).", "payments/v2");
        }
        this.ensureUniqueInvoiceId(body.invoice_id);
        const finalCapture = body.final_capture ?? !body.amount;
        const capRec = this.createCapture({
          amount,
          referenceId: rec.referenceId,
          orderId: rec.orderId,
          authorizationId: id,
          finalCapture,
          invoiceId: body.invoice_id ?? a.invoice_id,
          customId: a.custom_id,
          noteToPayer: body.note_to_payer,
          payerEmail: rec.payerEmail,
        });
        rec.captureIds.push(capRec.capture.id);
        rec.capturedMinor += amountMinor;
        a.status = finalCapture || rec.capturedMinor >= authorizedMinor ? "CAPTURED" : "PARTIALLY_CAPTURED";
        a.update_time = this.iso();
        a.links = this.authLinks(rec);
        this.touchOrder(rec.orderId);
        return capRec.capture;
      }, 201),

    voidAuthorization: (id, opts) =>
      this.io("payments.voidAuthorization", opts, () => {
        const rec = this.state.authorizations[id];
        if (!rec) throw notFound("authorization", id);
        const a = rec.auth;
        if (rec.parentId) throw unprocessable("CANNOT_BE_VOIDED", "A reauthorization cannot be voided. Please void the original parent authorization.", "payments/v2");
        if (a.status === "VOIDED") throw unprocessable("PREVIOUSLY_VOIDED", "Authorization has been previously voided and hence cannot be voided again.", "payments/v2");
        if (a.status === "CAPTURED") throw unprocessable("PREVIOUSLY_CAPTURED", "Authorization has been previously captured and hence cannot be voided.", "payments/v2");
        if (this.now() > Date.parse(a.expiration_time)) throw unprocessable("AUTHORIZATION_EXPIRED", "An expired authorization cannot be voided.", "payments/v2");
        const voidOne = (r: AuthRecord) => {
          r.auth.status = "VOIDED";
          r.auth.update_time = this.iso();
          r.auth.links = this.authLinks(r);
          this.emit("PAYMENT.AUTHORIZATION.VOIDED", r.auth, `A payment authorization was voided`);
        };
        voidOne(rec);
        for (const childId of rec.childIds) {
          const child = this.state.authorizations[childId];
          if (child && (child.auth.status === "CREATED" || child.auth.status === "PARTIALLY_CAPTURED")) voidOne(child);
        }
        const order = this.state.orders[rec.orderId];
        const anyCaptured = order?.authorizationIds.some((aid) => (this.state.authorizations[aid]?.capturedMinor ?? 0) > 0);
        this.touchOrder(rec.orderId, anyCaptured ? undefined : "VOIDED");
        return a;
      }),

    reauthorize: (id, body = {}, opts) =>
      this.io("payments.reauthorize", opts, (ctx) => {
        ctx.status = 201;
        const rec = this.state.authorizations[id];
        if (!rec) throw notFound("authorization", id);
        if (rec.parentId) throw unprocessable("REAUTHORIZATION_NOT_SUPPORTED", "A reauthorized authorization_id cannot be reauthorized again. Reauthorize the original authorization.", "payments/v2");
        if (rec.auth.status === "VOIDED") throw unprocessable("AUTHORIZATION_VOIDED", "A voided authorization cannot be captured or reauthorized.", "payments/v2");
        if (rec.auth.status !== "CREATED") throw unprocessable("AUTHORIZATION_ALREADY_CAPTURED", "Authorization has been previously captured and hence cannot be reauthorized.", "payments/v2");
        if (this.now() > Date.parse(rec.auth.expiration_time)) throw unprocessable("AUTHORIZATION_EXPIRED", "An expired authorization cannot be reauthorized.", "payments/v2");
        if (this.now() < rec.honorUntil) throw unprocessable("REAUTHORIZATION_TOO_SOON", "A reauthorization cannot be done within the honor period (days 1-3). Reauthorize between day 4 and day 29.", "payments/v2");
        if (rec.childIds.length >= this.opts.maxReauthorizations) throw unprocessable("MAX_REAUTHORIZATIONS_EXCEEDED", "This authorization has already been reauthorized.", "payments/v2");
        const amount = body.amount ? assertMoney(body.amount, "amount") : clone(rec.auth.amount);
        if (amount.currency_code !== rec.auth.amount.currency_code) throw unprocessable("AUTH_CURRENCY_MISMATCH", "Currency of reauthorization must match the original authorization.", "payments/v2");
        if (toMinor(amount.value, amount.currency_code) > overageLimitMinor(rec.auth.amount)) {
          throw unprocessable("REAUTHORIZATION_AMOUNT_EXCEEDED", "Reauthorization amount exceeds 115% of the original (at most +$75).", "payments/v2");
        }
        const child = this.createAuthorization({
          orderId: rec.orderId,
          referenceId: rec.referenceId,
          amount,
          invoiceId: rec.auth.invoice_id,
          customId: rec.auth.custom_id,
          payerEmail: rec.payerEmail,
          parentId: id,
          expiresAt: Date.parse(rec.auth.expiration_time),
        });
        rec.childIds.push(child.auth.id);
        this.state.orders[rec.orderId]?.authorizationIds.push(child.auth.id);
        rec.auth.links = this.authLinks(rec);
        return child.auth;
      }, 201),

    getCapture: (id) =>
      this.io("payments.getCapture", undefined, () => {
        const rec = this.state.captures[id];
        if (!rec) throw notFound("capture", id);
        return rec.capture;
      }),

    refundCapture: (id, body = {}, opts) =>
      this.io("payments.refundCapture", opts, (ctx) => {
        ctx.status = 201;
        return this.refundInternal(id, body, false).refund;
      }, 201),

    getRefund: (id) =>
      this.io("payments.getRefund", undefined, () => {
        const rec = this.state.refunds[id];
        if (!rec) throw notFound("refund", id);
        return rec.refund;
      }),
  };

  private refundInternal(captureId: string, body: T.RefundRequest, fromDispute: boolean): RefundRecord {
    const rec = this.state.captures[captureId];
    if (!rec) throw notFound("capture", captureId);
    const c = rec.capture;
    if (c.status === "REFUNDED") throw unprocessable("CAPTURE_FULLY_REFUNDED", "The capture has already been fully refunded.", "payments/v2");
    if (c.status === "PENDING") throw unprocessable("PENDING_CAPTURE", "Cannot initiate a refund as the capture is pending.", "payments/v2");
    if (c.status !== "COMPLETED" && c.status !== "PARTIALLY_REFUNDED") throw unprocessable("TRANSACTION_REFUSED", `Capture is ${c.status} and cannot be refunded.`, "payments/v2");
    if (this.now() - Date.parse(c.create_time) > REFUND_WINDOW_MS) throw unprocessable("REFUND_TIME_LIMIT_EXCEEDED", "You are past the 180 day window to refund this capture.", "payments/v2");
    const grossMinor = toMinor(c.amount.value, c.amount.currency_code);
    const remainingMinor = grossMinor - rec.refundedMinor;
    let amount: Money;
    if (body.amount) {
      amount = assertMoney(body.amount, "amount");
      if (amount.currency_code !== c.amount.currency_code) throw unprocessable("REFUND_CAPTURE_CURRENCY_MISMATCH", "Refund must be in the same currency as the capture.", "payments/v2");
    } else {
      amount = moneyFromMinor(remainingMinor, c.amount.currency_code);
    }
    const amountMinor = toMinor(amount.value, amount.currency_code);
    if (amountMinor <= 0) throw unprocessable("CANNOT_BE_ZERO_OR_NEGATIVE", "Refund amount must be greater than zero.", "payments/v2");
    if (amountMinor > remainingMinor) throw unprocessable("REFUND_AMOUNT_EXCEEDED", "The refund amount must be less than or equal to the capture amount that has not yet been refunded.", "payments/v2");
    const openDispute = Object.values(this.state.disputes).some((d) => d.captureId === captureId && d.dispute.status !== "RESOLVED");
    if (!fromDispute && openDispute && amountMinor < remainingMinor) throw unprocessable("TRANSACTION_DISPUTED", "Partial refunds cannot be offered while a dispute is open on this capture.", "payments/v2");

    const feeBackMinor = Math.round((rec.feeMinor * amountMinor) / grossMinor);
    const cur = c.amount.currency_code;
    rec.refundedMinor += amountMinor;
    const now = this.iso();
    const refund: T.Refund = {
      id: mockIds.refund(),
      status: "COMPLETED",
      amount,
      ...(body.invoice_id ? { invoice_id: body.invoice_id } : {}),
      ...(body.custom_id ? { custom_id: body.custom_id } : {}),
      ...(body.note_to_payer ? { note_to_payer: body.note_to_payer } : {}),
      seller_payable_breakdown: {
        gross_amount: clone(amount),
        paypal_fee: moneyFromMinor(feeBackMinor, cur),
        net_amount: moneyFromMinor(amountMinor - feeBackMinor, cur),
        total_refunded_amount: moneyFromMinor(rec.refundedMinor, cur),
      },
      links: [
        { href: `${API}/v2/payments/refunds/{id}`, rel: "self", method: "GET" },
        { href: `${API}/v2/payments/captures/${captureId}`, rel: "up", method: "GET" },
      ],
      create_time: now,
      update_time: now,
    };
    refund.links[0].href = `${API}/v2/payments/refunds/${refund.id}`;
    const refundRec: RefundRecord = { refund, captureId };
    this.state.refunds[refund.id] = refundRec;
    rec.refundIds.push(refund.id);
    c.status = rec.refundedMinor >= grossMinor ? "REFUNDED" : "PARTIALLY_REFUNDED";
    c.update_time = now;
    c.links = this.captureLinks(rec);
    if (rec.orderId) this.touchOrder(rec.orderId);
    this.recordTransaction(
      {
        transaction_id: refund.id,
        paypal_reference_id: captureId,
        paypal_reference_id_type: "TXN",
        transaction_event_code: "T1107",
        transaction_amount: moneyFromMinor(-amountMinor, cur),
        fee_amount: moneyFromMinor(feeBackMinor, cur),
        transaction_note: body.note_to_payer,
      },
      rec.payerEmail,
    );
    this.emit("PAYMENT.CAPTURE.REFUNDED", refund, `A ${amount.value} ${cur} capture payment was refunded`);
    return refundRec;
  }

  // ───────────── Payouts v1 ─────────────

  payouts: PayPalApi["payouts"] = {
    create: (body, opts) =>
      this.io("payouts.create", opts, (ctx) => {
        ctx.status = 201;
        const items = body?.items ?? [];
        if (!items.length || items.length > 15000) throw payoutsError(400, "VALIDATION_ERROR", "Invalid request - see details", "items", "items must contain 1 to 15000 entries.");
        const senderBatchId = body.sender_batch_header?.sender_batch_id;
        if (senderBatchId && this.state.senderBatchIds[senderBatchId]) {
          throw payoutsError(400, "USER_BUSINESS_ERROR", "User business error.", "SENDER_BATCH_ID", "Batch with given sender_batch_id already exists");
        }
        for (const [i, item] of items.entries()) {
          const type = item.recipient_type ?? body.sender_batch_header?.recipient_type ?? "EMAIL";
          if (type === "PHONE") throw payoutsError(422, "VALIDATION_ERROR", "Invalid request - see details", `items[${i}].recipient_type`, "PHONE recipients are not supported in the sandbox.");
          if (!item.receiver) throw payoutsError(400, "VALIDATION_ERROR", "Invalid request - see details", `items[${i}].receiver`, "receiver is required.");
          try {
            if (toMinor(item.amount.value, item.amount.currency) <= 0) throw new Error();
          } catch {
            throw payoutsError(400, "VALIDATION_ERROR", "Invalid request - see details", `items[${i}].amount`, "amount must be a positive decimal.");
          }
          // PayPal's documented sandbox negative-test triggers (case-sensitive note values)
          if (item.note === "ERRPYO002") throw apiError(422, "SENDER_EMAIL_UNCONFIRMED", "Your email address must be confirmed before you can send payouts.");
          if (item.note === "ERRPYO005") throw apiError(422, "INSUFFICIENT_FUNDS", "Sender does not have sufficient funds. Please add funds and retry.");
        }
        const batchId = mockIds.payoutBatch();
        const createdAt = this.now();
        const header: T.PayoutBatchHeader = {
          payout_batch_id: batchId,
          batch_status: "PENDING",
          time_created: this.iso(createdAt),
          sender_batch_header: clone(body.sender_batch_header ?? {}),
        };
        const batch: T.PayoutBatch = {
          batch_header: header,
          items: items.map((item) => ({
            payout_item_id: mockIds.payoutItem(),
            transaction_status: "PENDING",
            payout_batch_id: batchId,
            payout_item: { recipient_type: item.recipient_type ?? body.sender_batch_header?.recipient_type ?? "EMAIL", recipient_wallet: "PAYPAL", ...clone(item) },
            links: [],
          })),
          links: [{ href: `${API}/v1/payments/payouts/${batchId}`, rel: "self", method: "GET" }],
        };
        for (const it of batch.items) it.links = [{ href: `${API}/v1/payments/payouts-item/${it.payout_item_id}`, rel: "item", method: "GET" }];
        this.state.payouts[batchId] = { batch, createdAt, phase: "PENDING" };
        if (senderBatchId) this.state.senderBatchIds[senderBatchId] = batchId;
        if (this.opts.autoAdvancePayouts) {
          for (const ms of [1600, 4200]) setTimeout(() => void this.payouts.get(batchId).catch(() => undefined), ms).unref?.();
        }
        return { batch_header: { payout_batch_id: batchId, batch_status: "PENDING" as const, time_created: header.time_created, sender_batch_header: header.sender_batch_header }, links: batch.links };
      }, 201),

    get: (id) =>
      this.io("payouts.get", undefined, () => {
        // PayPal's documented sandbox ids that force a batch status.
        const forced = { ERRPYOB001: "SUCCESS", ERRPYOB002: "PENDING", ERRPYOB003: "PROCESSING", ERRPYOB004: "DENIED" } as const;
        if (id in forced) {
          return { batch_header: { payout_batch_id: id, batch_status: forced[id as keyof typeof forced], sender_batch_header: {} }, items: [], links: [] } satisfies T.PayoutBatch;
        }
        const rec = this.state.payouts[id];
        if (!rec) throw notFound("payout batch", id);
        this.advancePayout(rec, false);
        return rec.batch;
      }),
  };

  private advancePayout(rec: PayoutRecord, force: boolean) {
    const age = this.now() - rec.createdAt;
    const h = rec.batch.batch_header;
    if (rec.phase === "PENDING" && (force || age >= 1500)) {
      rec.phase = "PROCESSING";
      h.batch_status = "PROCESSING";
      this.emit("PAYMENT.PAYOUTSBATCH.PROCESSING", rec.batch, "Payouts batch is being processed.");
    }
    if (rec.phase === "PROCESSING" && (force || age >= 4000)) {
      rec.phase = "DONE";
      const cur = rec.batch.items[0]?.payout_item.amount.currency ?? "USD";
      let totalMinor = 0;
      let feesMinor = 0;
      for (const item of rec.batch.items) {
        const receiver = item.payout_item.receiver.toLowerCase();
        const amtMinor = toMinor(item.payout_item.amount.value, item.payout_item.amount.currency);
        // Mock convention: "unclaimed" / "fail" / "hold" in the receiver picks the outcome.
        if (receiver.includes("fail") || receiver.includes("invalid")) {
          item.transaction_status = "FAILED";
          item.errors = { name: "RECEIVER_UNREGISTERED", message: "Receiver is unregistered." };
        } else if (receiver.includes("unclaimed")) {
          item.transaction_status = "UNCLAIMED";
        } else if (receiver.includes("hold")) {
          item.transaction_status = "ONHOLD";
        } else {
          item.transaction_status = "SUCCESS";
        }
        if (item.transaction_status === "SUCCESS" || item.transaction_status === "UNCLAIMED") {
          const fee = Math.min(Math.round(amtMinor * 0.02), 2000);
          feesMinor += fee;
          totalMinor += amtMinor;
          item.transaction_id = mockIds.payoutTransaction();
          item.activity_id = mockIds.payoutTransaction();
          item.payout_item_fee = { currency: cur, value: fromMinor(fee, cur) };
          this.recordTransaction({
            transaction_id: item.transaction_id,
            paypal_reference_id: rec.batch.batch_header.payout_batch_id,
            paypal_reference_id_type: "TXN",
            transaction_event_code: "T0001",
            transaction_amount: { currency_code: cur, value: fromMinor(-amtMinor, cur) },
            fee_amount: { currency_code: cur, value: fromMinor(-fee, cur) },
            transaction_note: item.payout_item.note,
          }, item.payout_item.receiver);
        }
        item.time_processed = this.iso();
        const evt = { SUCCESS: "SUCCEEDED", FAILED: "FAILED", UNCLAIMED: "UNCLAIMED", ONHOLD: "HELD" }[item.transaction_status as "SUCCESS" | "FAILED" | "UNCLAIMED" | "ONHOLD"];
        if (evt) this.emit(`PAYMENT.PAYOUTS-ITEM.${evt}`, item, `Payout item ${item.transaction_status.toLowerCase()}`);
      }
      h.batch_status = "SUCCESS";
      h.time_completed = this.iso();
      h.amount = { currency: cur, value: fromMinor(totalMinor, cur) };
      h.fees = { currency: cur, value: fromMinor(feesMinor, cur) };
      h.funding_source = "BALANCE";
      this.emit("PAYMENT.PAYOUTSBATCH.SUCCESS", rec.batch, "Payouts batch completed successfully.");
    }
  }

  /** Dev helper: finish every pending payout batch now. */
  advancePayouts(): Promise<void> {
    return this.io("dev.advancePayouts", undefined, () => {
      for (const rec of Object.values(this.state.payouts)) this.advancePayout(rec, true);
    });
  }

  // ───────────── Invoicing v2 ─────────────

  private computeInvoice(body: T.CreateInvoiceRequest): Pick<T.Invoice, "amount" | "due_amount"> {
    const cur = body.detail.currency_code;
    let itemsMinor = 0;
    let taxMinor = 0;
    let discountMinor = 0;
    for (const [i, item] of body.items.entries()) {
      if (!/^-?\d+(\.\d{1,5})?$/.test(item.quantity)) throw invalidRequest("INVALID_PARAMETER_SYNTAX", `items[${i}].quantity must be a decimal string.`);
      const unit = assertMoney(item.unit_amount, `items[${i}].unit_amount`);
      if (unit.currency_code !== cur) throw unprocessable("CURRENCY_MISMATCH", "All amounts must use the invoice currency.", "invoicing/v2");
      const line = Math.round(toMinor(unit.value, cur) * Number(item.quantity));
      let disc = 0;
      if (item.discount?.percent) disc = Math.round((line * Number(item.discount.percent)) / 100);
      else if (item.discount?.amount) disc = toMinor(item.discount.amount.value, cur);
      const tax = item.tax ? Math.round(((line - disc) * Number(item.tax.percent)) / 100) : 0;
      itemsMinor += line;
      discountMinor += disc;
      taxMinor += tax;
    }
    const total = itemsMinor - discountMinor + taxMinor;
    return {
      amount: {
        currency_code: cur,
        value: fromMinor(total, cur),
        breakdown: { item_total: moneyFromMinor(itemsMinor, cur), tax_total: moneyFromMinor(taxMinor, cur), discount: { item_discount: moneyFromMinor(-discountMinor, cur) } },
      },
      due_amount: moneyFromMinor(total, cur),
    };
  }

  private invoiceLinks(inv: T.Invoice): T.Link[] {
    const base = `${API}/v2/invoicing/invoices/${inv.id}`;
    const links: T.Link[] = [{ href: base, rel: "self", method: "GET" }];
    if (inv.status === "DRAFT") links.push({ href: `${base}/send`, rel: "send", method: "POST" }, { href: base, rel: "replace", method: "PUT" }, { href: base, rel: "delete", method: "DELETE" });
    if (["SENT", "UNPAID", "PARTIALLY_PAID", "SCHEDULED"].includes(inv.status)) {
      links.push({ href: `${base}/remind`, rel: "remind", method: "POST" }, { href: `${base}/cancel`, rel: "cancel", method: "POST" }, { href: `${base}/payments`, rel: "record-payment", method: "POST" });
    }
    if (inv.status !== "DRAFT") links.push({ href: `${WEB}/invoice/p/#${inv.id}`, rel: "payer-view", method: "GET" });
    return links;
  }

  private getInvoiceRec(id: string): InvoiceRecord {
    const rec = this.state.invoices[id];
    if (!rec) throw notFound("invoice", id);
    return rec;
  }

  private applyInvoicePayment(rec: InvoiceRecord, amount: Money, tx: T.InvoicePaymentTransaction, external: boolean) {
    const inv = rec.invoice;
    const due = inv.due_amount ?? inv.amount;
    inv.payments = {
      paid_amount: inv.payments ? addMoney(inv.payments.paid_amount, amount) : clone(amount),
      transactions: [...(inv.payments?.transactions ?? []), tx],
    };
    inv.due_amount = subtractMoney(due, amount);
    const settled = toMinor(inv.due_amount.value, inv.due_amount.currency_code) <= 0;
    inv.status = settled ? (external ? "MARKED_AS_PAID" : "PAID") : "PARTIALLY_PAID";
    inv.detail.metadata = { ...inv.detail.metadata, last_update_time: this.iso() };
    inv.links = this.invoiceLinks(inv);
    this.emit("INVOICING.INVOICE.PAID", { invoice: inv }, `Invoice ${inv.detail.invoice_number} ${settled ? "paid" : "partially paid"}`);
  }

  invoicing: PayPalApi["invoicing"] = {
    generateNextNumber: () =>
      this.io("invoicing.generateNextNumber", undefined, () => {
        this.state.invoiceSeq += 1;
        return { invoice_number: `INV-${this.state.invoiceSeq}` };
      }),

    create: (body, opts) =>
      this.io("invoicing.create", opts, (ctx) => {
        ctx.status = 201;
        if (!body?.detail?.currency_code) throw invalidRequest("MISSING_REQUIRED_PARAMETER", "detail.currency_code is required.");
        if (!body.items?.length) throw invalidRequest("MISSING_REQUIRED_PARAMETER", "An invoice must include at least one item.");
        let number = body.detail.invoice_number;
        if (number && Object.values(this.state.invoices).some((r) => r.invoice.detail.invoice_number === number)) {
          throw unprocessable("DUPLICATE_INVOICE_NUMBER", "Invoice number is already in use.", "invoicing/v2");
        }
        if (!number) {
          this.state.invoiceSeq += 1;
          number = `INV-${this.state.invoiceSeq}`;
        }
        const id = mockIds.invoice();
        const now = this.iso();
        const invoice: T.Invoice = {
          ...clone(body),
          id,
          status: "DRAFT",
          detail: {
            ...clone(body.detail),
            invoice_number: number,
            invoice_date: body.detail.invoice_date ?? now.slice(0, 10),
            payment_term: body.detail.payment_term ?? { term_type: "DUE_ON_RECEIPT" },
            metadata: { create_time: now, last_update_time: now, recipient_view_url: `${WEB}/invoice/p/#${id}`, invoicer_view_url: `${WEB}/invoice/details/${id}` },
          },
          invoicer: body.invoicer ?? { email_address: this.opts.merchantEmail },
          ...this.computeInvoice(body),
          links: [],
        };
        invoice.links = this.invoiceLinks(invoice);
        this.state.invoices[id] = { invoice, reminders: { day: "", count: 0 } };
        this.emit("INVOICING.INVOICE.CREATED", { invoice }, `An invoice ${number} was created`);
        return invoice;
      }, 201),

    send: (id) =>
      this.io("invoicing.send", undefined, (ctx) => {
        const rec = this.getInvoiceRec(id);
        const inv = rec.invoice;
        const link: T.Link = { href: `${WEB}/invoice/p/#${id}`, rel: "payer-view", method: "GET" };
        if (inv.status === "CANCELLED" || inv.status === "AUTO_CANCELLED") throw unprocessable("INVALID_INVOICE_STATUS", "A cancelled invoice cannot be sent.", "invoicing/v2");
        if (inv.status !== "DRAFT") return link; // re-sending has no effect
        const scheduled = (inv.detail.invoice_date ?? "") > this.iso().slice(0, 10);
        inv.status = scheduled ? "SCHEDULED" : "SENT";
        ctx.status = scheduled ? 202 : 200;
        inv.detail.metadata = { ...inv.detail.metadata, last_update_time: this.iso() };
        inv.links = this.invoiceLinks(inv);
        if (scheduled) this.emit("INVOICING.INVOICE.SCHEDULED", { invoice: inv }, `Invoice ${inv.detail.invoice_number} scheduled`);
        return link;
      }),

    remind: (id) =>
      this.io("invoicing.remind", undefined, (ctx) => {
        ctx.status = 204;
        const rec = this.getInvoiceRec(id);
        if (!["SENT", "UNPAID", "PARTIALLY_PAID"].includes(rec.invoice.status)) {
          throw unprocessable("INVALID_INVOICE_STATUS", `Cannot send a reminder for a ${rec.invoice.status} invoice.`, "invoicing/v2");
        }
        const day = this.iso().slice(0, 10);
        if (rec.reminders.day !== day) rec.reminders = { day, count: 0 };
        if (rec.reminders.count >= 2) throw apiError(429, "RATE_LIMIT_REACHED", "Too many requests. You can send at most 2 reminders per invoice per day.");
        rec.reminders.count += 1;
        return undefined;
      }, 204),

    cancel: (id) =>
      this.io("invoicing.cancel", undefined, (ctx) => {
        ctx.status = 204;
        const rec = this.getInvoiceRec(id);
        const inv = rec.invoice;
        if (inv.status === "DRAFT") throw unprocessable("INVALID_INVOICE_STATUS", "A draft invoice cannot be cancelled; delete it instead.", "invoicing/v2");
        if (!["SENT", "UNPAID", "PARTIALLY_PAID", "SCHEDULED", "PAYMENT_PENDING"].includes(inv.status)) {
          throw unprocessable("INVALID_INVOICE_STATUS", `A ${inv.status} invoice cannot be cancelled.`, "invoicing/v2");
        }
        inv.status = "CANCELLED";
        inv.links = this.invoiceLinks(inv);
        this.emit("INVOICING.INVOICE.CANCELLED", { invoice: inv }, `Invoice ${inv.detail.invoice_number} cancelled`);
        return undefined;
      }, 204),

    get: (id) => this.io("invoicing.get", undefined, () => this.getInvoiceRec(id).invoice),

    list: (query = {}) =>
      this.io("invoicing.list", undefined, () => {
        const page = Math.max(1, query.page ?? 1);
        const size = Math.min(100, Math.max(1, query.page_size ?? 20));
        const all = Object.values(this.state.invoices)
          .map((r) => r.invoice)
          .reverse() // newest first on ties (same-second create_time)
          .sort((a, b) => (b.detail.metadata?.create_time ?? "").localeCompare(a.detail.metadata?.create_time ?? ""));
        return {
          items: all.slice((page - 1) * size, page * size),
          ...(query.total_required ? { total_items: all.length, total_pages: Math.max(1, Math.ceil(all.length / size)) } : {}),
          links: [{ href: `${API}/v2/invoicing/invoices?page=${page}&page_size=${size}`, rel: "self", method: "GET" as const }],
        };
      }),

    recordPayment: (id, body) =>
      this.io("invoicing.recordPayment", undefined, () => {
        const rec = this.getInvoiceRec(id);
        const inv = rec.invoice;
        if (!["SENT", "UNPAID", "PARTIALLY_PAID", "SCHEDULED", "PAYMENT_PENDING"].includes(inv.status)) {
          throw unprocessable("INVALID_INVOICE_STATUS", `Cannot record a payment on a ${inv.status} invoice.`, "invoicing/v2");
        }
        const due = inv.due_amount ?? inv.amount;
        const amount = body.amount ? assertMoney(body.amount, "amount") : money(due.value, due.currency_code);
        if (compareMoney(amount, due) > 0) throw unprocessable("INVOICE_PAYMENT_EXCEEDS_DUE", "Payment amount is more than the amount due.", "invoicing/v2");
        const paymentId = body.type === "PAYPAL" && body.payment_id ? body.payment_id : mockIds.invoiceExternalPayment();
        this.applyInvoicePayment(rec, amount, { payment_id: paymentId, method: body.method, type: body.type ?? "EXTERNAL", payment_date: body.payment_date ?? this.iso().slice(0, 10), amount, note: body.note }, (body.type ?? "EXTERNAL") === "EXTERNAL");
        return { payment_id: paymentId };
      }),
  };

  /** Dev helper: the recipient pays the invoice through PayPal (full or partial). */
  simulateInvoicePayment(invoiceId: string, amount?: Money): Promise<T.Invoice> {
    return this.io("dev.payInvoice", undefined, () => {
      const rec = this.getInvoiceRec(invoiceId);
      const inv = rec.invoice;
      if (!["SENT", "UNPAID", "PARTIALLY_PAID"].includes(inv.status)) throw unprocessable("INVALID_INVOICE_STATUS", `Invoice is ${inv.status}; send it first.`, "invoicing/v2");
      const due = inv.due_amount ?? inv.amount;
      const pay = amount ? money(amount.value, amount.currency_code) : money(due.value, due.currency_code);
      const email = inv.primary_recipients?.[0]?.billing_info?.email_address ?? this.opts.defaultBuyer.email;
      const cap = this.createCapture({ amount: pay, referenceId: "default", finalCapture: true, invoiceId: inv.detail.invoice_number, payerEmail: email });
      this.applyInvoicePayment(rec, pay, { payment_id: cap.capture.id, method: "PAYPAL", type: "PAYPAL", payment_date: this.iso().slice(0, 10), amount: pay }, false);
      return inv;
    });
  }

  // ───────────── Disputes v1 ─────────────

  private disputeLinks(d: T.Dispute): T.Link[] {
    const base = `${API}/v1/customer/disputes/${d.dispute_id}`;
    const links: T.Link[] = [{ href: base, rel: "self", method: "GET" }];
    if (d.status !== "RESOLVED") {
      links.push({ href: `${base}/accept-claim`, rel: "accept_claim", method: "POST" });
      // As on PayPal: an inquiry takes messages; formal evidence opens once it is a claim.
      if (d.dispute_life_cycle_stage === "INQUIRY") links.push({ href: `${base}/send-message`, rel: "send_message", method: "POST" });
      else if (d.status === "WAITING_FOR_SELLER_RESPONSE") links.push({ href: `${base}/provide-evidence`, rel: "provide_evidence", method: "POST" });
    }
    return links;
  }

  private summarize(d: T.Dispute): T.DisputeSummary {
    const { dispute_id, create_time, update_time, reason, status, dispute_state, dispute_amount, dispute_life_cycle_stage, dispute_channel, buyer_response_due_date, seller_response_due_date } = d;
    return { dispute_id, create_time, update_time, reason, status, dispute_state, dispute_amount, dispute_life_cycle_stage, dispute_channel, buyer_response_due_date, seller_response_due_date, links: [{ href: `${API}/v1/customer/disputes/${dispute_id}`, rel: "self", method: "GET" }] };
  }

  private getDisputeRec(id: string): DisputeRecord {
    const rec = this.state.disputes[id];
    if (!rec) throw notFound("dispute", id);
    return rec;
  }

  disputes: PayPalApi["disputes"] = {
    list: (query = {}) =>
      this.io("disputes.list", undefined, () => {
        const states = Array.isArray(query.dispute_state) ? query.dispute_state : query.dispute_state ? String(query.dispute_state).split(",") : undefined;
        const size = Math.min(50, Math.max(1, query.page_size ?? 10));
        const page = Math.max(1, query.page ?? 1);
        const all = Object.values(this.state.disputes)
          .map((r) => r.dispute)
          .reverse()
          .filter((d) => !states || states.includes(d.dispute_state))
          .filter((d) => !query.disputed_transaction_id || d.disputed_transactions.some((t) => t.seller_transaction_id === query.disputed_transaction_id || t.buyer_transaction_id === query.disputed_transaction_id))
          .sort((a, b) => b.create_time.localeCompare(a.create_time));
        return { items: all.slice((page - 1) * size, page * size).map((d) => this.summarize(d)), links: [{ href: `${API}/v1/customer/disputes?page_size=${size}&page=${page}`, rel: "self", method: "GET" as const }] };
      }),

    get: (id) => this.io("disputes.get", undefined, () => this.getDisputeRec(id).dispute),

    provideEvidence: (id, input, files = []) =>
      this.io("disputes.provideEvidence", undefined, () => {
        const rec = this.getDisputeRec(id);
        const d = rec.dispute;
        if (d.status !== "WAITING_FOR_SELLER_RESPONSE") throw unprocessable("ACTION_NOT_ALLOWED_IN_CURRENT_DISPUTE_STATE", `Evidence can only be provided while WAITING_FOR_SELLER_RESPONSE (dispute is ${d.status}).`, "customer-disputes/v1");
        if (d.dispute_life_cycle_stage === "INQUIRY") throw unprocessable("ACTION_NOT_ALLOWED_IN_CURRENT_DISPUTE_STATE", "Evidence can't be provided while the dispute is an inquiry; send a message instead.", "customer-disputes/v1");
        if (!input?.evidences?.length) throw invalidRequest("MISSING_REQUIRED_PARAMETER", "At least one evidence is required.");
        for (const ev of input.evidences) {
          if (ev.evidence_type === "PROOF_OF_FULFILLMENT" && !ev.evidence_info?.tracking_info?.length) throw unprocessable("MISSING_TRACKING_INFO", "Tracking info is required for PROOF_OF_FULFILLMENT.", "customer-disputes/v1");
          if (ev.evidence_type === "PROOF_OF_REFUND" && !ev.evidence_info?.refund_ids?.length) throw unprocessable("MISSING_REFUND_ID", "refund_ids are required for PROOF_OF_REFUND.", "customer-disputes/v1");
        }
        const allowed = ["application/pdf", "image/png", "image/jpeg", "image/gif"];
        let total = 0;
        for (const f of files) {
          total += f.data.byteLength;
          if (!allowed.includes(f.contentType) || f.data.byteLength > 10 * 1024 * 1024) throw unprocessable("INVALID_EVIDENCE_FILE", `${f.name}: only PDF/PNG/JPEG/GIF under 10 MB are accepted.`, "customer-disputes/v1");
        }
        if (total > 50 * 1024 * 1024) throw unprocessable("INVALID_EVIDENCE_FILE", "Total upload must be under 50 MB.", "customer-disputes/v1");
        const docs = files.map((f) => ({ name: f.name }));
        d.evidences = [...(d.evidences ?? []), ...input.evidences.map((ev, i) => ({ ...clone(ev), source: "SUBMITTED_BY_SELLER", date: this.iso(), documents: i === 0 ? docs : ev.documents }))];
        d.status = "UNDER_REVIEW";
        d.dispute_state = "UNDER_PAYPAL_REVIEW";
        d.update_time = this.iso();
        d.links = this.disputeLinks(d);
        this.emit("CUSTOMER.DISPUTE.UPDATED", d, `Seller provided evidence for dispute ${d.dispute_id}`);
        return { links: [{ href: `${API}/v1/customer/disputes/${id}`, rel: "self", method: "GET" as const }] };
      }),

    sendMessage: (id, message, file) =>
      this.io("disputes.sendMessage", undefined, () => {
        const d = this.getDisputeRec(id).dispute;
        if (d.status === "RESOLVED" || d.dispute_life_cycle_stage !== "INQUIRY") throw unprocessable("ACTION_NOT_ALLOWED_IN_CURRENT_DISPUTE_STATE", `Messages can only be sent while the dispute is an inquiry (it is ${d.dispute_life_cycle_stage}, ${d.status}).`, "customer-disputes/v1");
        if (!message?.trim()) throw invalidRequest("MISSING_REQUIRED_PARAMETER", "A message is required.");
        if (message.length > 2000) throw invalidRequest("INVALID_PARAMETER_SYNTAX", "The message can be at most 2000 characters.");
        if (file && (!["application/pdf", "image/png", "image/jpeg", "image/gif"].includes(file.contentType) || file.data.byteLength > 10 * 1024 * 1024)) throw unprocessable("INVALID_EVIDENCE_FILE", `${file.name}: only PDF/PNG/JPEG/GIF under 10 MB are accepted.`, "customer-disputes/v1");
        d.messages = [...(d.messages ?? []), { posted_by: "SELLER", time_posted: this.iso(), content: message, ...(file ? { documents: [{ name: file.name }] } : {}) }];
        // PayPal now waits on the buyer, as the sandbox does after a seller's message.
        d.status = "WAITING_FOR_BUYER_RESPONSE";
        d.update_time = this.iso();
        d.links = this.disputeLinks(d);
        this.emit("CUSTOMER.DISPUTE.UPDATED", d, `Seller sent a message on dispute ${d.dispute_id}`);
        return { links: [{ href: `${API}/v1/customer/disputes/${id}`, rel: "self", method: "GET" as const }] };
      }),

    acceptClaim: (id, body = {}) =>
      this.io("disputes.acceptClaim", undefined, () => {
        const rec = this.getDisputeRec(id);
        const d = rec.dispute;
        if (d.status === "RESOLVED") throw unprocessable("ACTION_NOT_ALLOWED_IN_CURRENT_DISPUTE_STATE", "Dispute is already resolved.", "customer-disputes/v1");
        const refundAmount = body.accept_claim_type === "PARTIAL_REFUND" && body.refund_amount ? assertMoney(body.refund_amount, "refund_amount") : clone(d.dispute_amount);
        const refund = this.refundInternal(rec.captureId, { amount: refundAmount, note_to_payer: body.note }, true);
        d.status = "RESOLVED";
        d.dispute_state = "RESOLVED";
        d.dispute_outcome = { outcome_code: "RESOLVED_BUYER_FAVOUR", amount_refunded: refund.refund.amount };
        d.update_time = this.iso();
        d.links = this.disputeLinks(d);
        this.emit("CUSTOMER.DISPUTE.RESOLVED", d, `Dispute ${d.dispute_id} resolved: seller accepted the claim`);
        return { links: [{ href: `${API}/v1/customer/disputes/${id}`, rel: "self", method: "GET" as const }] };
      }),
  };

  /** Dev helper: a buyer opens a dispute on a capture (sandbox needs a buyer auth assertion for this). */
  simulateDispute(input: { captureId: string; reason?: T.DisputeReason; amount?: Money; buyerMessage?: string; stage?: T.DisputeLifeCycleStage }): Promise<T.Dispute> {
    return this.io("dev.createDispute", undefined, () => {
      const cap = this.state.captures[input.captureId];
      if (!cap) throw notFound("capture", input.captureId);
      const now = this.now();
      const reason = input.reason ?? "MERCHANDISE_OR_SERVICE_NOT_RECEIVED";
      const d: T.Dispute = {
        dispute_id: mockIds.dispute(),
        create_time: this.iso(now),
        update_time: this.iso(now),
        reason,
        status: "WAITING_FOR_SELLER_RESPONSE",
        dispute_state: "REQUIRED_ACTION",
        dispute_amount: input.amount ? money(input.amount.value, input.amount.currency_code) : clone(cap.capture.amount),
        dispute_life_cycle_stage: input.stage ?? "INQUIRY",
        dispute_channel: "INTERNAL",
        seller_response_due_date: this.iso(now + 20 * DAY),
        disputed_transactions: [
          {
            seller_transaction_id: cap.capture.id,
            buyer_transaction_id: mockIds.buyerTransaction(),
            create_time: cap.capture.create_time,
            transaction_status: "COMPLETED",
            gross_amount: clone(cap.capture.amount),
            invoice_number: cap.capture.invoice_id,
            buyer: { name: "Sam Buyer", email: cap.payerEmail },
            seller: { email: this.opts.merchantEmail, merchant_id: this.state.merchantId },
          },
        ],
        allowed_response_options: { accept_claim: { accept_claim_types: reason === "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED" ? ["REFUND", "REFUND_WITH_RETURN", "PARTIAL_REFUND"] : ["REFUND", "PARTIAL_REFUND"] } },
        messages: input.buyerMessage ? [{ posted_by: "BUYER", time_posted: this.iso(now), content: input.buyerMessage }] : [],
        links: [],
      };
      d.links = this.disputeLinks(d);
      this.state.disputes[d.dispute_id] = { dispute: d, captureId: cap.capture.id };
      this.emit("CUSTOMER.DISPUTE.CREATED", d, `A new dispute opened with Case # ${d.dispute_id}`);
      return d;
    });
  }

  /** Dev helper mirroring the sandbox-only adjudicate endpoint. */
  /** Dev helper: the buyer escalates an inquiry to a claim, and PayPal asks the seller for evidence. */
  simulateDisputeEscalation(disputeId: string): Promise<T.Dispute> {
    return this.io("dev.escalate", undefined, () => {
      const d = this.getDisputeRec(disputeId).dispute;
      if (d.status === "RESOLVED" || d.dispute_life_cycle_stage !== "INQUIRY") throw unprocessable("ACTION_NOT_ALLOWED_IN_CURRENT_DISPUTE_STATE", "Only an open inquiry can be escalated.", "customer-disputes/v1");
      d.dispute_life_cycle_stage = "CHARGEBACK";
      d.status = "WAITING_FOR_SELLER_RESPONSE";
      d.dispute_state = "REQUIRED_ACTION";
      d.update_time = this.iso();
      d.links = this.disputeLinks(d);
      this.emit("CUSTOMER.DISPUTE.UPDATED", d, `Dispute ${d.dispute_id} escalated to a claim`);
      return clone(d);
    });
  }

  simulateDisputeResolution(disputeId: string, outcome: "SELLER_FAVOR" | "BUYER_FAVOR"): Promise<T.Dispute> {
    return this.io("dev.adjudicate", undefined, () => {
      const rec = this.getDisputeRec(disputeId);
      const d = rec.dispute;
      if (d.status === "RESOLVED") throw unprocessable("ACTION_NOT_ALLOWED_IN_CURRENT_DISPUTE_STATE", "Dispute is already resolved.", "customer-disputes/v1");
      if (outcome === "BUYER_FAVOR") {
        const refund = this.refundInternal(rec.captureId, { amount: d.dispute_amount }, true);
        d.dispute_outcome = { outcome_code: "RESOLVED_BUYER_FAVOUR", amount_refunded: refund.refund.amount };
      } else {
        d.dispute_outcome = { outcome_code: "RESOLVED_SELLER_FAVOUR" };
      }
      d.status = "RESOLVED";
      d.dispute_state = "RESOLVED";
      d.update_time = this.iso();
      d.links = this.disputeLinks(d);
      this.emit("CUSTOMER.DISPUTE.RESOLVED", d, `Dispute ${d.dispute_id} resolved`);
      return d;
    });
  }

  // ───────────── Transaction Search v1 ─────────────

  transactions: PayPalApi["transactions"] = {
    search: (query) =>
      this.io("transactions.search", undefined, () => {
        if (!query?.start_date || !query?.end_date) throw invalidRequest("MISSING_REQUIRED_PARAMETER", "start_date and end_date are required.");
        const start = Date.parse(query.start_date);
        const end = Date.parse(query.end_date);
        if (Number.isNaN(start) || Number.isNaN(end) || end < start) throw invalidRequest("INVALID_PARAMETER_SYNTAX", "start_date/end_date must be RFC 3339 date-times with end after start.");
        if (end - start > 31 * DAY) throw invalidRequest("INVALID_DATE_RANGE", "The maximum supported date range is 31 days.");
        const size = Math.min(500, Math.max(1, query.page_size ?? 100));
        const page = Math.max(1, query.page ?? 1);
        const matches = this.state.transactions.filter((t) => {
          const at = Date.parse(t.transaction_info.transaction_initiation_date);
          return (
            at >= start &&
            at <= end &&
            (!query.transaction_id || t.transaction_info.transaction_id === query.transaction_id) &&
            (!query.transaction_status || t.transaction_info.transaction_status === query.transaction_status) &&
            (!query.transaction_type || t.transaction_info.transaction_event_code === query.transaction_type)
          );
        });
        return {
          transaction_details: matches.slice((page - 1) * size, page * size),
          account_number: this.state.merchantId,
          start_date: this.iso(start),
          end_date: this.iso(end),
          last_refreshed_datetime: this.iso(),
          page,
          total_items: matches.length,
          total_pages: Math.max(1, Math.ceil(matches.length / size)),
          links: [],
        };
      }),
  };

  // ───────────── Webhooks ─────────────

  webhooks: PayPalApi["webhooks"] = {
    verify: async (headers, rawBody) => verifyMockWebhook(headers, rawBody),
  };

  // ───────────── Vault v3 ─────────────

  private storePaymentToken(input: { email?: string; payerId?: string; customerId?: string; description?: string; usageType?: string }): T.PaymentToken {
    const id = mockIds.paymentToken();
    const customerId = input.customerId ?? mockIds.customer();
    const token: T.PaymentToken = {
      id,
      customer: { id: customerId },
      payment_source: { paypal: { email_address: input.email ?? this.opts.defaultBuyer.email, payer_id: input.payerId ?? mockIds.payer(), description: input.description, usage_type: input.usageType ?? "MERCHANT" } },
      links: [
        { href: `${API}/v3/vault/payment-tokens/${id}`, rel: "self", method: "GET" },
        { href: `${API}/v3/vault/payment-tokens/${id}`, rel: "delete", method: "DELETE" },
      ],
    };
    this.state.paymentTokens[id] = token;
    this.emit("VAULT.PAYMENT-TOKEN.CREATED", token, "A payment token was created");
    return token;
  }

  vault: PayPalApi["vault"] = {
    createSetupToken: (body, opts) =>
      this.io("vault.createSetupToken", opts, (ctx) => {
        ctx.status = 201;
        if (!body?.payment_source?.paypal) throw invalidRequest("MISSING_REQUIRED_PARAMETER", "payment_source.paypal is required.");
        const id = mockIds.setupToken();
        const token: T.SetupToken = {
          id,
          customer: { id: body.customer?.id ?? mockIds.customer() },
          status: "PAYER_ACTION_REQUIRED",
          payment_source: { paypal: { description: body.payment_source.paypal.description, usage_type: body.payment_source.paypal.usage_type ?? "MERCHANT", usage_pattern: body.payment_source.paypal.usage_pattern } },
          links: [
            { href: `${WEB}/agreements/approve?approval_session_id=${id}`, rel: "approve", method: "GET" },
            { href: `${API}/v3/vault/setup-tokens/${id}`, rel: "self", method: "GET" },
            { href: `${API}/v3/vault/payment-tokens`, rel: "confirm", method: "POST" },
          ],
        };
        this.state.setupTokens[id] = { token };
        return token;
      }, 201),

    getSetupToken: (id) =>
      this.io("vault.getSetupToken", undefined, () => {
        const rec = this.state.setupTokens[id];
        if (!rec) throw notFound("setup token", id);
        return rec.token;
      }),

    createPaymentToken: (body, opts) =>
      this.io("vault.createPaymentToken", opts, (ctx) => {
        ctx.status = 201;
        const setupId = body?.payment_source?.token?.id;
        const rec = setupId ? this.state.setupTokens[setupId] : undefined;
        if (!setupId || !rec) throw notFound("setup token", String(setupId));
        if (rec.token.status === "VAULTED" || rec.token.status === "TOKENIZED") throw unprocessable("SETUP_TOKEN_ALREADY_TOKENIZED", "This setup token has already been used to create a payment token.", "payment-tokens/v3");
        if (rec.token.status !== "APPROVED") throw unprocessable("PAYER_ACTION_REQUIRED", "The payer has not approved this setup token yet.", "payment-tokens/v3");
        rec.token.status = "VAULTED";
        const src = rec.token.payment_source.paypal as { description?: string; usage_type?: string } | undefined;
        return this.storePaymentToken({ email: rec.payerEmail, payerId: rec.payerId, customerId: body.customer?.id ?? rec.token.customer?.id, description: src?.description, usageType: src?.usage_type });
      }, 201),

    getPaymentToken: (id) =>
      this.io("vault.getPaymentToken", undefined, () => {
        const token = this.state.paymentTokens[id];
        if (!token) throw notFound("payment token", id);
        return token;
      }),

    listPaymentTokens: (customerId) =>
      this.io("vault.listPaymentTokens", undefined, () => {
        const tokens = Object.values(this.state.paymentTokens).filter((t) => t.customer.id === customerId);
        return { customer: { id: customerId }, payment_tokens: tokens, total_items: tokens.length, total_pages: 1, links: [] };
      }),

    deletePaymentToken: (id) =>
      this.io("vault.deletePaymentToken", undefined, (ctx) => {
        ctx.status = 204;
        const token = this.state.paymentTokens[id];
        if (!token) throw notFound("payment token", id);
        delete this.state.paymentTokens[id];
        this.emit("VAULT.PAYMENT-TOKEN.DELETED", token, "A payment token was deleted");
        return undefined;
      }, 204),
  };

  /** Dev helper: the buyer approves saving their PayPal wallet (setup token -> APPROVED). */
  approveSetupToken(setupTokenId: string, buyer?: { email?: string }): Promise<T.SetupToken> {
    return this.io("dev.approveSetupToken", undefined, () => {
      const rec = this.state.setupTokens[setupTokenId];
      if (!rec) throw notFound("setup token", setupTokenId);
      if (rec.token.status !== "PAYER_ACTION_REQUIRED" && rec.token.status !== "CREATED") throw unprocessable("ORDER_NOT_APPROVABLE", `Setup token is ${rec.token.status}.`);
      rec.token.status = "APPROVED";
      rec.payerEmail = buyer?.email ?? this.opts.defaultBuyer.email;
      rec.payerId = mockIds.payer();
      return rec.token;
    });
  }

  // ───────────── dev utilities ─────────────

  reset() {
    this.state = emptyState();
    this.save();
  }

  /** Read-only snapshot of everything (dev grids, tests). */
  snapshot() {
    this.syncFromDisk();
    return {
      orders: Object.keys(this.state.orders).map((id) => this.renderOrder(id)),
      authorizations: Object.values(this.state.authorizations).map((r) => clone(r.auth)),
      captures: Object.values(this.state.captures).map((r) => clone(r.capture)),
      refunds: Object.values(this.state.refunds).map((r) => clone(r.refund)),
      payouts: Object.values(this.state.payouts).map((r) => clone(r.batch)),
      invoices: Object.values(this.state.invoices).map((r) => clone(r.invoice)),
      disputes: Object.values(this.state.disputes).map((r) => clone(r.dispute)),
      paymentTokens: Object.values(this.state.paymentTokens).map(clone),
      transactions: clone(this.state.transactions),
    };
  }

  /** Remaining authorized-but-uncaptured amount (dev UIs). */
  authorizationRemaining(authorizationId: string): Money | undefined {
    const rec = this.state.authorizations[authorizationId];
    if (!rec) return undefined;
    return moneyFromMinor(Math.max(0, toMinor(rec.auth.amount.value, rec.auth.amount.currency_code) - rec.capturedMinor), rec.auth.amount.currency_code);
  }

  honorPeriodEndsAt(authorizationId: string): string | undefined {
    const rec = this.state.authorizations[authorizationId];
    return rec ? this.iso(rec.honorUntil) : undefined;
  }

  newRequestId() {
    return randomUUID();
  }

  /** Run fn with a different simulated latency (e.g. [0, 0] while seeding). */
  async withLatency<R>(latencyMs: [number, number], fn: () => Promise<R>): Promise<R> {
    const prev = this.opts.latencyMs;
    this.opts.latencyMs = latencyMs;
    try {
      return await fn();
    } finally {
      this.opts.latencyMs = prev;
    }
  }
}
