import { route } from "@/lib/http";
import { getPayPal } from "@/lib/paypal";

export const GET = route<RouteContext<"/api/paypal/orders/[id]">>(async (_req, ctx) => getPayPal().orders.get((await ctx.params).id));
