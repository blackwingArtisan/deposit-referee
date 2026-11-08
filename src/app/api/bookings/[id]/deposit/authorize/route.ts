import { z } from "zod";
import { requireBooking, saveBooking, viewBooking } from "@/lib/deposit/bookings";
import { dollarsToCents } from "@/lib/deposit/rules";
import { HttpError, readJson } from "@/lib/http";
import { bookingRoute } from "@/lib/deposit/booking-route";
import { getPayPal } from "@/lib/paypal";

const Body = z.object({ orderId: z.string().min(5) });

/** The renter approved: place the hold. Money is held, not taken. */
export const POST = bookingRoute<RouteContext<"/api/bookings/[id]/deposit/authorize">>(async (req, ctx) => {
  const booking = requireBooking((await ctx.params).id);
  const { orderId } = await readJson(req, Body);
  if (booking.status !== "draft") throw new HttpError(409, "This deposit has already been placed.", "conflict");
  if (booking.orderId !== orderId) throw new HttpError(409, "That PayPal order doesn't belong to this booking.", "conflict");

  const order = await getPayPal().orders.authorize(orderId);
  const auth = order.purchase_units?.[0]?.payments?.authorizations?.[0];
  if (!auth || auth.status !== "CREATED") throw new HttpError(402, `PayPal did not place the hold (status ${auth?.status ?? "missing"}).`, "hold_failed");
  const authorizedCents = dollarsToCents(auth.amount.value);
  if (authorizedCents !== booking.depositCents) throw new HttpError(409, "PayPal held a different amount from the booking's deposit.", "conflict");

  return viewBooking(saveBooking({ ...booking, status: "held", authorizationId: auth.id, authorizedCents, holdExpiresAt: auth.expiration_time }));
});
