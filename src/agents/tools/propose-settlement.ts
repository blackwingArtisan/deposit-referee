/** The settlement agent's read of the review, and its one write: a proposal. Neither moves money. */
import { z } from "zod";
import { isAiLive } from "@/lib/ai";
import { AI_MODELS, modelLabel } from "@/lib/ai/config";
import { defineTool } from "@/lib/agent/tool";
import { requireBooking } from "@/lib/deposit/bookings";
import { recordProposal } from "@/lib/deposit/proposal";
import { rowLabel } from "@/lib/deposit/prices";
import { dollarsToCents, RuleError } from "@/lib/deposit/rules";
import { readHold } from "@/lib/deposit/hold-read";

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
      findings: review.items.map((finding, index) => ({ finding: index, description: finding.description, price_table_row: finding.price ? rowLabel(finding.price) : undefined, amount_cents: finding.chargeCents })),
      itemized_cents: itemized,
      held_cents: authorizedCents,
      max_charge_cents: Math.min(itemized, authorizedCents),
    };
  },
});

export const proposeSettlement = defineTool({
  name: "propose_settlement",
  description:
    "Record your proposal for the host, then stop. decision=charge lists the findings you stand behind; each is priced from the app's price table, and trimmed to fit the hold, by code. decision=release has no items. Moves no money: only the host's approval can do that.",
  risk: "write",
  schema: z.object({
    booking_id: z.string().min(3),
    decision: z.enum(["charge", "release"]),
    items: z
      .array(
        z.object({
          finding: z.number().int().nonnegative().describe("The finding's number from read_damage_review"),
          note: z.string().min(3).max(300).describe("One sentence on why this item is charged, citing the evidence"),
        }),
      )
      .max(20),
    rationale: z.string().min(10).max(800).describe("Two or three plain sentences the host and renter will both read: what the photos show and why this outcome is fair"),
  }),
  title: (i) => (i.decision === "release" ? "Propose a full release" : `Propose charging for ${i.items.length} ${i.items.length === 1 ? "finding" : "findings"}`),
  execute: async (i, ctx) => {
    const { authorizationId, orderId } = requireBooking(i.booking_id);
    if (!authorizationId) throw new RuleError("This booking has no hold.");
    const auth = await readHold(ctx.paypal, orderId, authorizationId);
    if (auth.status !== "CREATED") throw new RuleError(`This hold is ${auth.status}, so nothing can be proposed against it.`);
    const live = isAiLive();
    const booking = recordProposal(i, { runId: ctx.runId, heldCents: dollarsToCents(auth.amount.value), engine: live ? modelLabel(AI_MODELS.default) : "Simulated agent", simulated: !live });
    return { recorded: true, status: booking.status, charge_cents: booking.proposal?.aiCents ?? 0, next: "Stop now. The host decides from here." };
  },
});
