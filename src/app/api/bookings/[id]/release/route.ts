import { viewBooking } from "@/lib/deposit/bookings";
import { retryRelease } from "@/lib/deposit/settle";
import { getContext } from "@/lib/events/bus";
import { bookingRoute } from "@/lib/deposit/booking-route";

/** Retries releasing the hold after the charge went through but the release failed. */
export const POST = bookingRoute<RouteContext<"/api/bookings/[id]/release">>(async (_req, ctx) =>
  viewBooking(retryRelease((await ctx.params).id, getContext().channel).booking),
  { host: true },
);
