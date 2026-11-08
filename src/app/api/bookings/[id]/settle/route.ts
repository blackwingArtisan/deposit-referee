import { z } from "zod";
import { viewBooking } from "@/lib/deposit/bookings";
import { requestRelease, requestSettlement } from "@/lib/deposit/settle";
import { getContext } from "@/lib/events/bus";
import { readJson } from "@/lib/http";
import { bookingRoute } from "@/lib/deposit/booking-route";

const Body = z.union([z.object({ chargeCents: z.number().int().positive() }), z.object({ release: z.literal(true) })]);

/** Sends the host's decision to the approval gate. No money moves until it is approved. */
export const POST = bookingRoute<RouteContext<"/api/bookings/[id]/settle">>(async (req, ctx) => {
  const body = await readJson(req, Body);
  const { id } = await ctx.params;
  const { channel } = getContext();
  return viewBooking(("release" in body ? requestRelease(id, channel) : requestSettlement(id, body.chargeCents, channel)).booking);
}, { host: true });
