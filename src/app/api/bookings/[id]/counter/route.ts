import { bookingRoute } from "@/lib/deposit/booking-route";
import { viewBooking } from "@/lib/deposit/bookings";
import { sendCounter } from "@/lib/deposit/second-look";

/** The host sends the counter agent's counter-offer to the renter. Nothing moves. */
export const POST = bookingRoute<RouteContext<"/api/bookings/[id]/counter">>(async (_req, ctx) => viewBooking(sendCounter((await ctx.params).id)), { host: true });
