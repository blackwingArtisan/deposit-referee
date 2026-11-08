import { requireBooking, viewBooking } from "@/lib/deposit/bookings";
import { bookingRoute } from "@/lib/deposit/booking-route";
import { requestPartCapture } from "@/lib/deposit/split";
import { getContext } from "@/lib/events/bus";

/** The host asks again to charge the items the renter accepted, on their own. Waits at the approval gate. */
export const POST = bookingRoute<RouteContext<"/api/bookings/[id]/part-capture">>(async (_req, ctx) => {
  const { id } = await ctx.params;
  requestPartCapture(id, getContext().channel);
  return viewBooking(requireBooking(id));
});
