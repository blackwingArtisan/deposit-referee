import { viewBooking } from "@/lib/deposit/bookings";
import { bookingRoute } from "@/lib/deposit/booking-route";
import { checkForDispute } from "@/lib/deposit/dispute";

/** Asks PayPal (list_disputes) whether the renter disputed a charge the webhook hasn't told us about. */
export const POST = bookingRoute<RouteContext<"/api/bookings/[id]/dispute/check">>(async (_req, ctx) => {
  const { id } = await ctx.params;
  return viewBooking(await checkForDispute(id));
}, { host: true });
