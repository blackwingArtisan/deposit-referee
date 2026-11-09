/** A route handler for one booking: everything it emits is kept with that booking. Server only. */
import type { NextRequest } from "next/server";
import { enforceRateLimit } from "@/lib/ai/rate-limit";
import { route, type RouteOptions } from "@/lib/http";
import { forBooking } from "./booking-events";
import { requireBooking } from "./bookings";
import { isHost, requireHost } from "./host-key";
import type { BookingView } from "./types";

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
      return withViewer(id, await forBooking(id, () => handler(req, ctx)));
    },
    aiAfterHost ? { ...opts, rateLimit: "api" } : opts,
  );
}

/**
 * A route that returns the booking says who is looking, as GET /api/bookings/[id] does, so the
 * browser keeps showing the host's controls after the host acts.
 */
async function withViewer(id: string, out: unknown): Promise<unknown> {
  if (!out || typeof out !== "object" || out instanceof Response) return out;
  const view = out as Partial<BookingView>;
  if (view.id !== id || !("status" in view) || view.viewer) return out;
  return { ...view, viewer: (await isHost(requireBooking(id))) ? "host" : "visitor" };
}
