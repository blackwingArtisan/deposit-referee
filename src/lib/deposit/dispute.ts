/**
 * A renter's PayPal dispute on one of the booking's charges. PayPal tells the app with a
 * CUSTOMER.DISPUTE.CREATED webhook (handlers.ts); the app finds the booking by the disputed
 * capture, reads the dispute back with get_dispute, and shows the host. The host can send the
 * evidence pack, through the Guard's approval gate. Server only.
 */
import { randomUUID } from "node:crypto";
import { appConfig } from "@/app.config";
import { submitDisputeEvidence } from "@/agents/tools/submit-dispute-evidence";
import { runTool } from "@/lib/agent/execute";
import { Guard } from "@/lib/agent/guard";
import { toolkitTools } from "@/lib/agent/tools";
import { getEnv } from "@/lib/env";
import { getContext, withContext } from "@/lib/events/bus";
import { HttpError } from "@/lib/http";
import { getPayPal } from "@/lib/paypal";
import type { Dispute } from "@/lib/paypal/types";
import { forBooking } from "./booking-events";
import { activeSettlements, allBookings, evidenceKey, requireBooking, saveBooking } from "./bookings";
import { evidenceFileName } from "./evidence";
import { canSendEvidence } from "./dispute-state";
import { dollarsToCents } from "./rules";
import { failureReason } from "./settle";
import type { Booking, BookingDispute } from "./types";

/** The booking whose charge a dispute is about, if it is one of this app's. */
export function bookingForDispute(dispute: Pick<Dispute, "disputed_transactions">): Booking | undefined {
  const ids = (dispute.disputed_transactions ?? []).map((t) => t.seller_transaction_id).filter(Boolean);
  return allBookings({ tests: true }).find((b) => [b.settlement?.captureId, b.partCapture?.captureId].some((id) => id && ids.includes(id)));
}

function fromPayPal(dispute: Dispute, booking: Booking): Omit<BookingDispute, "evidence"> {
  const captures = [booking.settlement?.captureId, booking.partCapture?.captureId];
  const captureId = dispute.disputed_transactions.find((t) => captures.includes(t.seller_transaction_id))?.seller_transaction_id ?? booking.settlement?.captureId ?? "";
  const buyer = (dispute.messages ?? []).filter((m) => m.posted_by === "BUYER").at(-1)?.content;
  return {
    disputeId: dispute.dispute_id,
    captureId,
    reason: dispute.reason,
    status: dispute.status,
    stage: dispute.dispute_life_cycle_stage,
    amountCents: dollarsToCents(dispute.dispute_amount.value),
    openedAt: dispute.create_time,
    responseDueAt: dispute.seller_response_due_date,
    buyerMessage: buyer,
    outcome: dispute.dispute_outcome?.outcome_code,
    readAt: new Date().toISOString(),
  };
}

/** The toolkit returns the dispute itself, or wrapped as { response } by some versions. */
function disputeFrom(output: unknown): Dispute {
  const raw = output && typeof output === "object" && "response" in output ? (output as { response: unknown }).response : output;
  const dispute = raw as Dispute | null;
  if (!dispute || typeof dispute !== "object" || !dispute.dispute_id || !dispute.dispute_amount) throw new Error("PayPal's get_dispute answer had no dispute in it.");
  return dispute;
}

/**
 * The settlement agent reads the dispute with the PayPal Agent Toolkit's get_dispute, through the
 * Guard like every tool (a read, so no approval), and keeps what PayPal says on the booking.
 */
async function readBack(bookingId: string, disputeId: string): Promise<Booking> {
  const [getDispute] = toolkitTools(["get_dispute"], getEnv().paypalMode === "sandbox" ? "sandbox" : "mock");
  const runId = `dispute_${randomUUID().slice(0, 12)}`;
  const ctx = { runId, actor: "settlement-agent", channel: getContext().channel, guard: new Guard({ paypal: getPayPal(), policy: appConfig.agentPolicy }) };
  const result = await forBooking(bookingId, () => withContext({ ...getContext(), runId, actor: "settlement-agent", bookingId }, () => runTool(getDispute, { dispute_id: disputeId }, ctx)));
  if (result.isError) throw new HttpError(502, `PayPal didn't return the dispute: ${failureReason(result)}`, "paypal_error");
  const dispute = disputeFrom(result.output);
  const now = requireBooking(bookingId);
  return saveBooking({ ...now, dispute: { ...now.dispute, ...fromPayPal(dispute, now) } });
}

/** From a webhook: files the dispute under its booking. Disputes on other payments are left alone. */
export async function recordDispute(resource: Dispute): Promise<Booking | undefined> {
  const booking = bookingForDispute(resource);
  if (!booking || !resource.dispute_id) return undefined;
  if (booking.dispute && booking.dispute.disputeId !== resource.dispute_id) return undefined; // one dispute per booking is shown
  return readBack(booking.id, resource.dispute_id);
}

/** list_disputes answers { items: [...] }, or wrapped as { response } by some toolkit versions. */
function disputeIdsFrom(output: unknown): string[] {
  const raw = output && typeof output === "object" && "response" in output ? (output as { response: unknown }).response : output;
  const items = raw && typeof raw === "object" && "items" in raw ? (raw as { items: unknown }).items : [];
  return Array.isArray(items) ? items.map((i) => (i && typeof i === "object" ? (i as { dispute_id?: unknown }).dispute_id : undefined)).filter((id): id is string => typeof id === "string" && !!id) : [];
}

/**
 * PayPal's CUSTOMER.DISPUTE.CREATED webhook can't reach an app on a laptop, and can be late. So the
 * host can ask PayPal directly: the settlement agent runs the toolkit's list_disputes for each of
 * the booking's captures, through the Guard (a read, so no approval), and files the first dispute
 * it finds just as the webhook would. With no dispute, the booking only notes when it looked.
 */
export async function checkForDispute(bookingId: string): Promise<Booking> {
  const booking = requireBooking(bookingId);
  if (booking.dispute) return readBack(bookingId, booking.dispute.disputeId);
  const captures = [booking.settlement?.captureId, booking.partCapture?.captureId].filter((id): id is string => !!id);
  if (!captures.length) throw new HttpError(409, "Nothing has been charged on this booking, so there is nothing to dispute.", "conflict");
  const [listDisputes] = toolkitTools(["list_disputes"], getEnv().paypalMode === "sandbox" ? "sandbox" : "mock");
  const runId = `dispute_check_${randomUUID().slice(0, 12)}`;
  const ctx = { runId, actor: "settlement-agent", channel: getContext().channel, guard: new Guard({ paypal: getPayPal(), policy: appConfig.agentPolicy }) };
  for (const captureId of captures) {
    const result = await forBooking(bookingId, () => withContext({ ...getContext(), runId, actor: "settlement-agent", bookingId }, () => runTool(listDisputes, { disputed_transaction_id: captureId, page_size: 5 }, ctx)));
    if (result.isError) throw new HttpError(502, `PayPal didn't list the disputes: ${failureReason(result)}`, "paypal_error");
    const [disputeId] = disputeIdsFrom(result.output);
    if (disputeId) return readBack(bookingId, disputeId);
  }
  return saveBooking({ ...requireBooking(bookingId), disputeCheckedAt: new Date().toISOString() });
}

/** The host asks for PayPal's latest word on the dispute. */
export async function refreshDispute(bookingId: string): Promise<Booking> {
  const booking = requireBooking(bookingId);
  if (!booking.dispute) throw new HttpError(404, "This booking has no PayPal dispute.", "not_found");
  return readBack(bookingId, booking.dispute.disputeId);
}

async function submit(id: string, channel: string, runId: string) {
  const ctx = { runId, actor: "host", channel, guard: new Guard({ paypal: getPayPal(), policy: appConfig.agentPolicy }) };
  const result = await runTool(submitDisputeEvidence, { booking_id: id }, ctx);
  if (result.isError) {
    const now = requireBooking(id);
    saveBooking({ ...now, dispute: { ...now.dispute!, evidence: { ...now.dispute!.evidence!, error: failureReason(result) } } });
    return;
  }
  // What the host sees next is PayPal's own status, read back before the pack is marked sent, so
  // the page (which stops asking once it is sent) never shows "sent" next to the old status.
  const { file_name, sent_as } = result.output as { file_name: string; sent_as: "evidence" | "message" };
  try {
    await readBack(id, requireBooking(id).dispute!.disputeId);
  } finally {
    const now = requireBooking(id);
    saveBooking({ ...now, dispute: { ...now.dispute!, evidence: { ...now.dispute!.evidence!, submittedAt: new Date().toISOString(), fileName: file_name, sentAs: sent_as, error: undefined } } });
  }
}

/** Sends the evidence pack to the approval gate. Resolves when it has finished. */
export function requestEvidenceSubmission(id: string, channel = getContext().channel): { booking: Booking; finished: Promise<void> } {
  const booking = requireBooking(id);
  const dispute = booking.dispute;
  if (!dispute) throw new HttpError(409, "This booking has no PayPal dispute.", "conflict");
  if (!canSendEvidence(dispute) && dispute.evidence?.submittedAt) throw new HttpError(409, "The evidence pack was already sent to PayPal.", "conflict");
  const key = evidenceKey(id);
  const active = activeSettlements();
  if (active.has(key)) throw new HttpError(409, "The evidence pack is already waiting for approval.", "conflict");
  if (dispute.status !== "WAITING_FOR_SELLER_RESPONSE") throw new HttpError(409, `PayPal shows this dispute as ${dispute.status.replace(/_/g, " ").toLowerCase()}, so it isn't asking for evidence now.`, "conflict");

  const runId = `evidence_${randomUUID().slice(0, 12)}`;
  const saved = saveBooking({ ...booking, dispute: { ...dispute, evidence: { runId, requestedAt: new Date().toISOString(), fileName: evidenceFileName(booking) } } });
  active.add(key);
  const finished = withContext({ channel, runId, actor: "host", bookingId: id }, () => submit(id, channel, runId))
    .catch((e) => {
      const now = requireBooking(id);
      saveBooking({ ...now, dispute: { ...now.dispute!, evidence: { ...now.dispute!.evidence!, error: e instanceof Error ? e.message : String(e) } } });
    })
    .finally(() => active.delete(key));
  return { booking: saved, finished };
}
