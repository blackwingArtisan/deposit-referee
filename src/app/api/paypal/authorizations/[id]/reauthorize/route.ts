import { z } from "zod";
import { readJson, route, moneyValue } from "@/lib/http";
import { getPayPal } from "@/lib/paypal";
import { money } from "@/lib/money";

const Body = z.object({ amount: z.string().regex(moneyValue).optional(), currency_code: z.string().length(3).default("USD") });

export const POST = route<RouteContext<"/api/paypal/authorizations/[id]/reauthorize">>(async (req, ctx) => {
  const b = await readJson(req, Body);
  return getPayPal().payments.reauthorize((await ctx.params).id, b.amount ? { amount: money(b.amount, b.currency_code) } : {});
});
