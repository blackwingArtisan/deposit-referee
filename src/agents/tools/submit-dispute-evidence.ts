/**
 * Sends PayPal the booking's evidence pack for a dispute the renter opened. It can decide who keeps
 * the money, so it is a money tool and runs behind the Guard, which stops at the approval gate
 * before execute() is reached (requireApprovalFor in app.config.ts). No amount is reserved
 * against the daily cap, because nothing is paid out.
 *
 * PayPal takes the pack two ways, and code picks from PayPal's own links on the dispute: while the
 * case is an inquiry (its first stage) only a message can be sent, so the pack goes attached to a
 * message on the case; once it is a claim, PayPal offers provide-evidence and the pack is filed as
 * evidence.
 */
import { z } from "zod";
import { defineTool } from "@/lib/agent/tool";
import { requireBooking } from "@/lib/deposit/bookings";
import { evidenceFile, evidenceNotes } from "@/lib/deposit/evidence";
import { dollarsToCents, formatExactCents, RuleError } from "@/lib/deposit/rules";
import type { PayPalApi } from "@/lib/paypal/api";
import type { Dispute } from "@/lib/paypal/types";

export const SUBMIT_EVIDENCE = "submit_dispute_evidence";

/** How PayPal will take the pack now: formal evidence on a claim, or attached to a message on an inquiry. */
export function evidenceRoute(dispute: Pick<Dispute, "links" | "dispute_life_cycle_stage">): "evidence" | "message" {
  const rels = new Set((dispute.links ?? []).map((l) => l.rel));
  if (rels.has("provide_evidence")) return "evidence";
  if (rels.has("send_message")) return "message";
  return dispute.dispute_life_cycle_stage === "INQUIRY" ? "message" : "evidence";
}

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
    const amount = formatExactCents(dollarsToCents(dispute.dispute_amount.value));
    const pack = "the photos with each finding boxed, the price-table row for every item and the renter's own answer";
    return {
      summary:
        evidenceRoute(dispute) === "message"
          ? `Send PayPal the evidence pack for case ${dispute.dispute_id}, attached to a message to the renter: ${pack}. The case is still an inquiry, where PayPal takes messages, not evidence; if the renter escalates it to a claim, you can send the pack again as evidence and PayPal decides who keeps the disputed ${amount}`
          : `Send PayPal the evidence pack for case ${dispute.dispute_id}: ${pack}. PayPal then decides who keeps the disputed ${amount}`,
    };
  },
  execute: async (i, ctx) => {
    const { booking, dispute } = await readOpenDispute(ctx.paypal, i.booking_id);
    const file = evidenceFile(booking);
    const sentAs = evidenceRoute(dispute);
    if (sentAs === "message") await ctx.paypal.disputes.sendMessage(dispute.dispute_id, evidenceNotes(booking), file);
    else await ctx.paypal.disputes.provideEvidence(dispute.dispute_id, { evidences: [{ evidence_type: "OTHER", notes: evidenceNotes(booking) }] }, [file]);
    return { dispute_id: dispute.dispute_id, file_name: file.name, bytes: file.data.byteLength, sent_as: sentAs };
  },
});
