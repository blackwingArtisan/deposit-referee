import { z } from "zod";
import { requireBooking, viewBooking } from "@/lib/deposit/bookings";
import { forBooking } from "@/lib/deposit/booking-events";
import { HttpError, readJson, route } from "@/lib/http";
import { getMockPayPal } from "@/lib/paypal";

/**
 * Mock mode only: the renter opens a PayPal dispute on the booking's charge, as a buyer does from
 * their PayPal account. PayPal then sends CUSTOMER.DISPUTE.CREATED, which the app's handler files.
 */
export const POST = route<RouteContext<"/api/dev/mock/dispute/[id]">>(
  async (req, ctx) => {
    const b = await readJson(req, z.object({ message: z.string().max(500).optional(), capture: z.enum(["charge", "accepted"]).optional() }));
    const { id } = await ctx.params;
    const booking = requireBooking(id);
    const captureId = b.capture === "accepted" ? booking.partCapture?.captureId : (booking.settlement?.captureId ?? booking.partCapture?.captureId);
    if (!captureId) throw new HttpError(409, "Nothing has been charged on this booking, so there is nothing to dispute.", "conflict");
    const mock = getMockPayPal()!;
    await forBooking(id, () => mock.simulateDispute({ captureId, reason: "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED", buyerMessage: b.message }));
    await mock.flushWebhooks();
    return viewBooking(requireBooking(id));
  },
  { mockOnly: true },
);
