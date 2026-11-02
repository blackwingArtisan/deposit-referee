/**
 * Releases a whole deposit: voids the hold with nothing charged. Behind the Guard's approval step
 * like a capture. It has no amount in impact() because no money changes hands, so it doesn't use
 * up the daily cap.
 */
import { z } from "zod";
import { defineTool } from "@/lib/agent/tool";
import { voidAuthorization } from "@/lib/agent/tools/extensions";
import { requireBooking } from "@/lib/deposit/bookings";
import { assertHoldOpen, dollarsToCents, formatExactCents, RuleError } from "@/lib/deposit/rules";
import type { PayPalApi } from "@/lib/paypal/api";

export const RELEASE_DEPOSIT = "release_deposit";

async function readOpenHold(paypal: PayPalApi, bookingId: string) {
  const booking = requireBooking(bookingId);
  if (!booking.authorizationId) throw new RuleError("This booking has no hold.");
  if (booking.status !== "awaiting_approval" || booking.settlement?.kind !== "release") throw new RuleError("The host hasn't asked for a release, so nothing was voided.");
  const auth = await paypal.payments.getAuthorization(booking.authorizationId);
  assertHoldOpen(auth.expiration_time);
  if (auth.status !== "CREATED") throw new RuleError(`This hold is ${auth.status}, so it can't be released whole.`);
  return { authorizationId: booking.authorizationId, authorizedCents: dollarsToCents(auth.amount.value) };
}

export const releaseDeposit = defineTool({
  name: RELEASE_DEPOSIT,
  description: "Release a whole deposit by voiding its PayPal hold. Nothing is charged.",
  risk: "money",
  schema: z.object({ booking_id: z.string().min(3), idempotency_key: z.string().optional() }),
  title: () => "Release the whole deposit",
  impact: async (i, ctx) => {
    const { authorizedCents } = await readOpenHold(ctx.paypal, i.booking_id);
    return { summary: `Release the whole ${formatExactCents(authorizedCents)} hold to the renter. Nothing is charged.` };
  },
  execute: async (i, ctx) => {
    const { authorizationId } = await readOpenHold(ctx.paypal, i.booking_id);
    return voidAuthorization.execute({ authorization_id: authorizationId, reason: "Deposit released: nothing charged" }, ctx);
  },
});
