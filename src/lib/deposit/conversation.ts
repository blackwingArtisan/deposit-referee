/**
 * The host's conversation rail: what the renter did on their phone and what came back, in order,
 * so the two screens read as one exchange. Worked out from the booking's own fields, nothing else.
 * Shared by server and browser, so no Node imports.
 */
import { TYPE_LABEL } from "./prices";
import { formatCents, formatExactCents } from "./rules";
import { isDropped } from "./second-look-rules";
import type { Booking, ChargeLine } from "./types";

export type RailWho = "renter" | "host" | "claude" | "paypal";

export interface RailEntry {
  key: string;
  who: RailWho;
  text: string;
  at?: string;
  /** Still to happen: shown greyed at the end. */
  waiting?: boolean;
}

const DAMAGE_WORD = /\b(gouge|scratch|stain|dent|chip|crack|burn|tear|rip|hole|scuff|mark)\b/i;

/** One or two words for a charge line: "Gouge", "Stain". */
export function shortName(line: Pick<ChargeLine, "description" | "price">): string {
  const word = line.description.match(DAMAGE_WORD)?.[1];
  if (word) return word[0].toUpperCase() + word.slice(1).toLowerCase();
  return line.price ? TYPE_LABEL[line.price.type] : line.description.split(/\s+/).slice(0, 3).join(" ");
}

type RailBooking = Pick<Booking, "status" | "authorizedCents" | "heldAt" | "proposal" | "renterState" | "partCapture" | "secondLook" | "settlement">;

export function conversation(booking: RailBooking): RailEntry[] {
  const out: RailEntry[] = [];
  const { renterState, partCapture, secondLook, settlement } = booking;
  const response = renterState?.response;

  if (booking.authorizedCents !== undefined) out.push({ key: "hold", who: "renter", text: `Placed the ${formatCents(booking.authorizedCents)} hold`, at: booking.heldAt });
  else out.push({ key: "hold", who: "renter", text: "Hasn't placed the hold yet", waiting: true });

  // The lines as the renter answered them: the accepted ones went to the part capture.
  const lines = [...new Map([...(partCapture?.lines ?? []), ...(booking.proposal?.lines ?? [])].map((l) => [l.id, l])).values()];
  if (booking.proposal && renterState) {
    if (renterState.openedAt) out.push({ key: "opened", who: "renter", text: "Opened the proposal", at: renterState.openedAt });
    if (!response) {
      if (booking.status !== "settled" && booking.status !== "awaiting_approval") out.push({ key: "answer", who: "renter", text: "Answer due", at: renterState.deadline, waiting: true });
    } else if (response.decision === "accepted") {
      out.push({ key: "answer", who: "renter", text: lines.length > 1 ? `Accepted all ${lines.length} items` : `Accepted the ${shortName(lines[0] ?? { description: "charge" }).toLowerCase()}`, at: response.at });
    } else {
      const accepted = new Set(response.acceptedLineIds ?? []);
      const contested = lines.filter((l) => !accepted.has(l.id));
      for (const line of lines.filter((l) => accepted.has(l.id))) out.push({ key: `accepted-${line.id}`, who: "renter", text: `${shortName(line)} accepted`, at: response.at });
      for (const line of contested) out.push({ key: `contested-${line.id}`, who: "renter", text: `${shortName(line)} contested${response.evidence?.[line.id] ? " with a photo" : ""}`, at: response.at });
    }
  }

  if (partCapture?.captureId && partCapture.capturedCents !== undefined) out.push({ key: "part", who: "paypal", text: `${formatExactCents(partCapture.capturedCents)} captured for what they accepted`, at: partCapture.capturedAt });

  if (secondLook) {
    if (secondLook.status === "running") out.push({ key: "look", who: "claude", text: "Second look running", waiting: true });
    else if (secondLook.status === "failed") out.push({ key: "look", who: "claude", text: "Second look didn't finish" });
    else {
      for (const line of secondLook.lines) {
        const name = shortName(line);
        const what = isDropped(line) ? (line.verdict === "already_there" ? "already there" : "not charged") : line.toCents < line.fromCents ? `down to ${formatExactCents(line.toCents)}` : "stands";
        out.push({ key: `look-${line.lineId}`, who: "claude", text: `Second look: ${name.toLowerCase()} ${what}`, at: secondLook.finishedAt });
      }
      const total = secondLook.lines.reduce((sum, l) => sum + l.toCents, 0);
      if (secondLook.sentAt) out.push({ key: "counter", who: "host", text: `Counter sent: ${formatExactCents(total)}`, at: secondLook.sentAt });
      else if (secondLook.status === "ready") out.push({ key: "counter", who: "host", text: "Counter ready to send", waiting: true });
      if (secondLook.acceptedAt) out.push({ key: "counter-accepted", who: "renter", text: "Accepted the counter", at: secondLook.acceptedAt });
      else if (secondLook.status === "sent") out.push({ key: "counter-accepted", who: "renter", text: "Counter with the renter", waiting: true });
    }
  }

  if (booking.status === "settled" && settlement?.capturedCents !== undefined && settlement.releasedCents !== undefined) {
    out.push({ key: "settled", who: "paypal", text: `${formatCents(settlement.capturedCents)} captured · ${formatCents(settlement.releasedCents)} released`, at: settlement.settledAt });
  }
  return out;
}
