/** A split answer: the renter accepts some items and contests the rest. Shared by server and browser. */
import { itemizedCents } from "./rules";
import type { Booking, ChargeLine } from "./types";

export interface Split {
  accepted: ChargeLine[];
  contested: ChargeLine[];
  acceptedCents: number;
  contestedCents: number;
}

/** Already charged from the hold for the accepted items. */
export const partCapturedCents = (booking: Pick<Booking, "partCapture">) => booking.partCapture?.capturedCents ?? 0;

/** What can still be charged from the hold: the hold, less what was already captured from it. */
export const heldCents = (booking: Pick<Booking, "authorizedCents" | "depositCents" | "partCapture">) => (booking.authorizedCents ?? booking.depositCents) - partCapturedCents(booking);

/**
 * The renter's split, or null when they answered the whole charge one way. Once the accepted items
 * are charged, the proposal holds only the contested ones.
 */
export function splitOf(booking: Pick<Booking, "proposal" | "renterState" | "partCapture">): Split | null {
  const lines = booking.proposal?.lines ?? [];
  const done = booking.partCapture?.captureId ? booking.partCapture : undefined;
  if (done) return { accepted: done.lines, contested: lines, acceptedCents: itemizedCents(done.lines), contestedCents: done.contestedCents ?? itemizedCents(lines) };
  const response = booking.renterState?.response;
  const ids = response?.decision === "contested" ? response.acceptedLineIds : undefined;
  if (!ids?.length) return null;
  const accepted = lines.filter((line) => ids.includes(line.id));
  const contested = lines.filter((line) => !ids.includes(line.id));
  if (!accepted.length || !contested.length) return null;
  return { accepted, contested, acceptedCents: itemizedCents(accepted), contestedCents: itemizedCents(contested) };
}
