import { requireBooking, viewBooking } from "@/lib/deposit/bookings";
import { bookingRoute } from "@/lib/deposit/booking-route";
import { requestEvidenceSubmission } from "@/lib/deposit/dispute";
import { getContext } from "@/lib/events/bus";

/** The host asks to send the evidence pack to PayPal. Waits at the Guard's approval gate. */
export const POST = bookingRoute<RouteContext<"/api/bookings/[id]/dispute/evidence">>(async (_req, ctx) => {
  const { id } = await ctx.params;
  requestEvidenceSubmission(id, getContext().channel);
  return viewBooking(requireBooking(id));
}, { host: true });
