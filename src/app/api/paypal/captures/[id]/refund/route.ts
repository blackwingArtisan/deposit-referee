import { z } from "zod";
import { readJson, route, moneyValue } from "@/lib/http";
import { getPayPal } from "@/lib/paypal";
import { money } from "@/lib/money";

const Body = z.object({ amount: z.string().regex(moneyValue).optional(), currency_code: z.string().length(3).default("USD"), note_to_payer: z.string().max(255).optional() });

/** Omit amount for a full refund of what is left. */
export const POST = route<RouteContext<"/api/paypal/captures/[id]/refund">>(async (req, ctx) => {
  const b = await readJson(req, Body);
  return getPayPal().payments.refundCapture(
    (await ctx.params).id,
    { ...(b.amount ? { amount: money(b.amount, b.currency_code) } : {}), note_to_payer: b.note_to_payer },
    { requestId: req.headers.get("x-idempotency-key") ?? undefined },
  );
});
