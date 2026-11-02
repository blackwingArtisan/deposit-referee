/** Booking records, kept in the kit's JSON store. Server only. */
import { randomUUID } from "node:crypto";
import { HttpError } from "@/lib/http";
import { getApprovals } from "@/lib/agent/approvals";
import { collection } from "@/lib/store/collection";
import { singleton } from "@/lib/singleton";
import { holdClock } from "./rules";
import type { Booking, BookingView, PendingApproval } from "./types";

const bookings = () => collection<Booking>("bookings");

/** Settlements running in this process. A pending approval dies with the process. */
export const activeSettlements = () => singleton("deposit:active-settlements", () => new Set<string>());

export function createBooking(input: { item: string; renter: string; depositCents: number }): Booking {
  return bookings().upsert({ ...input, id: `bk_${randomUUID().slice(0, 8)}`, status: "draft", createdAt: new Date().toISOString(), renterToken: randomUUID(), photos: {} });
}

export function requireBooking(id: string): Booking {
  const booking = bookings().get(id);
  if (!booking) throw new HttpError(404, `Booking ${id} not found`, "not_found");
  return booking;
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

function pendingApproval(booking: Booking): PendingApproval | null {
  const runId = booking.settlement?.runId;
  const pending = runId ? getApprovals().list({ runId, state: "pending" })[0] : undefined;
  return pending ? { id: pending.id, summary: pending.summary, reason: pending.reason, amountValue: pending.amount?.value } : null;
}

export function viewBooking(input: Booking): BookingView {
  let booking = input;
  // The server restarted while the host was deciding: no money moved, so go back a step.
  if (booking.status === "awaiting_approval" && !activeSettlements().has(booking.id)) {
    booking = saveBooking({ ...booking, status: decisionStatus(booking), settlement: { ...booking.settlement!, error: "The approval was lost when the server restarted. Request it again." } });
  }
  return { ...booking, hold: booking.holdExpiresAt ? holdClock(booking.holdExpiresAt) : null, approval: pendingApproval(booking) };
}

/** Plain records, newest first. Reading them changes nothing. */
export function allBookings(): Booking[] {
  return bookings()
    .list()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function listBookings(): BookingView[] {
  return allBookings().map(viewBooking);
}
