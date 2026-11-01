import { route } from "@/lib/http";
import { getPayPal } from "@/lib/paypal";

export const POST = route<RouteContext<"/api/paypal/authorizations/[id]/void">>(async (req, ctx) =>
  getPayPal().payments.voidAuthorization((await ctx.params).id, { requestId: req.headers.get("x-idempotency-key") ?? undefined }),
);
