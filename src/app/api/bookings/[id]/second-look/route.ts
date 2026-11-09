import { z } from "zod";
import { bookingRoute } from "@/lib/deposit/booking-route";
import { viewBooking } from "@/lib/deposit/bookings";
import { decideFlaggedLine } from "@/lib/deposit/second-look";
import { getContext } from "@/lib/events/bus";
import { readJson } from "@/lib/http";

const Body = z.object({ lineId: z.string().min(1), choice: z.enum(["keep", "drop"]) });

/** The host keeps or drops a line Claude's second look couldn't tell. Code sets the amount; nothing moves. */
export const POST = bookingRoute<RouteContext<"/api/bookings/[id]/second-look">>(async (req, ctx) => {
  const { lineId, choice } = await readJson(req, Body);
  return viewBooking(decideFlaggedLine((await ctx.params).id, lineId, choice, getContext().channel).booking);
}, { host: true });
