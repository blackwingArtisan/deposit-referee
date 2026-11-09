/** Booking records, kept in the kit's JSON store. Server only. */
import { randomUUID } from "node:crypto";
import { HttpError } from "@/lib/http";
import { getApprovals } from "@/lib/agent/approvals";
import { newHostSecret } from "./host-key";
import { collection } from "@/lib/store/collection";
import { singleton } from "@/lib/singleton";
import { recordBookingEvents } from "./booking-events";
import { holdClock } from "./rules";
import type { Booking, BookingListItem, BookingView, PendingApproval } from "./types";

const bookings = () => collection<Booking>("bookings");

// Every booking route loads this file, so the booking's PayPal calls are kept from the first one.
recordBookingEvents();

/** The browser tests book under this name. Their rows stay out of what a visitor sees. */
export const TEST_RENTER = "Test Renter";

/** Settlements running in this process. A pending approval dies with the process. */
export const activeSettlements = () => singleton("deposit:active-settlements", () => new Set<string>());

export function createBooking(input: { item: string; renter: string; depositCents: number; visitorId?: string }): Booking {
  return bookings().upsert({ ...input, id: `bk_${randomUUID().slice(0, 8)}`, status: "draft", createdAt: new Date().toISOString(), renterToken: randomUUID(), hostSecret: newHostSecret(), photos: {} });
}

export function requireBooking(id: string): Booking {
  const booking = bookings().get(id);
  if (!booking) throw new HttpError(404, `Booking ${id} not found`, "not_found");
  return booking;
}

/** A booking by id, or undefined. */
export function findBooking(id: string): Booking | undefined {
  return bookings().get(id);
}

export function saveBooking(booking: Booking): Booking {
  return bookings().upsert(booking);
}

export function requireBookingByToken(token: string): Booking {
  const booking = bookings().list().find((b) => b.renterToken === token);
  if (!booking) throw new HttpError(404, "This link doesn't match a booking.", "not_found");
  return booking;
}

/** Where a booking goes when a decision falls through: back to the host, with no money moved. */
export function decisionStatus(booking: Booking): "proposed" | "contested" | "reviewed" {
  if (!booking.proposal) return "reviewed";
  return booking.renterState?.response?.decision === "contested" ? "contested" : "proposed";
}

function pendingFor(runId: string | undefined): PendingApproval | null {
  const pending = runId ? getApprovals().list({ runId, state: "pending" })[0] : undefined;
  return pending ? { id: pending.id, summary: pending.summary, reason: pending.reason, amountValue: pending.amount?.value } : null;
}

function pendingApproval(booking: Booking): PendingApproval | null {
  const part = booking.partCapture && !booking.partCapture.captureId ? booking.partCapture : undefined;
  return pendingFor(part && booking.status === "awaiting_approval" ? part.runId : booking.settlement?.runId);
}

/** The key in activeSettlements while the evidence pack waits at the gate. */
export const evidenceKey = (bookingId: string) => `${bookingId}:evidence`;

/** An evidence submission that is neither sent nor failed, and no longer running here, was lost in a restart. */
function lostEvidence(booking: Booking): boolean {
  const evidence = booking.dispute?.evidence;
  return !!evidence && !evidence.submittedAt && !evidence.error && !activeSettlements().has(evidenceKey(booking.id));
}

export function viewBooking(input: Booking): BookingView {
  let booking = input;
  // The server restarted while the host was deciding: no money moved, so go back a step.
  if (booking.status === "awaiting_approval" && !activeSettlements().has(booking.id)) {
    const error = "The approval was lost when the server restarted. Request it again.";
    booking =
      booking.partCapture && !booking.partCapture.captureId
        ? saveBooking({ ...booking, status: decisionStatus(booking), partCapture: { ...booking.partCapture, error } })
        : saveBooking({ ...booking, status: decisionStatus(booking), settlement: { ...booking.settlement!, error } });
  }
  if (lostEvidence(booking)) {
    booking = saveBooking({ ...booking, dispute: { ...booking.dispute!, evidence: { ...booking.dispute!.evidence!, error: "The approval was lost when the server restarted. Send it again." } } });
  }
  const evidence = booking.dispute?.evidence;
  return {
    ...booking,
    visitorId: undefined,
    hostSecret: undefined,
    hold: booking.holdExpiresAt ? holdClock(booking.holdExpiresAt) : null,
    approval: pendingApproval(booking),
    disputeApproval: evidence && !evidence.submittedAt ? pendingFor(evidence.runId) : null,
  };
}

/** Plain records, newest first. Reading them changes nothing. Pass `tests` to include test rows. */
export function allBookings({ tests = false } = {}): Booking[] {
  return bookings()
    .list()
    .filter((b) => tests || b.renter !== TEST_RENTER)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * What one visitor's lists show: the samples and the bookings made in their browser. Test runs
 * (`tests`) see every row. Bookings from before visitors were told apart show to nobody's list.
 */
export function bookingsFor(visitor: string | undefined, { tests = false } = {}): Booking[] {
  return allBookings({ tests }).filter((b) => tests || b.sample || (!!visitor && b.visitorId === visitor));
}

/** The list anyone can read. It never carries a renter's link, which is the only key to their page. */
export function listBookings(visitor: string | undefined, opts?: { tests?: boolean }): BookingListItem[] {
  return bookingsFor(visitor, opts).map((b) => {
    const view: Partial<BookingView> = viewBooking(b);
    delete view.renterToken;
    return view as BookingListItem;
  });
}

/** Every PayPal id that belongs to a booking here, samples and test rows included. */
export function ownPaypalIds(): Set<string> {
  const ids = allBookings({ tests: true }).flatMap((b) => [b.orderId, b.authorizationId, b.refreshedAuthorizationId, b.settlement?.captureId]);
  return new Set(ids.filter((id): id is string => !!id));
}

/** The booking an approval is for, by the run that asked for it. */
export function bookingForRun(runId: string): Booking | undefined {
  return bookings()
    .list()
    .find((b) => b.settlement?.runId === runId || b.partCapture?.runId === runId || b.dispute?.evidence?.runId === runId);
}
