import { requireBooking, saveBooking } from "@/lib/deposit/bookings";
import { HttpError } from "@/lib/http";
import { bookingRoute } from "@/lib/deposit/booking-route";
import { moneyFromMinor } from "@/lib/money";
import { getPayPal } from "@/lib/paypal";

/** Creates the PayPal order for the renter. The amount comes from the booking, never the browser. */
export const POST = bookingRoute<RouteContext<"/api/bookings/[id]/deposit">>(async (_req, ctx) => {
  const booking = requireBooking((await ctx.params).id);
  if (booking.status !== "draft") throw new HttpError(409, "This deposit has already been placed.", "conflict");
  const order = await getPayPal().orders.create({
    intent: "AUTHORIZE",
    purchase_units: [{ amount: moneyFromMinor(booking.depositCents), description: `Damage deposit: ${booking.item}`.slice(0, 127) }],
  });
  saveBooking({ ...booking, orderId: order.id });
  return { orderId: order.id };
});
