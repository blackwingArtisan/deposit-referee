import { expect, vi } from "vitest";
import { runSettlementAgent } from "@/agents/settlement";
import { createBooking, requireBooking, saveBooking, viewBooking } from "@/lib/deposit/bookings";
import { DEMO_CLEAN_CHECK_OUT, DEMO_PHOTOS } from "@/lib/deposit/photos";
import { reviewPhotos } from "@/lib/deposit/review";
import { respondAsRenter } from "@/lib/deposit/renter";
import { getMockPayPal } from "@/lib/paypal";
import { moneyFromMinor } from "@/lib/money";

export const paypal = () => getMockPayPal()!;

/** A booking with a real mock hold and photos, not yet reviewed. */
export async function heldBooking(depositCents = 20_000, clean = false) {
  const booking = createBooking({ item: "Lakeside cabin, Door County", renter: "Test Renter", depositCents });
  const order = await paypal().orders.create({ intent: "AUTHORIZE", purchase_units: [{ amount: moneyFromMinor(depositCents) }] });
  await paypal().simulateBuyerApproval(order.id);
  const auth = (await paypal().orders.authorize(order.id)).purchase_units![0].payments!.authorizations![0];
  const photos = clean ? { ...DEMO_PHOTOS, check_out: DEMO_CLEAN_CHECK_OUT } : DEMO_PHOTOS;
  return saveBooking({ ...booking, status: "held", orderId: order.id, authorizationId: auth.id, authorizedCents: depositCents, holdExpiresAt: auth.expiration_time, photos });
}

/** Reviewed by the AI fixture, with the scripted settlement agent's proposal saved. */
export async function proposedBooking(depositCents = 20_000, clean = false) {
  const held = await heldBooking(depositCents, clean);
  saveBooking({ ...held, status: "reviewed", review: await reviewPhotos(held) });
  return runSettlementAgent(held.id, "test");
}

/** Proposed, and the renter has accepted, so the host can send it for approval. */
export async function acceptedBooking(depositCents = 20_000) {
  const booking = await proposedBooking(depositCents);
  respondAsRenter(booking.renterToken, "accepted");
  return requireBooking(booking.id);
}

export async function waitForApproval(bookingId: string) {
  await vi.waitFor(() => expect(viewBooking(requireBooking(bookingId)).approval).not.toBeNull());
  return viewBooking(requireBooking(bookingId)).approval!;
}

export const holdStatus = async (authorizationId?: string) => (await paypal().payments.getAuthorization(authorizationId!)).status;
