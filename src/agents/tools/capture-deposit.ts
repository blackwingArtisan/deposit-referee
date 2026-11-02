/**
 * Takes the host's exact approved charge out of a deposit hold. Runs behind the Guard, which
 * stops at the approval gate before execute() is reached (requireApprovalFor in app.config.ts).
 *
 * The settlement agent is not given this tool. Even so, the checks below run for any caller and
 * any amount: a capture above the itemized damage or the hold is refused before the Guard's
 * approval step, whatever was requested.
 */
import { z } from "zod";
import { defineTool } from "@/lib/agent/tool";
import { captureAuthorization } from "@/lib/agent/tools/extensions";
import { requireBooking } from "@/lib/deposit/bookings";
import { assertCaptureLimits, assertHoldOpen, centsToDollars, dollarsToCents, formatExactCents, itemizedCents, releasedCents, renterClearance, RuleError } from "@/lib/deposit/rules";
import { moneyFromMinor } from "@/lib/money";
import type { PayPalApi } from "@/lib/paypal/api";

export const CAPTURE_DEPOSIT = "capture_deposit";

/** Limits come first so they hold in every state. The hold is read from PayPal, not from our record. */
async function readCapturableHold(paypal: PayPalApi, bookingId: string, chargeCents: number) {
  const booking = requireBooking(bookingId);
  const { authorizationId, authorizedCents: recordedCents, proposal, settlement, renterState } = booking;
  if (!authorizationId || recordedCents === undefined) throw new RuleError("This booking has no hold.");
  const itemized = itemizedCents(proposal?.lines ?? []);
  assertCaptureLimits(chargeCents, itemized, recordedCents);

  if (booking.status !== "awaiting_approval" || settlement?.requestedCents !== chargeCents) throw new RuleError("The host hasn't asked for this charge, so it can't be captured.");
  if (renterState?.response?.decision === "contested" && !settlement.contestHeard) throw new RuleError("The renter contested this charge. It's back with the host.");
  const clearance = renterClearance(renterState, chargeCents);
  if (!clearance.cleared) throw new RuleError(clearance.reason);

  const auth = await paypal.payments.getAuthorization(authorizationId);
  assertHoldOpen(auth.expiration_time);
  if (auth.status !== "CREATED") throw new RuleError(`This hold is ${auth.status}, so no new charge can be taken from it.`);
  const authorizedCents = dollarsToCents(auth.amount.value);
  assertCaptureLimits(chargeCents, itemized, authorizedCents);
  return { authorizationId, authorizedCents };
}

export const captureDeposit = defineTool({
  name: CAPTURE_DEPOSIT,
  description: "Capture the host's exact approved charge from a deposit hold. Refuses an amount above the itemized damage or the hold, an expired or used hold, and a contested charge.",
  risk: "money",
  schema: z.object({
    booking_id: z.string().min(3),
    amount_cents: z.number().int().positive(),
    idempotency_key: z.string().optional().describe("Same key: never captured twice"),
  }),
  title: (i) => `Charge exactly ${formatExactCents(i.amount_cents)}`,
  impact: async (i, ctx) => {
    const { authorizedCents } = await readCapturableHold(ctx.paypal, i.booking_id, i.amount_cents);
    const released = releasedCents(authorizedCents, i.amount_cents);
    return {
      amount: moneyFromMinor(i.amount_cents),
      summary: `Charge exactly ${formatExactCents(i.amount_cents)} from the ${formatExactCents(authorizedCents)} hold and release ${formatExactCents(released)} to the renter`,
    };
  },
  execute: async (i, ctx) => {
    // Checked again: time passes while the host decides.
    const { authorizationId, authorizedCents } = await readCapturableHold(ctx.paypal, i.booking_id, i.amount_cents);
    return captureAuthorization.execute(
      { authorization_id: authorizationId, amount: centsToDollars(i.amount_cents), currency_code: "USD", final_capture: i.amount_cents === authorizedCents },
      ctx,
    );
  },
});
