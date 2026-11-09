import { requireBooking, saveBooking } from "@/lib/deposit/bookings";
import { bookingRoute } from "@/lib/deposit/booking-route";
import { addHostLink } from "@/lib/deposit/host-key";

/** A one-time link that opens this booking as the host on another device. Only the host can make one. */
export const POST = bookingRoute<RouteContext<"/api/bookings/[id]/host-link">>(
  async (_req, ctx) => {
    const { booking, code, expiresAt } = addHostLink(requireBooking((await ctx.params).id));
    saveBooking(booking);
    return { path: `/host-link/${code}`, expiresAt };
  },
  { host: true },
);
