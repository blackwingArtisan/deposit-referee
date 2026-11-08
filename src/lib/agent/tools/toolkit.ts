/**
 * PayPal Agent Toolkit (@paypal/agent-toolkit 1.11.0) integration.
 *
 * What we use from the toolkit:
 *   - its tool catalog: names, descriptions and JSON Schemas (via the `/openai` entry, which
 *     does not load the `ai` package — the toolkit's `/ai-sdk` entry is ai@4-only)
 *   - its own zod validators (via `/mcp` PayPalMCPToolkit.getTools())
 *   - its executor `PayPalAPI.run(method, args)` for real sandbox calls
 *
 * What we add:
 *   - every call goes through our Guard (caps, allowlist, approvals, idempotency, audit);
 *     the toolkit itself has no spend limits or human gate
 *   - sandbox is forced on (`context.sandbox: true`; the toolkit defaults to LIVE otherwise)
 *   - a fresh OAuth token from our cache each call (the toolkit never refreshes its token)
 *   - the idempotency key is sent as PayPal-Request-Id (toolkit `context.request_id`)
 *   - mock-mode adapters that implement the same tool names against MockPayPal
 */
import { ALL_TOOLS_ENABLED, PayPalAgentToolkit } from "@paypal/agent-toolkit/openai";
import { PayPalAPI, PayPalMCPToolkit } from "@paypal/agent-toolkit/mcp";
import { startStep } from "../../events/bus";
import { formatMoney, money, moneyFromMinor, toMinor, type Money } from "../../money";
import type { PayPalApi } from "../../paypal/api";
import { getSandboxAccessToken } from "../../paypal";
import { ingestPayPalResource } from "../../paypal/ledger";
import type * as T from "../../paypal/types";
import { singleton } from "../../singleton";
import type { AgentTool, ToolContext, ToolImpact, ToolRisk } from "../tool";

type ZodV3Like = { parse(input: unknown): unknown };

interface CatalogEntry {
  name: string;
  description: string;
  jsonSchema: Record<string, unknown>;
  validator: ZodV3Like;
}

/** The toolkit's catalog, built once. No network: the constructors only build tool lists. */
export function toolkitCatalog(): Map<string, CatalogEntry> {
  return singleton("agent:toolkit-catalog", () => {
    const configuration = { actions: ALL_TOOLS_ENABLED, context: { sandbox: true } };
    const openai = new PayPalAgentToolkit({ clientId: "catalog-only", clientSecret: "catalog-only", configuration });
    const mcp = new PayPalMCPToolkit({ accessToken: "catalog-only", configuration });
    const validators = new Map(mcp.getTools().map((t) => [t.method, t.parameters as unknown as ZodV3Like]));
    const map = new Map<string, CatalogEntry>();
    for (const t of openai.getTools()) {
      if (t.type !== "function") continue;
      const fn = t.function;
      const schema = { ...(fn.parameters as Record<string, unknown>) };
      delete schema.$schema;
      map.set(fn.name, { name: fn.name, description: fn.description ?? fn.name, jsonSchema: schema, validator: validators.get(fn.name) ?? { parse: (x) => x } });
    }
    return map;
  });
}

export class ToolkitError extends Error {
  constructor(
    message: string,
    readonly code?: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "PayPalAgentToolkitError";
  }
}

/** Executes a toolkit method against the PayPal SANDBOX through the toolkit's own PayPalAPI. */
async function runToolkitInSandbox(method: string, args: unknown, ctx: ToolContext): Promise<unknown> {
  const token = await getSandboxAccessToken();
  // sandbox:true is mandatory — the toolkit's default is the live API.
  const api = new PayPalAPI(token, { sandbox: true, request_id: ctx.requestId || undefined });
  // The Toolkit makes the HTTP call itself; name the PayPal endpoint where we know it.
  const id = (args as { id?: unknown } | null)?.id;
  const [verb, path] = method === "get_order" && typeof id === "string" ? ["GET", `/v2/checkout/orders/${id}`] : ["TOOLKIT", method];
  const step = startStep({ kind: "paypal", title: `Agent Toolkit · ${method}`, subtitle: "@paypal/agent-toolkit → api-m.sandbox.paypal.com", paypal: { operation: `toolkit.${method}`, method: verb, path, mode: "sandbox", via: { tool: method, toolkit: method } }, data: verb === "GET" ? { quiet: true } : undefined });
  const raw = await api.run(method, args);
  let parsed: unknown = raw;
  try {
    parsed = JSON.parse(raw);
  } catch {
    /* some tools return plain strings */
  }
  const p = parsed as { ok?: boolean; code?: string; status?: number; message?: string; error?: { message?: string; type?: string } } | null;
  if (p && typeof p === "object" && (p.ok === false || (p.error && !("id" in p)))) {
    const err = new ToolkitError(p.message ?? p.error?.message ?? "PayPal Agent Toolkit call failed", p.code ?? p.error?.type, p.status);
    step.fail(err);
    throw err;
  }
  ingestPayPalResource(p && typeof p === "object" && "response" in p ? (p as { response: unknown }).response : parsed);
  step.succeed({ detail: "OK" });
  return parsed;
}

// ───────────── mock adapters: same tool names + arg shapes, backed by MockPayPal ─────────────

type ToolkitOrderArgs = {
  currencyCode: "USD";
  items: { name: string; quantity: number; description?: string; itemCost: number; taxPercent: number; itemTotal: number }[];
  discount?: number;
  shippingCost?: number;
  shippingAddress?: Record<string, string> | null;
  notes?: string | null;
  returnUrl?: string;
  cancelUrl?: string;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Mirrors the toolkit's parseOrderDetails() so mock and sandbox build identical orders. */
export function toolkitOrderRequest(a: ToolkitOrderArgs): T.CreateOrderRequest {
  const c = a.currencyCode;
  const subTotal = a.items.reduce((s, i) => s + i.itemCost * i.quantity, 0);
  const tax = a.items.reduce((s, i) => s + (i.itemCost * i.taxPercent * i.quantity) / 100, 0);
  const shipping = a.shippingCost ?? 0;
  const discount = a.discount ?? 0;
  const total = subTotal + tax + shipping - discount;
  const m = (n: number) => ({ currency_code: c, value: round2(n).toFixed(2) });
  return {
    intent: "CAPTURE",
    purchase_units: [
      {
        amount: { ...m(total), breakdown: { item_total: m(subTotal), shipping: m(shipping), tax_total: m(tax), discount: m(discount) } },
        items: a.items.map((i) => ({ name: i.name, description: i.description, unit_amount: m(i.itemCost), quantity: String(i.quantity), tax: m((i.itemCost * i.taxPercent) / 100) })),
        ...(a.shippingAddress ? { shipping: { address: a.shippingAddress } } : {}),
      },
    ],
    ...(a.returnUrl || a.cancelUrl ? { payment_source: { paypal: { experience_context: { return_url: a.returnUrl, cancel_url: a.cancelUrl } } } } : {}),
  };
}

/** Mirrors the toolkit's buildCreateInvoicePayload() (flat args -> nested invoice). */
export function toolkitInvoiceRequest(a: Record<string, unknown>): T.CreateInvoiceRequest {
  const s = (k: string) => (a[k] as string | undefined) || undefined;
  return {
    detail: { currency_code: String(a.currency_code), invoice_number: s("invoice_number"), invoice_date: s("invoice_date"), reference: s("reference"), note: s("note") },
    invoicer: {
      business_name: s("invoicer_business_name"),
      name: s("invoicer_given_name") || s("invoicer_surname") ? { given_name: s("invoicer_given_name"), surname: s("invoicer_surname") } : undefined,
      email_address: s("invoicer_email_address"),
    },
    primary_recipients: (a.primary_recipients as T.InvoiceRecipient[]) ?? [],
    items: (a.items as T.InvoiceItem[]) ?? [],
    configuration: a.allow_tip !== undefined ? { allow_tip: Boolean(a.allow_tip) } : undefined,
  };
}

function lastMonthRange(a: { start_date?: string; end_date?: string }) {
  const end = a.end_date ? new Date(a.end_date) : new Date(Date.now() + 60_000);
  let start = a.start_date ? new Date(a.start_date) : new Date(end.getTime() - 31 * 864e5);
  if (end.getTime() - start.getTime() > 31 * 864e5) start = new Date(end.getTime() - 31 * 864e5);
  return { start_date: start.toISOString(), end_date: end.toISOString() };
}

type Args = Record<string, unknown> & { [k: string]: any }; // eslint-disable-line @typescript-eslint/no-explicit-any

const MOCK_ADAPTERS: Record<string, (pp: PayPalApi, a: Args, ctx: ToolContext) => Promise<unknown>> = {
  create_order: (pp, a, ctx) => pp.orders.create(toolkitOrderRequest(a as unknown as ToolkitOrderArgs), { requestId: ctx.requestId }),
  get_order: (pp, a) => pp.orders.get(a.id),
  pay_order: async (pp, a, ctx) => ({ status: "success", response: await pp.orders.capture(a.id, { requestId: ctx.requestId }) }),
  create_refund: (pp, a, ctx) => pp.payments.refundCapture(a.capture_id, { amount: a.amount, invoice_id: a.invoice_id, note_to_payer: a.note_to_payer }, { requestId: ctx.requestId }),
  get_refund: (pp, a) => pp.payments.getRefund(a.refund_id),
  list_transactions: (pp, a) => pp.transactions.search({ ...lastMonthRange(a), transaction_id: a.transaction_id ?? undefined, transaction_status: a.transaction_status, page_size: a.page_size, page: a.page }),
  create_invoice: (pp, a) => pp.invoicing.create(toolkitInvoiceRequest(a)),
  list_invoices: (pp, a) => pp.invoicing.list({ page: a.page, page_size: a.page_size, total_required: a.total_required }),
  get_invoice: (pp, a) => pp.invoicing.get(a.invoice_id),
  send_invoice: (pp, a) => pp.invoicing.send(a.invoice_id, { note: a.note, send_to_recipient: a.send_to_recipient, additional_recipients: a.additional_recipients }),
  send_invoice_reminder: async (pp, a) => {
    await pp.invoicing.remind(a.invoice_id, { subject: a.subject, note: a.note, additional_recipients: a.additional_recipients });
    return { status: "reminder_sent", invoice_id: a.invoice_id };
  },
  cancel_sent_invoice: async (pp, a) => {
    await pp.invoicing.cancel(a.invoice_id, { note: a.note, send_to_recipient: a.send_to_recipient, additional_recipients: a.additional_recipients });
    return { status: "cancelled", invoice_id: a.invoice_id };
  },
  record_payment_for_invoice: (pp, a) => pp.invoicing.recordPayment(a.invoice_id, { method: a.method, payment_date: a.payment_date, amount: a.amount, note: a.note, payment_id: a.payment_id }),
  list_disputes: (pp, a) => pp.disputes.list({ dispute_state: a.dispute_state, disputed_transaction_id: a.disputed_transaction_id ?? undefined, page_size: a.page_size, page: a.page }),
  get_dispute: (pp, a) => pp.disputes.get(a.dispute_id),
  accept_dispute_claim: (pp, a) => pp.disputes.acceptClaim(a.dispute_id, { note: a.note }),
};

// ───────────── guard metadata per toolkit tool ─────────────

async function orderTotal(pp: PayPalApi, id: string): Promise<{ amount: Money }> {
  const o = await pp.orders.get(id);
  const u = o.purchase_units?.[0];
  if (!u) throw new Error(`Order ${id} has no purchase units`);
  return { amount: money(u.amount.value, u.amount.currency_code) };
}

async function captureRemaining(pp: PayPalApi, id: string): Promise<Money> {
  const c = await pp.payments.getCapture(id);
  const gross = money(c.amount.value, c.amount.currency_code);
  // Refunds already made are visible on the order (if any); fall back to the gross amount.
  const orderId = c.supplementary_data?.related_ids.order_id;
  if (!orderId) return gross;
  const o = await pp.orders.get(orderId).catch(() => null);
  const refunds = o?.purchase_units?.flatMap((u) => u.payments?.refunds ?? []).filter((r) => r.links?.some((l) => l.href.endsWith(`/captures/${id}`))) ?? [];
  const refunded = refunds.reduce((s, r) => s + toMinor(r.amount.value, r.amount.currency_code), 0);
  return moneyFromMinor(Math.max(0, toMinor(gross.value, gross.currency_code) - refunded), gross.currency_code);
}

const META: Record<string, { risk: ToolRisk; title?: (a: Args) => string; impact?: (a: Args, pp: PayPalApi) => Promise<ToolImpact> }> = {
  create_order: {
    risk: "write",
    impact: async (a) => {
      const total = toolkitOrderRequest(a as unknown as ToolkitOrderArgs).purchase_units[0].amount;
      const amount = money(total.value, total.currency_code);
      return { amount, summary: `Create a ${formatMoney(amount)} PayPal order for buyer approval` };
    },
  },
  get_order: { risk: "read", title: (a) => `Look up order ${a.id}` },
  pay_order: {
    risk: "money",
    impact: async (a, pp) => {
      const { amount } = await orderTotal(pp, a.id);
      return { amount, summary: `Capture ${formatMoney(amount)} on order ${a.id}` };
    },
  },
  create_refund: {
    risk: "money",
    impact: async (a, pp) => {
      const amount = a.amount ? money(a.amount.value, a.amount.currency_code) : await captureRemaining(pp, a.capture_id);
      return { amount, summary: `Refund ${formatMoney(amount)} on capture ${a.capture_id}` };
    },
  },
  get_refund: { risk: "read", title: (a) => `Look up refund ${a.refund_id}` },
  list_transactions: { risk: "read", title: () => "Search recent transactions" },
  create_invoice: {
    risk: "write",
    impact: async (a) => {
      const req = toolkitInvoiceRequest(a);
      const total = req.items.reduce((s, i) => s + Math.round(toMinor(i.unit_amount.value, i.unit_amount.currency_code) * Number(i.quantity)), 0);
      const amount = moneyFromMinor(total, req.detail.currency_code);
      const to = req.primary_recipients?.[0]?.billing_info?.email_address;
      return { amount, counterparties: to ? [to] : undefined, summary: `Draft a ${formatMoney(amount)} invoice${to ? ` to ${to}` : ""}` };
    },
  },
  list_invoices: { risk: "read", title: () => "List invoices" },
  get_invoice: { risk: "read", title: (a) => `Look up invoice ${a.invoice_id}` },
  send_invoice: {
    risk: "write",
    impact: async (a, pp) => {
      const inv = await pp.invoicing.get(a.invoice_id);
      const amount = money(inv.amount.value, inv.amount.currency_code);
      const to = inv.primary_recipients?.[0]?.billing_info?.email_address;
      return { amount, counterparties: to ? [to] : undefined, summary: `Send invoice ${inv.detail.invoice_number} for ${formatMoney(amount)}${to ? ` to ${to}` : ""}` };
    },
  },
  send_invoice_reminder: { risk: "write", title: (a) => `Remind about invoice ${a.invoice_id}`, impact: async (a) => ({ summary: `Send a payment reminder for ${a.invoice_id}` }) },
  cancel_sent_invoice: { risk: "write", title: (a) => `Cancel invoice ${a.invoice_id}`, impact: async (a) => ({ summary: `Cancel invoice ${a.invoice_id}` }) },
  record_payment_for_invoice: {
    risk: "write",
    impact: async (a) => ({ amount: a.amount ? money(a.amount.value, a.amount.currency_code) : undefined, summary: `Record a ${a.method} payment on ${a.invoice_id}` }),
  },
  list_disputes: { risk: "read", title: () => "List open disputes" },
  get_dispute: { risk: "read", title: (a) => `Review dispute ${a.dispute_id}` },
  accept_dispute_claim: {
    risk: "money",
    impact: async (a, pp) => {
      const d = await pp.disputes.get(a.dispute_id);
      const amount = money(d.dispute_amount.value, d.dispute_amount.currency_code);
      return { amount, summary: `Accept claim on ${a.dispute_id} and refund ${formatMoney(amount)}` };
    },
  },
};

/** Toolkit tools the kit supports in both mock and sandbox mode. */
export const TOOLKIT_TOOL_NAMES = Object.keys(MOCK_ADAPTERS);

/**
 * Builds guarded AgentTools for the given PayPal Agent Toolkit tool names.
 * In mock mode, only names with a mock adapter are available.
 */
export function toolkitTools(names: string[] = TOOLKIT_TOOL_NAMES, mode: "mock" | "sandbox"): AgentTool[] {
  const catalog = toolkitCatalog();
  return names.map((name) => {
    const entry = catalog.get(name);
    if (!entry) throw new Error(`"${name}" is not a PayPal Agent Toolkit 1.11 tool`);
    const meta = META[name] ?? { risk: /^(get|list|show|search)_/.test(name) ? "read" : "write" };
    if (mode === "mock" && !MOCK_ADAPTERS[name]) throw new Error(`Toolkit tool "${name}" has no mock adapter; add one in tools/toolkit.ts or use sandbox mode`);
    let schema = entry.jsonSchema;
    let parse = (input: unknown) => entry.validator.parse(input ?? {});
    if (name === "accept_dispute_claim") {
      // Toolkit 1.11 bug (github.com/paypal/agent-toolkit issue #109): `note` is validated
      // against the dispute-id regex, so any normal sentence fails. Use a plain string.
      schema = { type: "object", properties: { dispute_id: { type: "string" }, note: { type: "string", description: "Why the seller accepts the claim" } }, required: ["dispute_id", "note"], additionalProperties: false };
      parse = (input) => {
        const i = (input ?? {}) as { dispute_id?: unknown; note?: unknown };
        if (typeof i.dispute_id !== "string" || typeof i.note !== "string") throw new Error("dispute_id and note are required strings");
        return { dispute_id: i.dispute_id, note: i.note };
      };
    }
    const tool: AgentTool<Args> = {
      name,
      description: entry.description.trim(),
      source: "paypal-agent-toolkit",
      risk: meta.risk,
      inputSchema: schema,
      parse: (input) => parse(input) as Args,
      title: meta.title,
      impact: meta.impact ? (a, ctx) => meta.impact!(a, ctx.paypal) : undefined,
      execute: (a, ctx) => (mode === "sandbox" ? runToolkitInSandbox(name, a, ctx) : MOCK_ADAPTERS[name](ctx.paypal, a, ctx)),
    };
    return tool as AgentTool;
  });
}

