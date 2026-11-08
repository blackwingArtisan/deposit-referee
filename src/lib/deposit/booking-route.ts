/** A route handler for one booking: everything it emits is kept with that booking. Server only. */
import type { NextRequest } from "next/server";
import { route, type RouteOptions } from "@/lib/http";
import { forBooking } from "./booking-events";

export function bookingRoute<Ctx extends { params: Promise<{ id: string }> }>(handler: (req: NextRequest, ctx: Ctx) => Promise<unknown> | unknown, opts?: RouteOptions) {
  return route<Ctx>(async (req, ctx) => {
    const { id } = await ctx.params;
    return forBooking(id, () => handler(req, ctx));
  }, opts);
}
