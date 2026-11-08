import { requireBooking, viewBooking } from "@/lib/deposit/bookings";
import { bookingRoute } from "@/lib/deposit/booking-route";
import { isHost } from "@/lib/deposit/host-key";
import type { BookingView } from "@/lib/deposit/types";

/** Anyone with the link can look. Only the host's browser gets the renter's link, the renter's only key. */
export const GET = bookingRoute<RouteContext<"/api/bookings/[id]">>(async (_req, ctx): Promise<BookingView> => {
  const booking = requireBooking((await ctx.params).id);
  const view = viewBooking(booking);
  if (await isHost(booking)) return { ...view, viewer: "host" };
  return { ...view, viewer: "visitor", renterToken: booking.sample ? view.renterToken : "" };
});
