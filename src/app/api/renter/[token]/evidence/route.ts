import { requireBookingByToken } from "@/lib/deposit/bookings";
import { evidenceFileName, evidencePdf } from "@/lib/deposit/evidence";
import { HttpError, route } from "@/lib/http";

/** The same evidence pack the host keeps, for the renter once the deposit is settled with a charge. */
export const GET = route<RouteContext<"/api/renter/[token]/evidence">>(async (_req, ctx) => {
  const booking = requireBookingByToken((await ctx.params).token);
  if (booking.status !== "settled") throw new HttpError(409, "The ruling is ready once the deposit is settled.", "conflict");
  return new Response(new Uint8Array(evidencePdf(booking)), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${evidenceFileName(booking)}"`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
});
