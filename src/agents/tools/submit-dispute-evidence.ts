/**
 * Sends PayPal the booking's evidence pack for a dispute the renter opened. It can decide who keeps
 * the money, so it is a money tool and runs behind the Guard, which stops at the approval gate
 * before execute() is reached (requireApprovalFor in app.config.ts). No amount is reserved
 * against the daily cap, because nothing is paid out.
 */
import { z } from "zod";
import { defineTool } from "@/lib/agent/tool";
import { requireBooking } from "@/lib/deposit/bookings";
import { evidenceFile, evidenceNotes } from "@/lib/deposit/evidence";
import { dollarsToCents, formatExactCents, RuleError } from "@/lib/deposit/rules";
import type { PayPalApi } from "@/lib/paypal/api";

export const SUBMIT_EVIDENCE = "submit_dispute_evidence";

/** PayPal's own record of the dispute, checked before the card is shown and again before sending. */
async function readOpenDispute(paypal: PayPalApi, bookingId: string) {
  const booking = requireBooking(bookingId);
  const disputeId = booking.dispute?.disputeId;
  if (!disputeId) throw new RuleError("This booking has no PayPal dispute.");
  const dispute = await paypal.disputes.get(disputeId);
  if (dispute.status !== "WAITING_FOR_SELLER_RESPONSE") throw new RuleError(`PayPal shows this dispute as ${dispute.status.replace(/_/g, " ").toLowerCase()}, so it isn't asking for evidence now.`);
  const captures = [booking.settlement?.captureId, booking.partCapture?.captureId].filter(Boolean);
  if (!dispute.disputed_transactions.some((t) => captures.includes(t.seller_transaction_id))) throw new RuleError("This dispute is about a payment that isn't one of this booking's charges.");
  return { booking, dispute };
}

export const submitDisputeEvidence = defineTool({
  name: SUBMIT_EVIDENCE,
  description: "Send PayPal the booking's evidence pack (photos with findings boxed, price-table rows, the renter's answer and the PayPal ids) for a dispute the renter opened.",
  risk: "money",
  schema: z.object({ booking_id: z.string().min(3) }),
  title: () => "Send the evidence pack to PayPal",
  impact: async (i, ctx) => {
    const { dispute } = await readOpenDispute(ctx.paypal, i.booking_id);
    return {
      summary: `Send PayPal the evidence pack for case ${dispute.dispute_id}: the photos with each finding boxed, the price-table row for every item and the renter's own answer. PayPal then decides who keeps the disputed ${formatExactCents(dollarsToCents(dispute.dispute_amount.value))}`,
    };
  },
  execute: async (i, ctx) => {
    const { booking, dispute } = await readOpenDispute(ctx.paypal, i.booking_id);
    const file = evidenceFile(booking);
    await ctx.paypal.disputes.provideEvidence(dispute.dispute_id, { evidences: [{ evidence_type: "OTHER", notes: evidenceNotes(booking) }] }, [file]);
    return { dispute_id: dispute.dispute_id, file_name: file.name, bytes: file.data.byteLength };
  },
});
