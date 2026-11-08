import { z } from "zod";
import { requireBooking, saveBooking, viewBooking } from "@/lib/deposit/bookings";
import { DEMO_CLEAN_CHECK_OUT, DEMO_FAINT_CHECK_OUT, DEMO_PHOTOS, saveUpload } from "@/lib/deposit/photos";
import { HttpError, readJson } from "@/lib/http";
import { bookingRoute } from "@/lib/deposit/booking-route";

const Body = z.object({
  slot: z.enum(["check_in", "check_out"]),
  /** A browser data: URL. Leave it out to use the demo photo for this slot. */
  dataUrl: z.string().optional(),
  /** The demo check-out photo with no new damage. */
  clean: z.boolean().optional(),
  /** The demo check-out photo with a faint mark, for a worth-a-look item. */
  faint: z.boolean().optional(),
});

export const POST = bookingRoute<RouteContext<"/api/bookings/[id]/photos">>(async (req, ctx) => {
  const booking = requireBooking((await ctx.params).id);
  const { slot, dataUrl, clean, faint } = await readJson(req, Body);
  if (booking.status !== "held") throw new HttpError(409, "Photos can only be added after the deposit is on hold and before the AI review.", "conflict");
  const demoCheckOut = slot !== "check_out" ? undefined : clean ? DEMO_CLEAN_CHECK_OUT : faint ? DEMO_FAINT_CHECK_OUT : undefined;
  const photo = dataUrl ? saveUpload(booking.id, slot, dataUrl) : (demoCheckOut ?? DEMO_PHOTOS[slot]);
  return viewBooking(saveBooking({ ...booking, photos: { ...booking.photos, [slot]: photo } }));
});
