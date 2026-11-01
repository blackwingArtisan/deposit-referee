import { z } from "zod";
import { readJson, route } from "@/lib/http";
import { getMockPayPal } from "@/lib/paypal";
import { getEnv } from "@/lib/env";

/** Mock mode only: what the buyer does in the PayPal popup (CREATED -> APPROVED). */
export const POST = route<RouteContext<"/api/dev/mock/approve-order/[id]">>(
  async (req, ctx) => {
    const b = await readJson(req, z.object({ email: z.string().email().optional() }));
    return getMockPayPal()!.simulateBuyerApproval((await ctx.params).id, { email: b.email ?? getEnv().sandboxBuyerEmail });
  },
  { mockOnly: true },
);
