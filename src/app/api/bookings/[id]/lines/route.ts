import { z } from "zod";
import { viewBooking } from "@/lib/deposit/bookings";
import { saveHostLines } from "@/lib/deposit/proposal";
import { readJson } from "@/lib/http";
import { bookingRoute } from "@/lib/deposit/booking-route";

const Body = z.object({
  lines: z.array(z.object({ id: z.string(), amountCents: z.number().int().nonnegative() })).max(50),
  add: z.object({ description: z.string().trim().min(3).max(200), amountCents: z.number().int().positive() }).optional(),
  addLook: z.number().int().nonnegative().optional(),
  reason: z.string().trim().max(160).optional(),
});

/** The host's own numbers. The hold is still the ceiling, and a raise goes back to the renter. */
export const POST = bookingRoute<RouteContext<"/api/bookings/[id]/lines">>(async (req, ctx) => viewBooking(saveHostLines((await ctx.params).id, await readJson(req, Body))));
