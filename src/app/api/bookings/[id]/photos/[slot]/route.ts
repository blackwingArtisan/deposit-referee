import { requireBooking } from "@/lib/deposit/bookings";
import { readPhoto } from "@/lib/deposit/photos";
import type { PhotoSlot } from "@/lib/deposit/types";
import { HttpError } from "@/lib/http";
import { bookingRoute } from "@/lib/deposit/booking-route";

/** Serves an uploaded photo: the host's, the renter's own (renter_check_in, renter_check_out), or the renter's photo for a contested line (evidence_<line id>). */
export const GET = bookingRoute<RouteContext<"/api/bookings/[id]/photos/[slot]">>(async (_req, ctx) => {
  const { id, slot } = await ctx.params;
  const booking = requireBooking(id);
  const photo = slot.startsWith("evidence_")
    ? booking.renterState?.response?.evidence?.[slot.slice("evidence_".length)]?.photo
    : slot.startsWith("renter_")
      ? booking.renterPhotos?.[slot.slice("renter_".length) as PhotoSlot]
      : booking.photos[slot as PhotoSlot];
  if (!photo) throw new HttpError(404, "No such photo.", "not_found");
  return new Response(new Uint8Array(readPhoto(photo)), { headers: { "Content-Type": photo.mediaType, "X-Content-Type-Options": "nosniff" } });
});
