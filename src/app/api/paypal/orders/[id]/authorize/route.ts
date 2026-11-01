import { route } from "@/lib/http";
import { getPayPal } from "@/lib/paypal";

/** Authorize an approved intent=AUTHORIZE order: places a hold valid 29 days (3-day honor period). */
export const POST = route<RouteContext<"/api/paypal/orders/[id]/authorize">>(async (req, ctx) => {
  const { id } = await ctx.params;
  return getPayPal().orders.authorize(id, { requestId: req.headers.get("x-idempotency-key") ?? undefined });
});
