/**
 * Releases a whole deposit: voids the hold with nothing charged. After a split, it releases what is
 * left of the hold, and the charge for the accepted items stays. Behind the Guard's approval step
 * like a capture. It has no amount in impact() because no money changes hands, so it doesn't use
 * up the daily cap.
 */
import { z } from "zod";
import { defineTool } from "@/lib/agent/tool";
import { voidAuthorization } from "@/lib/agent/tools/extensions";
import { requireBooking } from "@/lib/deposit/bookings";
import { assertHoldOpen, dollarsToCents, formatExactCents, RuleError } from "@/lib/deposit/rules";
import { partCapturedCents } from "@/lib/deposit/split-rules";
import type { PayPalApi } from "@/lib/paypal/api";
import { readHold } from "@/lib/deposit/hold-read";

export const RELEASE_DEPOSIT = "release_deposit";

async function readOpenHold(paypal: PayPalApi, bookingId: string) {
  const booking = requireBooking(bookingId);
  if (!booking.authorizationId) throw new RuleError("This booking has no hold.");
  if (booking.status !== "awaiting_approval" || booking.settlement?.kind !== "release") throw new RuleError("The host hasn't asked for a release, so nothing was voided.");
  const auth = await readHold(paypal, booking.orderId, booking.authorizationId);
  assertHoldOpen(auth.expiration_time);
  const partCents = partCapturedCents(booking);
  const open = auth.status === "CREATED" || (partCents > 0 && auth.status === "PARTIALLY_CAPTURED");
  if (!open) throw new RuleError(`This hold is ${auth.status}, so it can't be released whole.`);
  return { authorizationId: booking.authorizationId, authorizedCents: dollarsToCents(auth.amount.value), partCents };
}

export const releaseDeposit = defineTool({
  name: RELEASE_DEPOSIT,
  description: "Release a whole deposit by voiding its PayPal hold. Nothing is charged.",
  risk: "money",
  schema: z.object({ booking_id: z.string().min(3), idempotency_key: z.string().optional() }),
  title: () => "Release the whole deposit",
  impact: async (i, ctx) => {
    const { authorizedCents, partCents } = await readOpenHold(ctx.paypal, i.booking_id);
    if (partCents) return { summary: `Release the remaining ${formatExactCents(authorizedCents - partCents)} of the hold to the renter. Nothing more is charged (${formatExactCents(partCents)} was already charged for the items they accepted).` };
    return { summary: `Release the whole ${formatExactCents(authorizedCents)} hold to the renter. Nothing is charged.` };
  },
  execute: async (i, ctx) => {
    const { authorizationId } = await readOpenHold(ctx.paypal, i.booking_id);
    return voidAuthorization.execute({ authorization_id: authorizationId, reason: "Deposit released: nothing charged" }, ctx);
  },
});
