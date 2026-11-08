import { bookingEvents } from "@/lib/deposit/booking-events";
import { requireBooking } from "@/lib/deposit/bookings";
import { route } from "@/lib/http";

/** Every timeline event kept for this booking, so its PayPal calls survive a reload. */
export const GET = route<RouteContext<"/api/bookings/[id]/activity">>(async (_req, ctx) => {
  const { id } = await ctx.params;
  requireBooking(id);
  return { events: bookingEvents(id) };
});
