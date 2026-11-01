import { z } from "zod";
import { readJson, route, moneyValue } from "@/lib/http";
import { getPayPal } from "@/lib/paypal";
import { money } from "@/lib/money";

const Body = z.object({ amount: z.string().regex(moneyValue).optional(), currency_code: z.string().length(3).default("USD"), final_capture: z.boolean().optional(), note_to_payer: z.string().max(255).optional() });

export const POST = route<RouteContext<"/api/paypal/authorizations/[id]/capture">>(async (req, ctx) => {
  const { id } = await ctx.params;
  const b = await readJson(req, Body);
  return getPayPal().payments.captureAuthorization(
    id,
    { ...(b.amount ? { amount: money(b.amount, b.currency_code) } : {}), final_capture: b.final_capture, note_to_payer: b.note_to_payer },
    { requestId: req.headers.get("x-idempotency-key") ?? undefined },
  );
});
