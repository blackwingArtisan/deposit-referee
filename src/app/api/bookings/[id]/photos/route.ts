import { z } from "zod";
import { requireBooking, saveBooking, viewBooking } from "@/lib/deposit/bookings";
import { DEMO_CLEAN_CHECK_OUT, DEMO_FAINT_CHECK_OUT, DEMO_PHOTOS, DEMO_TWO_MARKS_CHECK_OUT, saveUpload } from "@/lib/deposit/photos";
import { photoChangeBlocked } from "@/lib/deposit/rules";
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
  /** The demo check-out photo with two marks, for a renter who accepts one and contests the other. */
  two: z.boolean().optional(),
});

export const POST = bookingRoute<RouteContext<"/api/bookings/[id]/photos">>(async (req, ctx) => {
  const booking = requireBooking((await ctx.params).id);
  const { slot, dataUrl, clean, faint, two } = await readJson(req, Body);
  const blocked = photoChangeBlocked(booking);
  if (blocked) throw new HttpError(409, blocked, "conflict");
  const demoCheckOut = slot !== "check_out" ? undefined : clean ? DEMO_CLEAN_CHECK_OUT : faint ? DEMO_FAINT_CHECK_OUT : two ? DEMO_TWO_MARKS_CHECK_OUT : undefined;
  const photo = dataUrl ? saveUpload(booking.id, slot, dataUrl) : (demoCheckOut ?? DEMO_PHOTOS[slot]);
  // A new photo means a new comparison: the old review, proposal and renter window go.
  const fresh = booking.status === "held" ? booking : { ...booking, status: "held" as const, review: undefined, proposal: undefined, renterState: undefined, agentError: undefined, settlement: undefined };
  return viewBooking(saveBooking({ ...fresh, photos: { ...fresh.photos, [slot]: photo } }));
});
