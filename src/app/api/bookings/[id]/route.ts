import { requireBooking, viewBooking } from "@/lib/deposit/bookings";
import { bookingRoute } from "@/lib/deposit/booking-route";

export const GET = bookingRoute<RouteContext<"/api/bookings/[id]">>(async (_req, ctx) => viewBooking(requireBooking((await ctx.params).id)));
