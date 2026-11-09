/**
 * What the waiting approval would do, worked out from the booking, never from the browser's inputs.
 * One source for the Approve button and the host's headline, so the two can't disagree. Shared by
 * server and client: no Node imports.
 */
import { formatExactCents, releasedCents } from "./rules";
import { heldCents } from "./split-rules";
import type { Booking, ChargeLine } from "./types";

export type ApprovalPlan =
  | { kind: "part" | "charge" | "release"; lines: ChargeLine[]; captureCents: number; releaseCents: number; keepCents: number }
  | { kind: "unknown"; lines: ChargeLine[]; captureCents: 0; releaseCents: 0; keepCents: 0 };

type PlanBooking = Pick<Booking, "authorizedCents" | "depositCents" | "partCapture" | "settlement" | "proposal">;

export function approvalPlan(booking: PlanBooking): ApprovalPlan {
  const part = booking.partCapture && !booking.partCapture.captureId ? booking.partCapture : undefined;
  const held = heldCents(booking);
  if (part) return { kind: "part", lines: part.lines, captureCents: part.requestedCents, releaseCents: 0, keepCents: held - part.requestedCents };
  const settlement = booking.settlement;
  // Every gate is opened with a part capture or a settlement; without either, no amount is named.
  if (!settlement) return { kind: "unknown", lines: [], captureCents: 0, releaseCents: 0, keepCents: 0 };
  if (settlement.kind === "release") return { kind: "release", lines: [], captureCents: 0, releaseCents: held, keepCents: 0 };
  return { kind: "charge", lines: booking.proposal?.lines ?? [], captureCents: settlement.requestedCents, releaseCents: releasedCents(held, settlement.requestedCents), keepCents: 0 };
}

/** The Approve button's action and amount, e.g. "capture $90.00", or null when the amount isn't known. */
export function approvalAction(plan: ApprovalPlan): string | null {
  if (plan.kind === "unknown") return null;
  return plan.kind === "release" ? `release ${formatExactCents(plan.releaseCents)}` : `capture ${formatExactCents(plan.captureCents)}`;
}

/** What else happens to the hold: kept for the contested items, or released. */
export function approvalRemainder(plan: ApprovalPlan): string | null {
  if (plan.kind === "part") return `keep ${formatExactCents(plan.keepCents)} on hold`;
  if (plan.kind === "charge") return `release ${formatExactCents(plan.releaseCents)}`;
  return null;
}
