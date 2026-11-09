/**
 * One money headline per state, for the host's page and the second-look card. Plain words, one
 * line, the amounts from the booking itself; everything that explains them folds behind "Why?".
 * Shared by server and client: no Node imports.
 */
import { approvalAction, approvalPlan, approvalRemainder } from "./approval-plan";
import { formatExactCents } from "./rules";
import { awaitsHost, isUnchanged } from "./second-look-rules";
import type { Booking, PendingApproval, SecondLook } from "./types";

const sum = (cents: number[]) => cents.reduce((a, b) => a + b, 0);

type HeadlineBooking = Pick<Booking, "status" | "depositCents" | "authorizedCents" | "proposal" | "renterState" | "partCapture" | "secondLook" | "settlement"> & { approval?: PendingApproval | null };

/** The host's money headline: what PayPal holds, what is proposed, what waits on whom, what moved. */
export function hostHeadline(b: HeadlineBooking): string {
  const held = b.authorizedCents ?? b.depositCents;
  const charged = b.partCapture?.captureId ? (b.partCapture.capturedCents ?? b.partCapture.requestedCents) : 0;
  switch (b.status) {
    case "draft":
      return `Waiting for the renter's ${formatExactCents(b.depositCents)} hold`;
    case "held":
    case "reviewed":
      return `${formatExactCents(held)} on hold, nothing charged`;
    case "proposed": {
      const charge = b.proposal?.kind === "release" ? 0 : sum((b.proposal?.lines ?? []).map((l) => l.amountCents));
      return charge ? `Proposed: charge ${formatExactCents(charge)}, release ${formatExactCents(held - charge)}` : `Proposed: release all ${formatExactCents(held)}`;
    }
    case "contested": {
      const look = b.secondLook;
      const lead = charged ? `${formatExactCents(charged)} charged · ` : "";
      if (look?.status === "ready" && look.lines.some(awaitsHost)) return `${lead}Decide: keep or drop ${formatExactCents(sum(look.lines.filter(awaitsHost).map((l) => l.fromCents)))}`;
      if (look?.status === "sent") return `${lead}Counter with the renter: ${formatExactCents(lookTo(look))}`;
      if (look?.status === "accepted") return `${lead}Renter accepted ${formatExactCents(lookTo(look))}`;
      if (look?.status === "ready" && look.counter) return `${lead}Counter ready: ${formatExactCents(lookFrom(look))} → ${formatExactCents(lookTo(look))}`;
      if (look?.status === "ready" && isUnchanged(look.lines)) return `${lead}${formatExactCents(lookFrom(look))} contested, unchanged by the second look`;
      const contested = b.partCapture?.contestedCents ?? b.renterState?.response?.amountCents ?? sum((b.proposal?.lines ?? []).map((l) => l.amountCents));
      return `${lead}${formatExactCents(contested)} contested, still on hold`;
    }
    case "awaiting_approval": {
      // The same plan as the Approve button: never a number the button doesn't move.
      const plan = approvalPlan(b);
      const action = approvalAction(plan);
      if (!b.approval || !action) return "Waiting for your approval: nothing moves until you decide";
      const remainder = approvalRemainder(plan);
      return `Your approval: ${action}${remainder ? `, ${remainder}` : ""}`;
    }
    case "captured":
      return `${formatExactCents(b.settlement?.capturedCents ?? charged)} charged, releasing the rest`;
    case "settled":
      return `${formatExactCents(b.settlement?.capturedCents ?? 0)} captured, ${formatExactCents(b.settlement?.releasedCents ?? 0)} released`;
  }
}

const lookFrom = (look: SecondLook) => sum(look.lines.map((l) => l.fromCents));
const lookTo = (look: SecondLook) => sum(look.lines.map((l) => l.toCents));

/** The second-look card's headline: the contested amount before and after, or what waits on the host. */
export function secondLookHeadline(look: SecondLook): string {
  if (look.status === "running") return "Claude is taking a second look";
  if (look.status === "failed") return "The second look didn't finish";
  const flagged = look.lines.filter(awaitsHost);
  if (flagged.length) return `Claude can't tell on ${formatExactCents(sum(flagged.map((l) => l.fromCents)))}: you decide`;
  if (isUnchanged(look.lines)) return `No change: ${formatExactCents(lookFrom(look))} stands`;
  return `Contested ${formatExactCents(lookFrom(look))} → ${formatExactCents(lookTo(look))}`;
}
