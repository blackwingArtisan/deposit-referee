/**
 * Charges the items the renter accepted, at once, while the ones they contested stay on hold.
 * Runs behind the Guard, which stops at the approval gate before execute() is reached
 * (requireApprovalFor in app.config.ts). The capture is never final (final_capture false), so the
 * same hold can still be charged for the contested part once a person has settled it.
 */
import { z } from "zod";
import { defineTool } from "@/lib/agent/tool";
import { captureAuthorization } from "@/lib/agent/tools/extensions";
import { requireBooking } from "@/lib/deposit/bookings";
import { assertCaptureLimits, assertHoldOpen, centsToDollars, dollarsToCents, formatExactCents, RuleError } from "@/lib/deposit/rules";
import { splitOf } from "@/lib/deposit/split-rules";
import { moneyFromMinor } from "@/lib/money";
import type { PayPalApi } from "@/lib/paypal/api";
import { holdToCapture } from "./capture-deposit";

export const CAPTURE_ACCEPTED = "capture_accepted_items";

async function readAcceptedPart(paypal: PayPalApi, bookingId: string, chargeCents: number) {
  const booking = requireBooking(bookingId);
  const { authorizationId, authorizedCents, partCapture } = booking;
  if (!authorizationId || authorizedCents === undefined) throw new RuleError("This booking has no hold.");
  const split = splitOf(booking);
  if (!split) throw new RuleError("The renter didn't accept part of this charge, so there's nothing to charge on its own.");
  assertCaptureLimits(chargeCents, split.acceptedCents, authorizedCents);
  if (booking.status !== "awaiting_approval" || !partCapture || partCapture.requestedCents !== chargeCents || partCapture.captureId) throw new RuleError("Nobody has asked for this charge, so it can't be captured.");

  const auth = await paypal.payments.getAuthorization(authorizationId);
  assertHoldOpen(auth.expiration_time);
  if (auth.status !== "CREATED") throw new RuleError(`This hold is ${auth.status}, so the accepted items can't be charged from it.`);
  assertCaptureLimits(chargeCents, split.acceptedCents, dollarsToCents(auth.amount.value));
  return { auth, split, authorizedCents: dollarsToCents(auth.amount.value) };
}

export const captureAcceptedItems = defineTool({
  name: CAPTURE_ACCEPTED,
  description: "Capture only the items the renter accepted from a deposit hold, never final, so the contested part stays on the hold for the host to settle.",
  risk: "money",
  schema: z.object({
    booking_id: z.string().min(3),
    amount_cents: z.number().int().positive(),
    idempotency_key: z.string().optional().describe("Same key: never captured twice"),
  }),
  title: (i) => `Charge the accepted ${formatExactCents(i.amount_cents)} now`,
  impact: async (i, ctx) => {
    const { split, authorizedCents } = await readAcceptedPart(ctx.paypal, i.booking_id, i.amount_cents);
    return {
      amount: moneyFromMinor(i.amount_cents),
      summary: `Charge exactly ${formatExactCents(i.amount_cents)} now for the items the renter accepted. The ${formatExactCents(split.contestedCents)} they contested stays on the ${formatExactCents(authorizedCents)} hold until you settle it`,
    };
  },
  execute: async (i, ctx) => {
    const { auth } = await readAcceptedPart(ctx.paypal, i.booking_id, i.amount_cents);
    const authorizationId = await holdToCapture(ctx.paypal, i.booking_id, auth);
    return captureAuthorization.execute({ authorization_id: authorizationId, amount: centsToDollars(i.amount_cents), currency_code: "USD", final_capture: false }, ctx);
  },
});
