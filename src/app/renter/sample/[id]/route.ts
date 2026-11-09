import { findBooking } from "@/lib/deposit/bookings";

/**
 * A sample booking's renter view, by the booking's id, so a visitor can see what the renter sees
 * without the booking JSON ever carrying a renter's link. Real bookings get a 404 here: their
 * renter's link is only in the host's browser.
 */
export async function GET(_req: Request, ctx: RouteContext<"/renter/sample/[id]">) {
  const booking = findBooking((await ctx.params).id);
  if (!booking?.sample) return new Response("Not found", { status: 404 });
  return new Response(null, { status: 307, headers: { Location: `/renter/${booking.renterToken}`, "Cache-Control": "no-store" } });
}
