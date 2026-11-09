/**
 * The booking's money in one line: "$300 held → $150 captured → $20 captured → $130 released".
 * Every amount is one PayPal returned: the authorization, each capture and the void, as the
 * settlement recorded them after reading them back. Shared by server and browser.
 */
import { formatCents } from "./rules";
import type { Booking } from "./types";

export interface MoneyStep {
  kind: "held" | "captured" | "released";
  cents: number;
  label: string;
}

/** The steps, once the booking is settled; null before (or if PayPal's amounts aren't recorded). */
export function moneySteps(booking: Pick<Booking, "status" | "authorizedCents" | "partCapture" | "settlement">): MoneyStep[] | null {
  const { settlement, authorizedCents } = booking;
  if (booking.status !== "settled" || authorizedCents === undefined || settlement?.capturedCents === undefined || settlement.releasedCents === undefined) return null;
  const step = (kind: MoneyStep["kind"], cents: number): MoneyStep => ({ kind, cents, label: `${formatCents(cents)} ${kind}` });
  const part = booking.partCapture?.captureId ? (booking.partCapture.capturedCents ?? 0) : 0;
  // Once settled, capturedCents is the booking's total, the accepted part included.
  const captures = [part, settlement.capturedCents - part].filter((cents) => cents > 0);
  return [step("held", authorizedCents), ...(captures.length ? captures : [0]).map((cents) => step("captured", cents)), step("released", settlement.releasedCents)];
}

export const moneyLine = (steps: MoneyStep[]) => steps.map((s) => s.label).join(" → ");
