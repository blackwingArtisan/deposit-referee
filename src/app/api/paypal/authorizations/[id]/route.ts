import { route } from "@/lib/http";
import { getPayPal } from "@/lib/paypal";
import { authorizationState } from "@/lib/agent/tools/extensions";

/** Authorization + captured/remaining amounts (computed from the order). */
export const GET = route<RouteContext<"/api/paypal/authorizations/[id]">>(async (_req, ctx) => {
  const s = await authorizationState(getPayPal(), (await ctx.params).id);
  return { authorization: s.authorization, captured: s.captured, remaining: s.remaining, captures: s.captures, order_id: s.orderId };
});
