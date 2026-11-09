/**
 * The renter's side: see the proposal and evidence, accept it, or contest it before any capture.
 * A contest stops the capture and hands the decision back to the host with the renter's note.
 * This is inside the app only. It isn't a PayPal dispute.
 */
import { getApprovals } from "@/lib/agent/approvals";
import { getContext } from "@/lib/events/bus";
import { HttpError } from "@/lib/http";
import { requireBookingByToken, saveBooking } from "./bookings";
import { DEMO_RENTER_CHECK_IN, saveEvidence, saveUpload } from "./photos";
import { acceptCounter, startSecondLook } from "./second-look";
import { contestedLines } from "./second-look-rules";
import { itemizedCents, releasedCents } from "./rules";
import { requestPartCapture } from "./split";
import { heldCents, splitOf } from "./split-rules";
import type { Booking, PhotoSlot, RenterResponse, RenterView, RulingView, SecondLook } from "./types";

const OPEN = ["proposed", "contested", "awaiting_approval"];

function chargeOf(booking: Booking): number {
  return booking.proposal ? itemizedCents(booking.proposal.lines) : 0;
}

/** The renter's own photos count only if the comparison can weigh them, so they close when it runs. */
const canAddPhotos = (booking: Booking) => booking.status === "held";

function canRespond(booking: Booking): boolean {
  return OPEN.includes(booking.status) && chargeOf(booking) > 0 && booking.settlement?.kind !== "release";
}

/**
 * What the renter sees of the second look: that it's running, then nothing until the host sends
 * the counter, then the counter itself.
 */
function renterSecondLook(look: SecondLook | undefined): RenterView["secondLook"] {
  if (!look) return null;
  if (look.status === "running") return { status: "running", canAccept: false };
  if (look.status === "sent" || look.status === "accepted") return { status: look.status, lines: look.lines, rationale: look.counter?.rationale, canAccept: look.status === "sent" };
  return { status: "with_host", canAccept: false };
}

/** The settled result, as both sides see it. */
function rulingOf(booking: Booking): RulingView | null {
  if (booking.status !== "settled" || booking.settlement?.capturedCents === undefined) return null;
  const { renter, item, status, authorizedCents, settlement, partCapture, proposal, review, photos, renterPhotos, orderId, authorizationId, secondLook } = booking;
  return { renter, item, status, authorizedCents, settlement, partCapture, proposal, review, photos, renterPhotos, orderId, authorizationId, secondLook };
}

/** Notes the first time the renter opens their page with the proposal on it, for the host's conversation rail. */
export function markRenterOpened(token: string): void {
  const booking = requireBookingByToken(token);
  if (booking.proposal && booking.renterState && !booking.renterState.openedAt && OPEN.includes(booking.status)) {
    saveBooking({ ...booking, renterState: { ...booking.renterState, openedAt: new Date().toISOString() } });
  }
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
    hold: booking.authorizationId && booking.authorizedCents !== undefined ? { authorizedCents: booking.authorizedCents, expiresAt: booking.holdExpiresAt } : null,
    chargeCents,
    releaseCents: releasedCents(held, Math.min(chargeCents, held)),
    proposal: proposal ? { kind: proposal.kind, lines: proposal.lines, rationale: proposal.rationale, engine: proposal.engine, simulated: proposal.simulated, hostReason: proposal.hostReason } : null,
    confidence: review?.confidence ?? null,
    photos: booking.photos,
    renterPhotos: booking.renterPhotos ?? {},
    canAddPhotos: canAddPhotos(booking),
    renterState: renterState ?? null,
    canAccept: canRespond(booking) && !response,
    canContest: canRespond(booking) && response?.decision !== "contested",
    settled: status === "settled" && settlement?.capturedCents !== undefined && settlement.releasedCents !== undefined ? { capturedCents: settlement.capturedCents, releasedCents: settlement.releasedCents } : null,
    split: split ? { acceptedCents: split.acceptedCents, contestedCents: split.contestedCents, chargedCents: booking.partCapture?.capturedCents } : null,
    secondLook: renterSecondLook(booking.secondLook),
    ruling: rulingOf(booking),
  };
}

/** Adds or replaces the renter's own check-in or check-out photo. No dataUrl: the demo close-up at check-in. */
export function addRenterPhoto(token: string, slot: PhotoSlot, dataUrl?: string): RenterView {
  const booking = requireBookingByToken(token);
  if (!canAddPhotos(booking)) {
    throw new HttpError(409, booking.status === "draft" ? "You can add photos once the deposit is on hold." : "The host has already compared the photos, so new ones can't be added. If you disagree with a charge, say so in your note.", "conflict");
  }
  const photo = dataUrl ? saveUpload(booking.id, slot, dataUrl, "renter") : slot === "check_in" ? DEMO_RENTER_CHECK_IN : undefined;
  if (!photo) throw new HttpError(400, "Choose a photo to upload.", "invalid_photo");
  saveBooking({ ...booking, renterPhotos: { ...booking.renterPhotos, [slot]: photo } });
  return renterView(token);
}

/**
 * Records the renter's answer. A contest also turns down any approval the host has waiting, and
 * starts Claude's second look at the contested lines with the renter's note and photos.
 * `evidence` is the renter's own photo (a data: URL) for a contested line, by line id.
 */
export function respondAsRenter(token: string, decision: RenterResponse["decision"], note?: string, acceptedLineIds?: string[], evidence: Record<string, string> = {}): RenterView {
  const booking = requireBookingByToken(token);
  if (!canRespond(booking)) throw new HttpError(409, "There's no proposed charge to answer on this booking.", "conflict");
  if (booking.renterState?.response?.decision === "contested") throw new HttpError(409, "You've already contested this charge. It's with the host.", "conflict");
  if (decision === "contested" && !note?.trim()) throw new HttpError(422, "Tell the host why you're contesting.", "rule");

  const lineIds = booking.proposal?.lines.map((line) => line.id) ?? [];
  const accepted = decision === "contested" ? [...new Set(acceptedLineIds ?? [])] : [];
  if (accepted.some((id) => !lineIds.includes(id))) throw new HttpError(422, "That item isn't on this charge.", "rule");
  if (accepted.length && accepted.length === lineIds.length) throw new HttpError(422, "You accepted every item. Press Accept instead.", "rule");

  const contestedIds = decision === "contested" ? contestedLines(booking.proposal?.lines ?? [], accepted).map((line) => line.id) : [];
  const photoIds = Object.keys(evidence);
  if (photoIds.some((id) => !contestedIds.includes(id))) throw new HttpError(422, "A photo can only go with an item you contest.", "rule");
  const photos = Object.fromEntries(photoIds.map((id) => [id, { photo: saveEvidence(booking.id, id, evidence[id]) }]));

  const response: RenterResponse = { decision, note: note?.trim() || undefined, amountCents: chargeOf(booking), ...(accepted.length ? { acceptedLineIds: accepted } : {}), ...(photoIds.length ? { evidence: photos } : {}), at: new Date().toISOString() };
  const waiting = booking.status === "awaiting_approval";
  saveBooking({ ...booking, renterState: { ...booking.renterState!, response }, status: decision === "contested" && !waiting ? "contested" : booking.status });

  if (decision === "contested" && waiting && booking.settlement) {
    for (const approval of getApprovals().list({ runId: booking.settlement.runId, state: "pending" })) getApprovals().decide(approval.id, "denied", "renter", response.note);
  }
  // The accepted items go to the approval gate at once; the contested ones wait for the host.
  if (accepted.length && !waiting) requestPartCapture(booking.id);
  if (decision === "contested") void startSecondLook(booking.id, getContext().channel);
  return renterView(token);
}

/** The renter accepts the agent's counter, which the host sent. The charge then goes to the host's approval gate. */
export function acceptCounterAsRenter(token: string): RenterView {
  acceptCounter(requireBookingByToken(token).id, getContext().channel);
  return renterView(token);
}
