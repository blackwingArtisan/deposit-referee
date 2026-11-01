/**
 * Wraps a PayPalApi so every call shows up on the timeline (method, path, status, debug id,
 * duration, amount) and lands in the local ledger. Same behaviour for mock and sandbox.
 */
import { performance } from "node:perf_hooks";
import { startStep } from "../events/bus";
import { formatMoney, sumMoney, type Money } from "../money";
import type { PayPalApi } from "./api";
import { ingestPayPalResource } from "./ledger";
import { runWithCallMeta, type CallMeta } from "./meta";
import { OPERATIONS, operationPath, type OperationKey, type OperationSpec } from "./operations";

function amountFrom(value: unknown): Money | undefined {
  if (!value || typeof value !== "object") return undefined;
  const v = value as Record<string, unknown>;
  const asMoney = (m: unknown) =>
    m && typeof m === "object" && "value" in m && "currency_code" in m ? ({ currency_code: String((m as Money).currency_code), value: String((m as Money).value) } as Money) : undefined;
  if (asMoney(v.amount)) return asMoney(v.amount);
  if (asMoney(v.dispute_amount)) return asMoney(v.dispute_amount);
  if (asMoney(v.refund_amount)) return asMoney(v.refund_amount);
  if (Array.isArray(v.purchase_units) && v.purchase_units.length) {
    try {
      return sumMoney((v.purchase_units as { amount: Money }[]).map((u) => ({ currency_code: u.amount.currency_code, value: u.amount.value })));
    } catch {
      return undefined;
    }
  }
  if (Array.isArray(v.items) && v.items.length && typeof v.items[0] === "object" && v.items[0] && "receiver" in (v.items[0] as object)) {
    const items = v.items as { amount: { currency: string; value: string } }[];
    try {
      return sumMoney(items.map((i) => ({ currency_code: i.amount.currency, value: i.amount.value })));
    } catch {
      return undefined;
    }
  }
  return undefined;
}

const DIRECTION: Partial<Record<OperationKey, "in" | "out" | "hold" | "neutral">> = {
  "orders.capture": "in",
  "payments.captureAuthorization": "in",
  "orders.authorize": "hold",
  "payments.reauthorize": "hold",
  "payments.voidAuthorization": "neutral",
  "payments.refundCapture": "out",
  "payouts.create": "out",
  "disputes.acceptClaim": "out",
  "invoicing.send": "in",
  "invoicing.recordPayment": "in",
};

function describe(op: OperationKey, result: unknown): string | undefined {
  if (!result || typeof result !== "object") return op.endsWith("remind") ? "Reminder sent" : op.endsWith("cancel") ? "Cancelled" : undefined;
  const r = result as Record<string, unknown>;
  if (r.batch_header && typeof r.batch_header === "object") {
    const h = r.batch_header as { payout_batch_id: string; batch_status: string };
    return `Batch ${h.payout_batch_id} · ${h.batch_status}`;
  }
  if (typeof r.dispute_id === "string") return `Dispute ${r.dispute_id} · ${String(r.status)}`;
  if (typeof r.id === "string" && typeof r.status === "string") return `${r.id} · ${r.status}`;
  if (typeof r.href === "string") return r.href;
  if (typeof r.payment_id === "string") return `Payment ${r.payment_id} recorded`;
  if (Array.isArray(r.items)) return `${r.items.length} item(s)`;
  if (Array.isArray(r.transaction_details)) return `${r.transaction_details.length} transaction(s)`;
  if (typeof r.verified === "boolean") return r.verified ? "Signature verified" : `Not verified: ${String(r.reason ?? r.status)}`;
  return undefined;
}

/** Operations that return a link or nothing: re-read the resource (uninstrumented) so the ledger stays current. */
const REFRESH_AFTER: Partial<Record<OperationKey, (impl: PayPalApi, id: string) => Promise<unknown>>> = {
  "invoicing.send": (impl, id) => impl.invoicing.get(id),
  "invoicing.remind": (impl, id) => impl.invoicing.get(id),
  "invoicing.cancel": (impl, id) => impl.invoicing.get(id),
  "invoicing.recordPayment": (impl, id) => impl.invoicing.get(id),
  "disputes.provideEvidence": (impl, id) => impl.disputes.get(id),
  "disputes.acceptClaim": (impl, id) => impl.disputes.get(id),
};

/** Amount badges would mislead for these (a void releases money; it doesn't move the full amount). */
const NO_AMOUNT = new Set<OperationKey>(["payments.voidAuthorization"]);

export function instrument(impl: PayPalApi): PayPalApi {
  const wrapped: Record<string, unknown> = { mode: impl.mode };
  for (const ns of ["orders", "payments", "payouts", "invoicing", "disputes", "transactions", "webhooks", "vault"] as const) {
    const target = impl[ns] as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
    const proxy: Record<string, unknown> = {};
    for (const method of Object.keys(target)) {
      const op = `${ns}.${method}` as OperationKey;
      const spec: OperationSpec | undefined = OPERATIONS[op];
      proxy[method] = async (...args: unknown[]) => {
        if (!spec) return target[method](...args);
        const id = typeof args[0] === "string" ? args[0] : undefined;
        const path = operationPath(op, id);
        const requestBody = typeof args[0] === "string" ? args[1] : args[0];
        const requestAmount = amountFrom(requestBody);
        const quiet = spec.method === "GET" || op === "webhooks.verify";
        const step = startStep({
          kind: "paypal",
          title: spec.label,
          subtitle: `${spec.method} ${path}`,
          amount: requestAmount,
          direction: DIRECTION[op],
          paypal: { operation: op, method: spec.method, path, mode: impl.mode },
          data: quiet ? { quiet: true } : undefined,
        });
        const meta: CallMeta = {};
        const t0 = performance.now();
        try {
          const result = await runWithCallMeta(meta, () => target[method](...args));
          ingestPayPalResource(result, requestBody);
          const refresh = REFRESH_AFTER[op];
          if (refresh && id) await refresh(impl, id).then((r) => ingestPayPalResource(r), () => undefined);
          const amount = NO_AMOUNT.has(op) ? undefined : (amountFrom(result) ?? requestAmount);
          step.succeed({
            amount,
            direction: DIRECTION[op],
            detail: describe(op, result) ?? (amount ? formatMoney(amount) : undefined),
            paypal: { operation: op, method: spec.method, path, mode: impl.mode, httpStatus: meta.httpStatus, debugId: meta.debugId, requestId: meta.requestId, durationMs: Math.round(performance.now() - t0) },
            data: { quiet, replayed: meta.replayed, request: requestBody, response: result },
          });
          return result;
        } catch (error) {
          const e = error as { status?: number; debugId?: string };
          step.fail(error, {
            paypal: { operation: op, method: spec.method, path, mode: impl.mode, httpStatus: e.status ?? meta.httpStatus, debugId: e.debugId ?? meta.debugId, requestId: meta.requestId, durationMs: Math.round(performance.now() - t0) },
            data: { request: requestBody },
          });
          throw error;
        }
      };
    }
    wrapped[ns] = proxy;
  }
  return wrapped as unknown as PayPalApi;
}
