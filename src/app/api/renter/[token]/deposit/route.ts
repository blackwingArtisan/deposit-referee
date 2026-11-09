import { forBooking } from "@/lib/deposit/booking-events";
import { requireBookingByToken } from "@/lib/deposit/bookings";
import { createDepositOrder } from "@/lib/deposit/deposit";
import { route } from "@/lib/http";

/** The renter starts their deposit: the PayPal order for the booking's amount. */
export const POST = route<RouteContext<"/api/renter/[token]/deposit">>(async (_req, ctx) => {
  const { token } = await ctx.params;
  return forBooking(requireBookingByToken(token).id, () => createDepositOrder(token));
});
