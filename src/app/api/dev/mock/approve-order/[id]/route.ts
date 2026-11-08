import { z } from "zod";
import { forOrder } from "@/lib/deposit/booking-events";
import { readJson, route } from "@/lib/http";
import { getMockPayPal } from "@/lib/paypal";
import { getEnv } from "@/lib/env";

/** Mock mode only: what the buyer does in the PayPal popup (CREATED -> APPROVED). */
export const POST = route<RouteContext<"/api/dev/mock/approve-order/[id]">>(
  async (req, ctx) => {
    const b = await readJson(req, z.object({ email: z.string().email().optional() }));
    const { id } = await ctx.params;
    // The buyer's approval belongs to the booking whose order it is, so it stays on that booking's list.
    return forOrder(id, () => getMockPayPal()!.simulateBuyerApproval(id, { email: b.email ?? getEnv().sandboxBuyerEmail }));
  },
  { mockOnly: true },
);
