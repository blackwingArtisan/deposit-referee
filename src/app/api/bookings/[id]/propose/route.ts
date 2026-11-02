import { runSettlementAgent } from "@/agents/settlement";
import { requireBooking, viewBooking } from "@/lib/deposit/bookings";
import { getContext } from "@/lib/events/bus";
import { HttpError, route } from "@/lib/http";

/** Asks the settlement agent again after it stopped without a proposal. */
export const POST = route<RouteContext<"/api/bookings/[id]/propose">>(
  async (_req, ctx) => {
    const booking = requireBooking((await ctx.params).id);
    if (booking.status !== "reviewed") throw new HttpError(409, "This booking isn't waiting for a proposal.", "conflict");
    return viewBooking(await runSettlementAgent(booking.id, getContext().channel));
  },
  { rateLimit: "ai" },
);
