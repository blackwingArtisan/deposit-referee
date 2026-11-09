/**
 * The AI comparison, in two separate calls. The charge check is the prompt from the TK-39 vision
 * spike (Sonnet 5.5, 5 pairs, sealed key), and it stays strict: subtle marks aren't charged. When it
 * charges nothing, a second call looks for marks, which go to worth_a_look, where only the host can
 * turn them into a charge. They're separate because asking for both in one prompt made the model
 * less willing to charge: a large hole charged 2 of 2 alone came back worth a look 3 of 3 together.
 * The AI names each mark, its kind and size; the amount comes from the price table in prices.ts.
 * A faint or low-certainty mark is never charged, by code. Totals, the cap and the released
 * amount are worked out here.
 */
import { z } from "zod";
import { compareImages } from "@/lib/ai";
import { modelLabel } from "@/lib/ai/config";
import type { ImageMediaType } from "@/lib/ai/images";
import { failIfCreditOut } from "./credit-test";
import { DEMO_FAINT_CHECK_OUT, DEMO_RENTER_CHECK_IN, DEMO_TWO_MARKS_CHECK_OUT, readPhoto } from "./photos";
import { DAMAGE_SIZES, DAMAGE_TYPES, priceOf, type DamageSize, type DamageType, type PriceRow } from "./prices";
import type { Booking, BookingPhoto, DamageBox, DamageReview, FindingPhoto, PhotoSlot } from "./types";

const Box = z.object({
  x: z.number().describe("Left edge, 0-1, as a fraction of the check-out photo's width"),
  y: z.number().describe("Top edge, 0-1, as a fraction of the check-out photo's height"),
  w: z.number().describe("Width, 0-1"),
  h: z.number().describe("Height, 0-1"),
});

/** The most worth-a-look items a host is asked to check on one review. */
const MAX_WORTH_A_LOOK = 3;

const DamageType = z.enum(DAMAGE_TYPES).describe("The kind of damage: scratch (also a gouge), dent, chip, crack, stain, burn, tear, hole, marking (marker, crayon or scuff), broken (a broken or missing part)");
const DamageSize = z.enum(DAMAGE_SIZES).describe("small: coin-sized or smaller; medium: up to a hand's length; large: longer than a hand, or across a whole board or panel");

const Finding = z.object({
  description: z.string(),
  box: Box,
  damage_type: DamageType,
  size: DamageSize,
  visibility: z.enum(["clear", "faint"]).describe("clear: anyone would see it at a glance; faint: you have to look closely, or it could be a reflection, shadow or texture"),
  certainty: z.enum(["high", "medium", "low"]).describe("How sure you are that this damage is new since check-in"),
});

const Look = z.object({ description: z.string(), box: Box, damage_type: DamageType, size: DamageSize });

const Verdict = z.object({
  new_damage: z.boolean().describe("True only if the renter caused damage that isn't in the check-in photo"),
  findings: z.array(Finding).describe("One item per new damage; empty if none"),
  worth_a_look: z.array(Look).describe("Marks that may be new but you aren't sure enough to charge; empty if none"),
  reasoning: z.string().describe("Two or three sentences a renter could read and contest"),
  confidence: z.enum(["high", "medium", "low"]),
});
type WithPhoto<T> = T & { photo?: FindingPhoto };
/** The model's answer. `photo` is only asked for when the renter added a check-out photo. */
export type Verdict = Omit<z.infer<typeof Verdict>, "findings" | "worth_a_look"> & { findings: WithPhoto<VerdictFinding>[]; worth_a_look: WithPhoto<z.infer<typeof Look>>[] };
export type VerdictFinding = z.infer<typeof Finding>;

const ChargeVerdict = Verdict.omit({ worth_a_look: true });
const LookVerdict = Verdict.pick({ worth_a_look: true });

// With the renter's own check-out photo, each box says which check-out photo it is on.
const PhotoChoice = z.enum(["check_out", "renter_check_out"]).describe(`The check-out photo the box is drawn on: "check_out" for the host's, "renter_check_out" for the renter's`);
const RenterChargeVerdict = ChargeVerdict.extend({ findings: z.array(Finding.extend({ photo: PhotoChoice })).describe("One item per new damage; empty if none") });
const RenterLookVerdict = z.object({ worth_a_look: z.array(Look.extend({ photo: PhotoChoice })).describe("Marks that may be new but you aren't sure enough to charge; empty if none") });

const CHARGE_QUESTION = `You are the neutral referee for a security deposit. The first photo was taken at check-in and the second at check-out, of the same part of a rental. The renter's money is at stake, and a wrongful charge is the worst mistake you can make.

Decide whether the renter caused new damage.
- Charge only for damage that is visible at check-out and not visible at check-in.
- Anything already present at check-in is not the renter's responsibility.
- Differences in lighting, exposure, colour, camera position, framing or sharpness are not damage.
- Moved furniture or belongings are not damage.
- Ordinary wear and tear is not damage.
- If you can't be reasonably sure the damage is new, don't charge.

For each new damage, give a box around it in the check-out photo, name its kind and size, say whether it is clear or faint, and say how sure you are that it is new. Don't price it: the app prices each finding from a fixed table by kind and size.`;

export const HOST_ONLY_INTRO = "The first photo was taken at check-in and the second at check-out, of the same part of a rental.";

/**
 * The same question, told that the renter added photos of their own and how to weigh them. With
 * no renter photos the questions are used exactly as they are: the method that passed the blind test.
 */
export function withRenterPhotos(question: string, slots: PhotoSlot[]): string {
  const theirs = slots.map((slot) => (slot === "check_in" ? "a check-in photo" : "a check-out photo")).join(" and ");
  const intro = `The host took a check-in photo and a check-out photo of the same part of a rental. The renter added ${theirs} of their own, which may be a close-up or taken from another angle. Each photo is labelled with who took it.`;
  const rules = [
    "Weigh the renter's photos as evidence, the same as the host's:",
    "- Damage that any check-in photo shows, the host's or the renter's, was already there, so it isn't new.",
    ...(slots.includes("check_out")
      ? ["- If the renter's check-out photo shows the same spot undamaged, you can't be reasonably sure the damage is new.", "- For each item, set photo to the check-out photo you drew its box on."]
      : ["- Draw every box in the host's check-out photo."]),
  ];
  return `${question.replace(HOST_ONLY_INTRO, intro)}\n\n${rules.join("\n")}`;
}

const LOOK_QUESTION = `The first photo was taken at check-in and the second at check-out, of the same part of a rental. A strict damage review charged nothing. Check what it may have passed over.

Go over the check-out photo surface by surface (walls, floor, doors, cabinets, counters, tile, furniture) and compare each with the same spot in the check-in photo. If you find a specific mark (a scratch, scuff, chip, dent, crack, stain, burn or tear) that you can't see at check-in, list it in worth_a_look with a box around it in the check-out photo, and name its kind and size. The host will look at it, and it is never charged unless the host chooses to.
- List only one specific mark you can point to and box, never a general difference in a surface.
- Never list anything you can also see at check-in, or anything that isn't damage: differences in lighting, exposure, colour, camera position, framing or sharpness, shadows, reflections, glare, moved things, ordinary wear.
- Most stays have nothing worth a look, so an empty list is the normal answer.`;

/** A real answer from the vision spike on the demo photos (pair 1, run 1), with the fields the price table needs. */
export const MOCK_VERDICT: Verdict = {
  new_damage: true,
  findings: [
    {
      description: "Long thin scratch or gouge in the plank floor, with lighter material exposed along its length. It is not visible in the same floor area in the check-in photo.",
      box: { x: 0.44, y: 0.59, w: 0.09, h: 0.29 },
      damage_type: "scratch",
      size: "large",
      visibility: "clear",
      certainty: "high",
    },
  ],
  worth_a_look: [],
  reasoning: "The check-out photo shows a long, narrow scratch with a gouged, lighter edge across the plank floor. The same area in the check-in photo is clean, with only normal grain and seams. Lighting and camera angle differ, but they do not explain a distinct scratch like this. The charge covers repairing or replacing the affected plank.",
  confidence: "high",
};

/**
 * The two-marks demo photo: the gouge from MOCK_VERDICT plus the stain drawn for this demo. Written
 * for the demo, not a model's answer: what a live run should find is checked on the live site.
 */
export const MOCK_TWO_MARKS: Verdict = {
  new_damage: true,
  findings: [
    MOCK_VERDICT.findings[0],
    {
      description: "Dark red-brown stain on the floor planks, right of centre, about the size of a hand. The same planks are clean in the check-in photo.",
      box: { x: 0.685, y: 0.59, w: 0.115, h: 0.08 },
      damage_type: "stain",
      size: "medium",
      visibility: "clear",
      certainty: "high",
    },
  ],
  worth_a_look: [],
  reasoning: "The check-out photo shows two new marks on the plank floor that the check-in photo doesn't: a long scratch with a gouged, lighter edge, and a dark stain to its right. Lighting and camera angle differ, but they don't explain either mark.",
  confidence: "high",
};

/** The two-marks photos when the renter's own check-in close-up already shows the stain: only the gouge is new. */
export const MOCK_TWO_MARKS_RENTER_PROOF: Verdict = {
  new_damage: true,
  findings: [MOCK_VERDICT.findings[0]],
  worth_a_look: [],
  reasoning: "The renter's own check-in photo, a close-up of the floor, already shows the dark stain, so it was there before this stay and isn't charged. The long gouge isn't in either check-in photo, so it is new.",
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

const FAINT_MARK = {
  description: "Small cluster of light scratch marks on the floor, right of centre, not visible in the same spot at check-in.",
  box: { x: 0.68, y: 0.685, w: 0.105, h: 0.085 },
  damage_type: "scratch",
  size: "small",
} as const;

/**
 * The faint-mark demo photo as the round-4 live run answered it: the charge check called it new
 * damage. It says the mark is faint, so the code doesn't charge it and the second check runs.
 */
export const MOCK_FAINT_CHARGE_CHECK: Verdict = {
  new_damage: true,
  findings: [{ ...FAINT_MARK, visibility: "faint", certainty: "medium" }],
  worth_a_look: [],
  reasoning: "The furniture, rug and floor planks match between the two photos, apart from camera position and lighting. One small scratch cluster on the floor appears at check-out, but it is faint.",
  confidence: "medium",
};

/** The faint-mark demo photo, based on a Sonnet 5.5 answer: noticed, not charged, and the host decides. */
export const MOCK_FAINT_MARK: Verdict = {
  new_damage: false,
  findings: [],
  worth_a_look: [FAINT_MARK],
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

/**
 * Only a clear mark the model is fairly sure is new is charged. A faint one, or one it rates low,
 * goes to worth a look with no charge, whatever else the answer says. That's a code rule, so a
 * model that calls a faint scuff new damage still can't charge for it.
 */
const isCharge = (verdict: Pick<Verdict, "confidence">, finding: VerdictFinding) => finding.visibility === "clear" && finding.certainty !== "low" && verdict.confidence !== "low";
const chargesSomething = (verdict: Pick<Verdict, "new_damage" | "findings" | "confidence">) => verdict.new_damage && verdict.findings.some((f) => isCharge(verdict, f));

const overlaps = (a: DamageBox, b: DamageBox) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Boxes on the renter's photo keep that photo; anything else is on the host's check-out photo. */
const onPhoto = (f: { photo?: FindingPhoto }) => (f.photo === "renter_check_out" ? { photo: f.photo } : {});
const samePhoto = (a: { photo?: FindingPhoto }, b: { photo?: FindingPhoto }) => (a.photo ?? "check_out") === (b.photo ?? "check_out");

const priced = (f: { damage_type: DamageType; size: DamageSize }) => {
  const price: PriceRow = { type: f.damage_type, size: f.size };
  return { price, chargeCents: priceOf(price) };
};

/** Turns the model's answer into a record we trust: boxes on the photo, amounts from the price table, our own total. */
export function toReview(verdict: Verdict, authorizedCents: number, meta: { mocked: boolean; model?: string; costUsd: number; renterPhotos?: PhotoSlot[] }): DamageReview {
  const charged = chargesSomething(verdict);
  const items = charged ? verdict.findings.filter((f) => isCharge(verdict, f)).map((f) => ({ description: f.description, box: clampBox(f.box), ...priced(f), ...onPhoto(f) })) : [];
  const totalCents = items.reduce((sum, item) => sum + item.chargeCents, 0);
  // A finding the code won't charge is the same thing as a mark the second check found: seen, not charged.
  const declined = verdict.findings.filter((f) => !charged || !isCharge(verdict, f));
  const noticed = [...verdict.worth_a_look, ...declined.filter((f) => !verdict.worth_a_look.some((l) => samePhoto(l, f) && overlaps(l.box, f.box)))];
  const worthALook = noticed
    .flatMap((f) => {
      const box = clampBox(f.box);
      return box ? [{ description: f.description, box, ...priced(f), ...onPhoto(f) }] : [];
    })
    .slice(0, MAX_WORTH_A_LOOK);
  return {
    newDamage: charged,
    items,
    worthALook,
    reasoning: verdict.reasoning,
    confidence: verdict.confidence,
    suggestedCents: Math.min(totalCents, authorizedCents),
    cappedToHold: totalCents > authorizedCents,
    ...meta,
  };
}

/**
 * What the model is shown: the host's two photos, and the renter's own when they added any. With
 * none, the labels and questions are exactly the ones the blind test passed with.
 */
export function comparisonPlan(booking: Booking) {
  const { check_in, check_out } = booking.photos;
  if (!check_in || !check_out) throw new Error("A review needs both photos and a hold.");
  const renter = booking.renterPhotos ?? {};
  const renterSlots = (["check_in", "check_out"] as const).filter((slot) => renter[slot]);
  const shown: { photo: BookingPhoto; label: string }[] = renterSlots.length
    ? [
        { photo: check_in, label: "Check-in photo (host)" },
        ...(renter.check_in ? [{ photo: renter.check_in, label: "Check-in photo (renter)" }] : []),
        { photo: check_out, label: "Check-out photo (host)" },
        ...(renter.check_out ? [{ photo: renter.check_out, label: "Check-out photo (renter)" }] : []),
      ]
    : [
        { photo: check_in, label: "Check-in photo" },
        { photo: check_out, label: "Check-out photo" },
      ];
  return {
    shown,
    renterSlots,
    chargeQuestion: renterSlots.length ? withRenterPhotos(CHARGE_QUESTION, renterSlots) : CHARGE_QUESTION,
    lookQuestion: renterSlots.length ? withRenterPhotos(LOOK_QUESTION, renterSlots) : LOOK_QUESTION,
    /** Only a renter's check-out photo can hold a box, so only then is the model asked which photo. */
    asksPhoto: !!renter.check_out,
  };
}

export async function reviewPhotos(booking: Booking): Promise<DamageReview> {
  const { check_in, check_out } = booking.photos;
  if (!check_in || !check_out || booking.authorizedCents === undefined) throw new Error("A review needs both photos and a hold.");
  const image = (photo: BookingPhoto) => ({ base64: readPhoto(photo).toString("base64"), mediaType: photo.mediaType as ImageMediaType });
  const samePhoto = readPhoto(check_in).equals(readPhoto(check_out));
  const plan = comparisonPlan(booking);
  const images = plan.shown.map((s) => image(s.photo));
  const labels = plan.shown.map((s) => s.label);
  // A demo photo picked from Demo tools, or the same file uploaded the way a host would (the demo video does that).
  const isDemo = (photo: BookingPhoto | undefined, demo: BookingPhoto) => !!photo && (photo.src === demo.src || readPhoto(photo).equals(readPhoto(demo)));
  const faint = () => isDemo(check_out, DEMO_FAINT_CHECK_OUT);
  const mockVerdict = () => {
    if (samePhoto) return MOCK_NO_DAMAGE;
    if (isDemo(check_out, DEMO_TWO_MARKS_CHECK_OUT)) return isDemo(booking.renterPhotos?.check_in, DEMO_RENTER_CHECK_IN) ? MOCK_TWO_MARKS_RENTER_PROOF : MOCK_TWO_MARKS;
    return faint() ? MOCK_FAINT_MARK : MOCK_VERDICT;
  };
  const mockChargeCheck = () => (faint() ? MOCK_FAINT_CHARGE_CHECK : mockVerdict());
  const { data, mocked, model, costUsd } = await compareImages({
    images,
    labels,
    question: plan.chargeQuestion,
    // The renter's variant only adds `photo` to each finding, so it reads back as the same shape.
    schema: (plan.asksPhoto ? RenterChargeVerdict : ChargeVerdict) as typeof ChargeVerdict,
    mock: () => {
      failIfCreditOut(booking.id, "review");
      return mockChargeCheck();
    },
  });
  const look = chargesSomething(data)
    ? null
    : await compareImages({
        images,
        labels,
        question: plan.lookQuestion,
        schema: (plan.asksPhoto ? RenterLookVerdict : LookVerdict) as typeof LookVerdict,
        mock: () => ({ worth_a_look: mockVerdict().worth_a_look }),
      }).catch((err: unknown) => {
        // The charge check already has its answer, so a failed second look can't cost the review.
        console.error("worth-a-look check failed:", err instanceof Error ? err.message : err);
        return null;
      });
  const verdict: Verdict = { ...data, worth_a_look: look?.data.worth_a_look ?? [] };
  return toReview(verdict, booking.authorizedCents, {
    mocked,
    model: model ? modelLabel(model) : undefined,
    costUsd: costUsd + (look?.costUsd ?? 0),
    ...(plan.renterSlots.length ? { renterPhotos: [...plan.renterSlots] } : {}),
  });
}
