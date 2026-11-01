import { requireBooking, viewBooking } from "@/lib/deposit/bookings";
import { route } from "@/lib/http";

export const GET = route<RouteContext<"/api/bookings/[id]">>(async (_req, ctx) => viewBooking(requireBooking((await ctx.params).id)));
