import { requireBooking } from "@/lib/deposit/bookings";
import { readPhoto } from "@/lib/deposit/photos";
import type { PhotoSlot } from "@/lib/deposit/types";
import { HttpError, route } from "@/lib/http";

/** Serves a host's uploaded photo. */
export const GET = route<RouteContext<"/api/bookings/[id]/photos/[slot]">>(async (_req, ctx) => {
  const { id, slot } = await ctx.params;
  const photo = requireBooking(id).photos[slot as PhotoSlot];
  if (!photo) throw new HttpError(404, "No such photo.", "not_found");
  return new Response(new Uint8Array(readPhoto(photo)), { headers: { "Content-Type": photo.mediaType, "X-Content-Type-Options": "nosniff" } });
});
