import { viewBooking } from "@/lib/deposit/bookings";
import { bookingRoute } from "@/lib/deposit/booking-route";
import { refreshDispute } from "@/lib/deposit/dispute";

/** Reads the booking's dispute again from PayPal (get_dispute). */
export const POST = bookingRoute<RouteContext<"/api/bookings/[id]/dispute">>(async (_req, ctx) => {
  const { id } = await ctx.params;
  return viewBooking(await refreshDispute(id));
}, { host: true });
