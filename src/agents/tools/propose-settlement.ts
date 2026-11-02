/** The settlement agent's read of the review, and its one write: a proposal. Neither moves money. */
import { z } from "zod";
import { isAiLive } from "@/lib/ai";
import { AI_MODELS, modelLabel } from "@/lib/ai/config";
import { defineTool } from "@/lib/agent/tool";
import { requireBooking } from "@/lib/deposit/bookings";
import { recordProposal } from "@/lib/deposit/proposal";
import { dollarsToCents, formatExactCents, RuleError } from "@/lib/deposit/rules";

export const readDamageReview = defineTool({
  name: "read_damage_review",
  description: "Read the photo review for a booking: the verdict, each finding with its amount, the confidence, and the most that can be charged.",
  risk: "read",
  schema: z.object({ booking_id: z.string().min(3) }),
  title: () => "Read the photo review",
  execute: async (i) => {
    const { review, authorizedCents = 0, item, renter } = requireBooking(i.booking_id);
    if (!review) throw new RuleError("This booking hasn't been reviewed yet.");
    const itemized = review.items.reduce((sum, finding) => sum + finding.chargeCents, 0);
    return {
      rental: item,
      renter,
      new_damage: review.newDamage,
      confidence: review.confidence,
      reasoning: review.reasoning,
      findings: review.items.map((finding, index) => ({ finding: index, description: finding.description, amount_cents: finding.chargeCents })),
      itemized_cents: itemized,
      held_cents: authorizedCents,
      max_charge_cents: Math.min(itemized, authorizedCents),
    };
  },
});

export const proposeSettlement = defineTool({
  name: "propose_settlement",
  description:
    "Record your proposal for the host, then stop. decision=charge needs items that add up to amount_cents; decision=release needs amount_cents=0 and no items. Refused if the amount is above the itemized damage or the hold. Moves no money: only the host's approval can do that.",
  risk: "write",
  schema: z.object({
    booking_id: z.string().min(3),
    decision: z.enum(["charge", "release"]),
    amount_cents: z.number().int().nonnegative().describe("Total to charge in US cents. 0 for a release."),
    items: z
      .array(
        z.object({
          finding: z.number().int().nonnegative().describe("The finding's number from read_damage_review"),
          amount_cents: z.number().int().positive().describe("At or below that finding's amount"),
          note: z.string().min(3).max(300).describe("One sentence on why this item is charged, citing the evidence"),
        }),
      )
      .max(20),
    rationale: z.string().min(10).max(800).describe("Two or three plain sentences the host and renter will both read: what the photos show and why this outcome is fair"),
  }),
  title: (i) => (i.decision === "release" ? "Propose a full release" : `Propose charging ${formatExactCents(i.amount_cents)}`),
  execute: async (i, ctx) => {
    const { authorizationId } = requireBooking(i.booking_id);
    if (!authorizationId) throw new RuleError("This booking has no hold.");
    const auth = await ctx.paypal.payments.getAuthorization(authorizationId);
    if (auth.status !== "CREATED") throw new RuleError(`This hold is ${auth.status}, so nothing can be proposed against it.`);
    const live = isAiLive();
    const booking = recordProposal(i, { runId: ctx.runId, heldCents: dollarsToCents(auth.amount.value), engine: live ? modelLabel(AI_MODELS.default) : "Simulated agent", simulated: !live });
    return { recorded: true, status: booking.status, next: "Stop now. The host decides from here." };
  },
});
