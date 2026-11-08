/**
 * The renter's side: see the proposal and evidence, accept it, or contest it before any capture.
 * A contest stops the capture and hands the decision back to the host with the renter's note.
 * This is inside the app only. It isn't a PayPal dispute.
 */
import { getApprovals } from "@/lib/agent/approvals";
import { HttpError } from "@/lib/http";
import { requireBookingByToken, saveBooking } from "./bookings";
import { itemizedCents, releasedCents } from "./rules";
import { requestPartCapture } from "./split";
import { heldCents, splitOf } from "./split-rules";
import type { Booking, RenterResponse, RenterView } from "./types";

const OPEN = ["proposed", "contested", "awaiting_approval"];

function chargeOf(booking: Booking): number {
  return booking.proposal ? itemizedCents(booking.proposal.lines) : 0;
}

function canRespond(booking: Booking): boolean {
  return OPEN.includes(booking.status) && chargeOf(booking) > 0 && booking.settlement?.kind !== "release";
}

export function renterView(token: string): RenterView {
  const booking = requireBookingByToken(token);
  const { proposal, review, renterState, settlement, status } = booking;
  const held = heldCents(booking);
  const chargeCents = chargeOf(booking);
  const split = splitOf(booking);
  const response = renterState?.response;
  return {
    item: booking.item,
    renter: booking.renter,
    depositCents: booking.depositCents,
    status,
    chargeCents,
    releaseCents: releasedCents(held, Math.min(chargeCents, held)),
    proposal: proposal ? { kind: proposal.kind, lines: proposal.lines, rationale: proposal.rationale, engine: proposal.engine, simulated: proposal.simulated, hostReason: proposal.hostReason } : null,
    confidence: review?.confidence ?? null,
    photos: booking.photos,
    renterState: renterState ?? null,
    canAccept: canRespond(booking) && !response,
    canContest: canRespond(booking) && response?.decision !== "contested",
    settled: status === "settled" && settlement?.capturedCents !== undefined && settlement.releasedCents !== undefined ? { capturedCents: settlement.capturedCents, releasedCents: settlement.releasedCents } : null,
    split: split ? { acceptedCents: split.acceptedCents, contestedCents: split.contestedCents, chargedCents: booking.partCapture?.capturedCents } : null,
  };
}

/** Records the renter's answer. A contest also turns down any approval the host has waiting. */
export function respondAsRenter(token: string, decision: RenterResponse["decision"], note?: string, acceptedLineIds?: string[]): RenterView {
  const booking = requireBookingByToken(token);
  if (!canRespond(booking)) throw new HttpError(409, "There's no proposed charge to answer on this booking.", "conflict");
  if (booking.renterState?.response?.decision === "contested") throw new HttpError(409, "You've already contested this charge. It's with the host.", "conflict");
  if (decision === "contested" && !note?.trim()) throw new HttpError(422, "Tell the host why you're contesting.", "rule");

  const lineIds = booking.proposal?.lines.map((line) => line.id) ?? [];
  const accepted = decision === "contested" ? [...new Set(acceptedLineIds ?? [])] : [];
  if (accepted.some((id) => !lineIds.includes(id))) throw new HttpError(422, "That item isn't on this charge.", "rule");
  if (accepted.length && accepted.length === lineIds.length) throw new HttpError(422, "You accepted every item. Press Accept instead.", "rule");

  const response: RenterResponse = { decision, note: note?.trim() || undefined, amountCents: chargeOf(booking), ...(accepted.length ? { acceptedLineIds: accepted } : {}), at: new Date().toISOString() };
  const waiting = booking.status === "awaiting_approval";
  saveBooking({ ...booking, renterState: { ...booking.renterState!, response }, status: decision === "contested" && !waiting ? "contested" : booking.status });

  if (decision === "contested" && waiting && booking.settlement) {
    for (const approval of getApprovals().list({ runId: booking.settlement.runId, state: "pending" })) getApprovals().decide(approval.id, "denied", "renter", response.note);
  }
  // The accepted items go to the approval gate at once; the contested ones wait for the host.
  if (accepted.length && !waiting) requestPartCapture(booking.id);
  return renterView(token);
}
