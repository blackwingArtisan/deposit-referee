/**
 * The deposit hold, placed by the renter from their own page (/renter/[token]). The amount comes
 * from the booking, never the browser, and the hold is only recorded once PayPal returns it.
 * Server only.
 */
import { getPayPal } from "@/lib/paypal";
import { HttpError } from "@/lib/http";
import { moneyFromMinor } from "@/lib/money";
import { requireBookingByToken, saveBooking } from "./bookings";
import { dollarsToCents } from "./rules";
import type { Booking } from "./types";

function stillDraft(booking: Booking) {
  if (booking.status !== "draft") throw new HttpError(409, "This deposit has already been placed.", "conflict");
}

/**
 * Creates the PayPal order the renter approves. Its custom_id is the booking's id, so the order,
 * its capture and any dispute on it trace back to the booking from PayPal's side. The id only opens
 * a read-only view (no renter link, no actions), the same as sharing the booking's link.
 */
export async function createDepositOrder(token: string): Promise<{ orderId: string }> {
  const booking = requireBookingByToken(token);
  stillDraft(booking);
  const order = await getPayPal().orders.create({
    intent: "AUTHORIZE",
    purchase_units: [{ amount: moneyFromMinor(booking.depositCents), description: `Damage deposit: ${booking.item}`.slice(0, 127), custom_id: booking.id }],
  });
  saveBooking({ ...booking, orderId: order.id });
  return { orderId: order.id };
}

/** The renter approved the order: place the hold. Money is held, not taken. */
export async function placeHold(token: string, orderId: string): Promise<Booking> {
  const booking = requireBookingByToken(token);
  stillDraft(booking);
  if (booking.orderId !== orderId) throw new HttpError(409, "That PayPal order doesn't belong to this booking.", "conflict");
  const order = await getPayPal().orders.authorize(orderId);
  const auth = order.purchase_units?.[0]?.payments?.authorizations?.[0];
  if (!auth || auth.status !== "CREATED") throw new HttpError(402, `PayPal did not place the hold (status ${auth?.status ?? "missing"}).`, "hold_failed");
  const authorizedCents = dollarsToCents(auth.amount.value);
  if (authorizedCents !== booking.depositCents) throw new HttpError(409, "PayPal held a different amount from the booking's deposit.", "conflict");
  return saveBooking({ ...booking, status: "held", authorizationId: auth.id, authorizedCents, holdExpiresAt: auth.expiration_time, heldAt: new Date().toISOString() });
}
