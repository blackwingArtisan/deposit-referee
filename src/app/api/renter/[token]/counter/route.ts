import { forBooking } from "@/lib/deposit/booking-events";
import { requireBookingByToken } from "@/lib/deposit/bookings";
import { acceptCounterAsRenter } from "@/lib/deposit/renter";
import { route } from "@/lib/http";

/** The renter accepts the counter the host sent. The charge then waits for the host's approval. */
export const POST = route<RouteContext<"/api/renter/[token]/counter">>(async (_req, ctx) => {
  const { token } = await ctx.params;
  return forBooking(requireBookingByToken(token).id, () => acceptCounterAsRenter(token));
});
