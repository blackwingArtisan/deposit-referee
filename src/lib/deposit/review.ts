/**
 * The AI comparison. The prompt comes from the TK-39 vision spike (Sonnet 5.5, 5 pairs, sealed
 * key). That spike showed it is reliable for clearly visible damage only; subtle damage is
 * untested. The AI suggests. Totals, the cap and the released amount are worked out here.
 */
import { z } from "zod";
import { compareImages } from "@/lib/ai";
import { modelLabel } from "@/lib/ai/config";
import type { ImageMediaType } from "@/lib/ai/images";
import { readPhoto } from "./photos";
import type { Booking, DamageBox, DamageReview } from "./types";

const Verdict = z.object({
  new_damage: z.boolean().describe("True only if the renter caused damage that isn't in the check-in photo"),
  findings: z
    .array(
      z.object({
        description: z.string(),
        box: z.object({
          x: z.number().describe("Left edge, 0-1, as a fraction of the check-out photo's width"),
          y: z.number().describe("Top edge, 0-1, as a fraction of the check-out photo's height"),
          w: z.number().describe("Width, 0-1"),
          h: z.number().describe("Height, 0-1"),
        }),
        charge_cents: z.number().describe("Repair charge for this damage in US cents: 15000 means $150.00"),
      }),
    )
    .describe("One item per new damage; empty if none"),
  reasoning: z.string().describe("Two or three sentences a renter could read and contest"),
  confidence: z.enum(["high", "medium", "low"]),
});
export type Verdict = z.infer<typeof Verdict>;

const QUESTION = `You are the neutral referee for a security deposit. The first photo was taken at check-in and the second at check-out, of the same part of a rental. The renter's money is at stake, and a wrongful charge is the worst mistake you can make.

Decide whether the renter caused new damage.
- Charge only for damage that is visible at check-out and not visible at check-in.
- Anything already present at check-in is not the renter's responsibility.
- Differences in lighting, exposure, colour, camera position, framing or sharpness are not damage.
- Moved furniture or belongings are not damage.
- Ordinary wear and tear is not damage.
- If you can't be reasonably sure the damage is new, don't charge.

For each new damage, give a box around it in the check-out photo. Propose a fair repair charge in US cents for a typical US rental, for the repair only.`;

/** A real answer from the vision spike on the demo photos (pair 1, run 1). */
export const MOCK_VERDICT: Verdict = {
  new_damage: true,
  findings: [
    {
      description: "Long thin scratch or gouge in the plank floor, with lighter material exposed along its length. It is not visible in the same floor area in the check-in photo.",
      box: { x: 0.44, y: 0.59, w: 0.09, h: 0.29 },
      charge_cents: 15_000,
    },
  ],
  reasoning: "The check-out photo shows a long, narrow scratch with a gouged, lighter edge across the plank floor. The same area in the check-in photo is clean, with only normal grain and seams. Lighting and camera angle differ, but they do not explain a distinct scratch like this. The charge covers repairing or replacing the affected plank.",
  confidence: "high",
};

function clampBox(box: DamageBox): DamageBox | null {
  const x = Math.min(Math.max(box.x, 0), 1);
  const y = Math.min(Math.max(box.y, 0), 1);
  const w = Math.min(box.w, 1 - x);
  const h = Math.min(box.h, 1 - y);
  return w > 0 && h > 0 ? { x, y, w, h } : null;
}

/** Turns the model's answer into a record we trust: whole cents, boxes on the photo, our own total. */
export function toReview(verdict: Verdict, authorizedCents: number, meta: { mocked: boolean; model?: string; costUsd: number }): DamageReview {
  const items = verdict.new_damage
    ? verdict.findings.map((f) => ({ description: f.description, box: clampBox(f.box), chargeCents: Math.max(0, Math.round(f.charge_cents)) }))
    : [];
  const totalCents = items.reduce((sum, item) => sum + item.chargeCents, 0);
  return {
    newDamage: verdict.new_damage,
    items,
    reasoning: verdict.reasoning,
    confidence: verdict.confidence,
    suggestedCents: Math.min(totalCents, authorizedCents),
    cappedToHold: totalCents > authorizedCents,
    ...meta,
  };
}

export async function reviewPhotos(booking: Booking): Promise<DamageReview> {
  const { check_in, check_out } = booking.photos;
  if (!check_in || !check_out || booking.authorizedCents === undefined) throw new Error("A review needs both photos and a hold.");
  const image = (photo: typeof check_in) => ({ base64: readPhoto(photo).toString("base64"), mediaType: photo.mediaType as ImageMediaType });
  const { data, mocked, model, costUsd } = await compareImages({
    images: [image(check_in), image(check_out)],
    labels: ["Check-in photo", "Check-out photo"],
    question: QUESTION,
    schema: Verdict,
    mock: () => MOCK_VERDICT,
  });
  return toReview(data, booking.authorizedCents, { mocked, model: model ? modelLabel(model) : undefined, costUsd });
}
