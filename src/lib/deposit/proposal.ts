/**
 * The settlement agent's proposal and the host's changes to it. The agent's only write is
 * recordProposal(), and it can't move money. Every limit here is code: the prompt can't relax one.
 */
import { HttpError } from "@/lib/http";
import { decisionStatus, requireBooking, saveBooking } from "./bookings";
import { assertCaptureLimits, itemizedCents, renterDeadline, RuleError } from "./rules";
import { heldCents, splitOf } from "./split-rules";
import type { Booking, ChargeLine, Proposal } from "./types";

export interface ProposalRequest {
  booking_id: string;
  decision: "charge" | "release";
  /** The findings the agent stands behind. Their amounts come from the price table, not the agent. */
  items: { finding: number; note: string }[];
  rationale: string;
}

/**
 * Each finding at most once, at its price-table amount. If they add up to more than the hold,
 * the last ones are trimmed to fit, in code, so the agent never picks a number.
 */
function linesFrom(booking: Booking, request: ProposalRequest, heldCents: number): ChargeLine[] {
  const findings = booking.review?.items ?? [];
  let room = heldCents;
  return request.items.flatMap(({ finding, note }, index) => {
    const item = findings[finding];
    if (!item) throw new RuleError(`Finding ${finding} isn't in the photo review.`);
    if (request.items.findIndex((other) => other.finding === finding) !== index) throw new RuleError(`Finding ${finding} is listed twice.`);
    const amount = Math.min(item.chargeCents, room);
    room -= amount;
    return amount > 0 ? [{ id: `ai-${finding}`, description: item.description, box: item.box, amountCents: amount, aiCents: amount, note, price: item.price, ...(item.photo ? { photo: item.photo } : {}) }] : [];
  });
}

/** Refuses anything over the limits, whatever was asked, and saves the rest as the booking's proposal. */
export function recordProposal(request: ProposalRequest, ctx: { runId: string; heldCents: number; engine: string; simulated: boolean }): Booking {
  const booking = requireBooking(request.booking_id);
  if (!booking.review) throw new RuleError("Run the photo review before proposing anything.");

  let lines: ChargeLine[] = [];
  if (request.decision === "release") {
    if (request.items.length) throw new RuleError("A full release charges nothing, so it has no items.");
  } else {
    lines = linesFrom(booking, request, ctx.heldCents);
    if (!lines.length) throw new RuleError("A charge needs at least one finding from the photo review.");
    assertCaptureLimits(itemizedCents(lines), itemizedCents(booking.review.items.map((i) => ({ amountCents: i.chargeCents }))), ctx.heldCents);
  }
  if (booking.status !== "reviewed") throw new RuleError("This booking already has a proposal. Stop here.");

  const proposal: Proposal = {
    runId: ctx.runId,
    kind: request.decision,
    aiCents: itemizedCents(lines),
    lines,
    rationale: request.rationale,
    proposedAt: new Date().toISOString(),
    engine: ctx.engine,
    simulated: ctx.simulated,
  };
  return saveBooking({ ...booking, status: "proposed", proposal, agentError: undefined, renterState: { deadline: renterDeadline(booking.holdExpiresAt) } });
}

export interface HostLines {
  lines: { id: string; amountCents: number }[];
  add?: { description: string; amountCents: number };
  /** One worth-a-look item from the photo review, by its place in that list. */
  addLook?: number;
  /** Why the host changed the AI's figures, in one line. */
  reason?: string;
}

export const lookLineId = (index: number) => `look-${index}`;

/** The host's choice, so it has no aiCents. It keeps the item's box as evidence, and the hold is still the ceiling. */
function lookLine(booking: Booking, lines: ChargeLine[], heldCents: number, index: number): ChargeLine {
  const look = booking.review?.worthALook?.[index];
  if (!look) throw new HttpError(422, "That item isn't in the photo review.", "rule");
  if (lines.some((line) => line.id === lookLineId(index))) throw new HttpError(422, "That item is already on the charge.", "rule");
  const room = heldCents - itemizedCents(lines);
  if (room <= 0) throw new HttpError(422, "The charge already uses the whole hold.", "rule");
  return { id: lookLineId(index), description: look.description, box: look.box, amountCents: Math.min(look.chargeCents, room), note: "The AI flagged this but didn't charge it. The host added it." };
}

/**
 * The host's own numbers. The AI's figures are a starting point and often run low, so the host
 * may raise them, but the renter then has to see the new amount before it can be charged.
 */
export function saveHostLines(id: string, update: HostLines): Booking {
  const booking = requireBooking(id);
  const { proposal, authorizedCents } = booking;
  if (!proposal || authorizedCents === undefined || (booking.status !== "proposed" && booking.status !== "contested")) throw new HttpError(409, `A booking in status ${booking.status} can't be changed.`, "conflict");

  if (splitOf(booking) && !booking.partCapture?.captureId) throw new HttpError(409, "The renter accepted part of this charge. Charge the accepted items first.", "conflict");
  const held = heldCents(booking);
  const amounts = new Map(update.lines.map((line) => [line.id, line.amountCents]));
  const lines: ChargeLine[] = proposal.lines.map((line) => ({ ...line, amountCents: amounts.get(line.id) ?? line.amountCents }));
  if (update.add) lines.push({ id: `host-${lines.length}`, description: update.add.description, box: null, amountCents: update.add.amountCents });
  if (update.addLook !== undefined) lines.push(lookLine(booking, lines, held, update.addLook));

  const before = itemizedCents(proposal.lines);
  const total = itemizedCents(lines);
  if (total > held) throw new HttpError(422, "Those lines add up to more than the hold.", "rule");
  const raised = total > before;
  if (raised && decisionStatus(booking) === "contested") throw new HttpError(422, "The renter contested this charge, so it can only go down now.", "rule");

  return saveBooking({
    ...booking,
    proposal: { ...proposal, lines, hostReason: update.reason?.trim() || proposal.hostReason },
    renterState: raised ? { deadline: renterDeadline(booking.holdExpiresAt) } : booking.renterState,
    settlement: undefined,
  });
}
