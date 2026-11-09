/** A route handler for one booking: everything it emits is kept with that booking. Server only. */
import type { NextRequest } from "next/server";
import { enforceRateLimit } from "@/lib/ai/rate-limit";
import { route, type RouteOptions } from "@/lib/http";
import { forBooking } from "./booking-events";
import { requireBooking } from "./bookings";
import { requireHost } from "./host-key";

export interface BookingRouteOptions extends RouteOptions {
  /** Needs the host's booking secret (host-key.ts). "unless-sample" lets anyone read a sample's. */
  host?: true | "unless-sample";
}

export function bookingRoute<Ctx extends { params: Promise<{ id: string }> }>(handler: (req: NextRequest, ctx: Ctx) => Promise<unknown> | unknown, opts?: BookingRouteOptions) {
  // A caller without the secret is turned away before it counts against the AI limit.
  const aiAfterHost = !!opts?.host && opts.rateLimit === "ai";
  return route<Ctx>(
    async (req, ctx) => {
      const { id } = await ctx.params;
      if (opts?.host) {
        const booking = requireBooking(id);
        if (!(opts.host === "unless-sample" && booking.sample)) await requireHost(booking);
      }
      if (aiAfterHost) enforceRateLimit(req, "ai");
      return forBooking(id, () => handler(req, ctx));
    },
    aiAfterHost ? { ...opts, rateLimit: "api" } : opts,
  );
}
