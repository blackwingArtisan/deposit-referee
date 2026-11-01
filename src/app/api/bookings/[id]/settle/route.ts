import { z } from "zod";
import { viewBooking } from "@/lib/deposit/bookings";
import { requestSettlement } from "@/lib/deposit/settle";
import { getContext } from "@/lib/events/bus";
import { readJson, route } from "@/lib/http";

const Body = z.object({ chargeCents: z.number().int().positive() });

/** Sends the host's exact charge to the approval gate. No money moves until it is approved. */
export const POST = route<RouteContext<"/api/bookings/[id]/settle">>(async (req, ctx) => {
  const { chargeCents } = await readJson(req, Body);
  return viewBooking(requestSettlement((await ctx.params).id, chargeCents, getContext().channel).booking);
});
