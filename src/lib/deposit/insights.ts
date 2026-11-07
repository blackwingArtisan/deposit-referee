/** One row per booking for the host's dashboard. Dollars, because that's what charts show. Display only: money logic stays in cents. */
import { itemizedCents } from "./rules";
import type { Booking, BookingStatus } from "./types";

export interface DepositRow {
  bookingId: string;
  property: string;
  booking: string;
  renter: string;
  stage: string;
  month: string;
  /** Still on hold with PayPal, not yet charged or released. */
  held: number;
  /** Captured, as re-read from PayPal. */
  charged: number;
  /** Authorized minus captured, as re-read from PayPal. */
  released: number;
  /** The settlement agent's total. Null before it has proposed. */
  aiProposed: number | null;
  /** The host's decision minus the agent's total. */
  hostChange: number;
  hostChanged: "Yes" | "No";
  /** 1 when the host changed the AI's number, so a dashboard can add them up. */
  changedCount: number;
  contested: "Yes" | "No";
}

const STAGE: Record<BookingStatus, string> = {
  draft: "Waiting for deposit",
  held: "On hold",
  reviewed: "On hold",
  proposed: "Host deciding",
  contested: "Contested",
  awaiting_approval: "Host deciding",
  captured: "Releasing",
  settled: "Settled",
};

const dollars = (cents: number) => cents / 100;

/** "Lakeside cabin, weekend of Nov 6" belongs to the property "Lakeside cabin". */
export function propertyOf(item: string): string {
  return item.split(",")[0].trim();
}

export function toDepositRow(booking: Booking): DepositRow {
  const { proposal, settlement, status } = booking;
  const settled = status === "settled";
  const capturedCents = settlement?.capturedCents ?? 0;
  const hostCents = settled ? capturedCents : proposal ? itemizedCents(proposal.lines) : 0;
  const change = proposal ? hostCents - proposal.aiCents : 0;
  return {
    bookingId: booking.id,
    property: propertyOf(booking.item),
    booking: booking.item,
    renter: booking.renter,
    stage: STAGE[status],
    month: new Date(booking.createdAt).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" }),
    held: settled || status === "draft" ? 0 : dollars((booking.authorizedCents ?? 0) - capturedCents),
    charged: dollars(capturedCents),
    released: dollars(settled ? (settlement?.releasedCents ?? 0) : 0),
    aiProposed: proposal ? dollars(proposal.aiCents) : null,
    hostChange: dollars(change),
    hostChanged: change === 0 ? "No" : "Yes",
    changedCount: change === 0 ? 0 : 1,
    contested: booking.renterState?.response?.decision === "contested" ? "Yes" : "No",
  };
}

/** "$90.00", and "−$60.00" with a real minus sign for a cut. */
export const usd = (value: number) => `${value < 0 ? "\u2212" : ""}$${Math.abs(value).toFixed(2)}`;

/** "AI said $150.00, you charged $90.00 (−$60.00)". Blank before the agent has proposed. */
export function aiVersusHost(row: Pick<DepositRow, "aiProposed" | "hostChange" | "stage">): string {
  if (row.aiProposed === null) return "";
  if (row.hostChange === 0) return `Kept the AI's ${usd(row.aiProposed)}`;
  const verb = row.stage === "Settled" ? "charged" : "set";
  return `AI said ${usd(row.aiProposed)}, you ${verb} ${usd(row.aiProposed + row.hostChange)} (${row.hostChange > 0 ? "+" : ""}${usd(row.hostChange)})`;
}
