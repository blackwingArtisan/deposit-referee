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
import { requireBooking, saveBooking } from "@/lib/deposit/bookings";
import { heldCents, partCapturedCents } from "@/lib/deposit/split-rules";
import { assertCaptureLimits, assertHoldOpen, centsToDollars, dollarsToCents, formatExactCents, HONOR_DAYS, itemizedCents, releasedCents, renterClearance, RuleError } from "@/lib/deposit/rules";
import { timeline } from "@/lib/events/bus";
import { moneyFromMinor } from "@/lib/money";
import type { PayPalApi } from "@/lib/paypal/api";
import { PayPalApiError } from "@/lib/paypal/errors";
import type { Authorization } from "@/lib/paypal/types";

export const CAPTURE_DEPOSIT = "capture_deposit";

/** Limits come first so they hold in every state. The hold is read from PayPal, not from our record. */
async function readCapturableHold(paypal: PayPalApi, bookingId: string, chargeCents: number) {
  const booking = requireBooking(bookingId);
  const { authorizationId, authorizedCents: recordedCents, proposal, settlement, renterState } = booking;
  if (!authorizationId || recordedCents === undefined) throw new RuleError("This booking has no hold.");
  const itemized = itemizedCents(proposal?.lines ?? []);
  // After the accepted items were charged on their own, only the contested part is left to charge.
  const part = partCapturedCents(booking);
  assertCaptureLimits(chargeCents, itemized, heldCents(booking));

  if (booking.status !== "awaiting_approval" || settlement?.requestedCents !== chargeCents) throw new RuleError("The host hasn't asked for this charge, so it can't be captured.");
  if (renterState?.response?.decision === "contested" && !settlement.contestHeard) throw new RuleError("The renter contested this charge. It's back with the host.");
  const clearance = renterClearance(renterState, chargeCents);
  if (!clearance.cleared) throw new RuleError(clearance.reason);

  const auth = await paypal.payments.getAuthorization(authorizationId);
  assertHoldOpen(auth.expiration_time);
  const open = part ? ["CREATED", "PARTIALLY_CAPTURED"] : ["CREATED"];
  if (!open.includes(auth.status)) throw new RuleError(`This hold is ${auth.status}, so no new charge can be taken from it.`);
  const authorizedCents = dollarsToCents(auth.amount.value) - part;
  assertCaptureLimits(chargeCents, itemized, authorizedCents);
  return { authorizationId, authorizedCents, auth, part, itemized };
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * PayPal guarantees a hold's funds for its first 3 days. After that a capture usually still
 * works but isn't promised, so the hold is refreshed first: a reauthorization of the same amount,
 * with a new id and a fresh 3 days. If PayPal refuses, the original hold is charged as before.
 */
export async function holdToCapture(paypal: PayPalApi, bookingId: string, auth: Authorization, now = Date.now()): Promise<string> {
  const booking = requireBooking(bookingId);
  if (booking.refreshedAuthorizationId) return booking.refreshedAuthorizationId;
  // Part of this hold is already captured, so it can't be reauthorized: charge the rest from it.
  if (booking.partCapture?.captureId) return auth.id;
  if (now - Date.parse(auth.create_time) <= HONOR_DAYS * DAY_MS) return auth.id;
  const amount = formatExactCents(dollarsToCents(auth.amount.value));
  try {
    const fresh = await paypal.payments.reauthorize(auth.id, { amount: auth.amount });
    saveBooking({ ...requireBooking(bookingId), refreshedAuthorizationId: fresh.id });
    timeline.emit({ kind: "info", status: "succeeded", title: "Hold refreshed", detail: `The hold was more than ${HONOR_DAYS} days old, so PayPal reauthorized ${amount} before the charge. Authorization ${fresh.id}.` });
    return fresh.id;
  } catch (e) {
    const reason = e instanceof PayPalApiError ? (e.issue ?? e.name) : (e as Error).message;
    timeline.emit({ kind: "info", status: "info", title: "Hold not refreshed", detail: `PayPal didn't reauthorize the hold (${reason}), so the charge comes from the original ${amount} hold.` });
    return auth.id;
  }
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
    const { authorizedCents, part, itemized } = await readCapturableHold(ctx.paypal, i.booking_id, i.amount_cents);
    const contested = requireBooking(i.booking_id).partCapture?.contestedCents;
    const released = releasedCents(authorizedCents, i.amount_cents);
    return {
      amount: moneyFromMinor(i.amount_cents),
      summary: part
        ? `Charge exactly ${formatExactCents(i.amount_cents)} of the contested ${formatExactCents(contested ?? itemized)} and release ${formatExactCents(released)} to the renter (${formatExactCents(part)} was already charged for the items they accepted)`
        : `Charge exactly ${formatExactCents(i.amount_cents)} from the ${formatExactCents(authorizedCents)} hold and release ${formatExactCents(released)} to the renter`,
    };
  },
  execute: async (i, ctx) => {
    // Checked again: time passes while the host decides.
    const { authorizedCents, auth } = await readCapturableHold(ctx.paypal, i.booking_id, i.amount_cents);
    const authorizationId = await holdToCapture(ctx.paypal, i.booking_id, auth);
    return captureAuthorization.execute(
      { authorization_id: authorizationId, amount: centsToDollars(i.amount_cents), currency_code: "USD", final_capture: i.amount_cents === authorizedCents },
      ctx,
    );
  },
});
