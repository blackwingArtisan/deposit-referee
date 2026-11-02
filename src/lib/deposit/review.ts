/**
 * The AI comparison. The charge rule comes from the TK-39 vision spike (Sonnet 5.5, 5 pairs, sealed
 * key), and it stays strict: subtle marks aren't charged. A blind test showed the AI often sees them
 * and declines, so what it notices goes to worth_a_look, where only the host can turn it into a
 * charge. The AI suggests. Totals, the cap and the released amount are worked out here.
 */
import { z } from "zod";
import { compareImages } from "@/lib/ai";
import { modelLabel } from "@/lib/ai/config";
import type { ImageMediaType } from "@/lib/ai/images";
import { failIfCreditOut } from "./credit-test";
import { DEMO_FAINT_CHECK_OUT, readPhoto } from "./photos";
import type { Booking, DamageBox, DamageReview } from "./types";

const Box = z.object({
  x: z.number().describe("Left edge, 0-1, as a fraction of the check-out photo's width"),
  y: z.number().describe("Top edge, 0-1, as a fraction of the check-out photo's height"),
  w: z.number().describe("Width, 0-1"),
  h: z.number().describe("Height, 0-1"),
});

/** The most worth-a-look items a host is asked to check on one review. */
const MAX_WORTH_A_LOOK = 3;

const Verdict = z.object({
  new_damage: z.boolean().describe("True only if the renter caused damage that isn't in the check-in photo"),
  findings: z
    .array(
      z.object({
        description: z.string(),
        box: Box,
        charge_cents: z.number().describe("Proposed charge for this damage in US cents: 15000 means $150.00"),
      }),
    )
    .describe("One item per new damage; empty if none"),
  worth_a_look: z
    .array(
      z.object({
        description: z.string(),
        box: Box,
        charge_cents: z.number().describe("What a fair repair would cost if the host confirms the mark, in US cents"),
      }),
    )
    .describe("Marks that may be new but you aren't sure enough to charge; empty if none"),
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

For each new damage, give a box around it in the check-out photo. Propose a fair charge in US cents for a typical US rental, for the repair only.

Then fill in worth_a_look. Go over the check-out photo surface by surface (walls, floor, doors, cabinets, counters, tile, furniture) and compare each with the same spot in the check-in photo. If you find a specific mark (a scratch, scuff, chip, dent, crack, stain, burn or tear) that you can't see at check-in but aren't sure enough to charge for, don't charge it: list it in worth_a_look with a box around it in the check-out photo. The host will look at it, and it is never charged unless the host chooses to.
- List only one specific mark you can point to and box, never a general difference in a surface.
- Never list anything you can also see at check-in, or anything above that isn't damage: shadows, reflections, glare, moved things, ordinary wear.
- worth_a_look is only for faint or small marks. Large or plainly visible damage that isn't at check-in is charged as above, not listed here.
- Damage you charge for doesn't also go in worth_a_look.
- Most stays have nothing worth a look, so an empty list is the normal answer.`;

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
  worth_a_look: [],
  reasoning: "The check-out photo shows a long, narrow scratch with a gouged, lighter edge across the plank floor. The same area in the check-in photo is clean, with only normal grain and seams. Lighting and camera angle differ, but they do not explain a distinct scratch like this. The charge covers repairing or replacing the affected plank.",
  confidence: "high",
};

/** Used when the two photos are the same file, which is how the demo shows a clean check-out. */
export const MOCK_NO_DAMAGE: Verdict = {
  new_damage: false,
  findings: [],
  worth_a_look: [],
  reasoning: "The check-in and check-out photos match. There is no new damage to charge for.",
  confidence: "high",
};

/** The faint-mark demo photo, based on a Sonnet 5.5 answer: noticed, not charged, and the host decides. */
export const MOCK_FAINT_MARK: Verdict = {
  new_damage: false,
  findings: [],
  worth_a_look: [
    {
      description: "Small cluster of light scratch marks on the floor, right of centre, not visible in the same spot at check-in.",
      box: { x: 0.68, y: 0.685, w: 0.105, h: 0.085 },
      charge_cents: 7_500,
    },
  ],
  reasoning: "The furniture, rug and floor planks match between the two photos, apart from camera position and lighting. One small scratch cluster on the floor appears at check-out, but it is faint, so it isn't charged and is left for the host to check.",
  confidence: "medium",
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
  // A finding the model listed and then declined to charge is the same thing: seen, not charged.
  const noticed = verdict.new_damage ? verdict.worth_a_look : [...verdict.findings, ...verdict.worth_a_look];
  const worthALook = noticed
    .flatMap((f) => {
      const box = clampBox(f.box);
      return box ? [{ description: f.description, box, chargeCents: Math.max(0, Math.round(f.charge_cents)) }] : [];
    })
    .slice(0, MAX_WORTH_A_LOOK);
  return {
    newDamage: verdict.new_damage,
    items,
    worthALook,
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
  const samePhoto = readPhoto(check_in).equals(readPhoto(check_out));
  const { data, mocked, model, costUsd } = await compareImages({
    images: [image(check_in), image(check_out)],
    labels: ["Check-in photo", "Check-out photo"],
    question: QUESTION,
    schema: Verdict,
    mock: () => {
      failIfCreditOut(booking.id, "review");
      if (samePhoto) return MOCK_NO_DAMAGE;
      return check_out.src === DEMO_FAINT_CHECK_OUT.src ? MOCK_FAINT_MARK : MOCK_VERDICT;
    },
  });
  return toReview(data, booking.authorizedCents, { mocked, model: model ? modelLabel(model) : undefined, costUsd });
}
