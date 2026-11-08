import { requireBooking } from "@/lib/deposit/bookings";
import { bookingRoute } from "@/lib/deposit/booking-route";
import { evidenceFileName, evidencePdf } from "@/lib/deposit/evidence";

/** The evidence pack as a PDF the host can keep: photos with findings boxed, price rows, the renter's answer, PayPal ids. */
export const GET = bookingRoute<RouteContext<"/api/bookings/[id]/evidence">>(async (_req, ctx) => {
  const { id } = await ctx.params;
  const booking = requireBooking(id);
  return new Response(new Uint8Array(evidencePdf(booking)), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${evidenceFileName(booking)}"`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
});
