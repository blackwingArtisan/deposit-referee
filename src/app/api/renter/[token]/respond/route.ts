import { z } from "zod";
import { forBooking } from "@/lib/deposit/booking-events";
import { requireBookingByToken } from "@/lib/deposit/bookings";
import { respondAsRenter } from "@/lib/deposit/renter";
import { readJson, route } from "@/lib/http";

const Body = z.object({ decision: z.enum(["accepted", "contested"]), note: z.string().max(500).optional(), accepted_line_ids: z.array(z.string().max(40)).max(20).optional() });

/** The renter's answer. A contest stops the capture and hands it back to the host with this note. */
export const POST = route<RouteContext<"/api/renter/[token]/respond">>(async (req, ctx) => {
  const { decision, note, accepted_line_ids } = await readJson(req, Body);
  const { token } = await ctx.params;
  return forBooking(requireBookingByToken(token).id, () => respondAsRenter(token, decision, note, accepted_line_ids));
});
