import { z } from "zod";
import { forBooking } from "@/lib/deposit/booking-events";
import { requireBookingByToken } from "@/lib/deposit/bookings";
import { placeHold } from "@/lib/deposit/deposit";
import { renterView } from "@/lib/deposit/renter";
import { readJson, route } from "@/lib/http";

const Body = z.object({ orderId: z.string().min(5) });

/** The renter approved in PayPal: place the hold and show them it's held, not taken. */
export const POST = route<RouteContext<"/api/renter/[token]/deposit/authorize">>(async (req, ctx) => {
  const { token } = await ctx.params;
  const { orderId } = await readJson(req, Body);
  await forBooking(requireBookingByToken(token).id, () => placeHold(token, orderId));
  return renterView(token);
});
