import { runSettlementAgent } from "@/agents/settlement";
import { requireBooking, saveBooking, viewBooking } from "@/lib/deposit/bookings";
import { reviewPhotos } from "@/lib/deposit/review";
import { getContext } from "@/lib/events/bus";
import { HttpError, route } from "@/lib/http";

/** One AI review per booking. The settlement agent then reads it and stops with a proposal. */
export const POST = route<RouteContext<"/api/bookings/[id]/review">>(
  async (_req, ctx) => {
    const booking = requireBooking((await ctx.params).id);
    if (booking.status !== "held") throw new HttpError(409, "This booking isn't ready for a review.", "conflict");
    if (!booking.photos.check_in || !booking.photos.check_out) throw new HttpError(422, "Add both photos first.", "photos_missing");
    const review = await reviewPhotos(booking);
    saveBooking({ ...requireBooking(booking.id), status: "reviewed", review });
    return viewBooking(await runSettlementAgent(booking.id, getContext().channel));
  },
  { rateLimit: "ai" },
);
