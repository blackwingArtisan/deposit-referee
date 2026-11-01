import { route } from "@/lib/http";
import { getPayPal } from "@/lib/paypal";

/** Capture an approved intent=CAPTURE order (called from the checkout button's onApprove). */
export const POST = route<RouteContext<"/api/paypal/orders/[id]/capture">>(async (req, ctx) => {
  const { id } = await ctx.params;
  return getPayPal().orders.capture(id, { requestId: req.headers.get("x-idempotency-key") ?? undefined });
});
