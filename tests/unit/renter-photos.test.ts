import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { runSettlementAgent } from "@/agents/settlement";
import { requireBooking, saveBooking } from "@/lib/deposit/bookings";
import { DEMO_RENTER_CHECK_IN, DEMO_TWO_MARKS_CHECK_OUT, readPhoto } from "@/lib/deposit/photos";
import { addRenterPhoto, renterView } from "@/lib/deposit/renter";
import { comparisonPlan, HOST_ONLY_INTRO, MOCK_TWO_MARKS, reviewPhotos, toReview, type Verdict } from "@/lib/deposit/review";
import { heldBooking, paypal } from "./deposit-fixtures";

beforeEach(async () => {
  await paypal().reset();
});

const jpeg = (file: string) => `data:image/jpeg;base64,${fs.readFileSync(path.join("public/demo-photos", file)).toString("base64")}`;

async function twoMarksHeld() {
  const held = await heldBooking(30_000);
  return saveBooking({ ...held, photos: { ...held.photos, check_out: DEMO_TWO_MARKS_CHECK_OUT } });
}

describe("renter photos: the renter adds their own, and the comparison weighs them", () => {
  it("with no renter photos the comparison is exactly the one that passed the blind test", async () => {
    const plan = comparisonPlan(await twoMarksHeld());
    expect(plan.shown.map((s) => s.label)).toEqual(["Check-in photo", "Check-out photo"]);
    expect(plan.chargeQuestion.startsWith(`You are the neutral referee for a security deposit. ${HOST_ONLY_INTRO}`)).toBe(true);
    expect(plan.chargeQuestion).not.toContain("renter added");
    expect(plan.lookQuestion.startsWith(HOST_ONLY_INTRO)).toBe(true);
    expect(plan.asksPhoto).toBe(false);
  });

  it("shows the model the renter's photo, labelled, and tells it how to weigh it", async () => {
    const booking = await twoMarksHeld();
    addRenterPhoto(booking.renterToken, "check_in");
    const plan = comparisonPlan(requireBooking(booking.id));
    expect(plan.shown.map((s) => s.label)).toEqual(["Check-in photo (host)", "Check-in photo (renter)", "Check-out photo (host)"]);
    for (const question of [plan.chargeQuestion, plan.lookQuestion]) {
      expect(question).not.toContain(HOST_ONLY_INTRO);
      expect(question).toContain("The renter added a check-in photo of their own");
      expect(question).toContain("Damage that any check-in photo shows, the host's or the renter's, was already there");
      expect(question).toContain("Draw every box in the host's check-out photo.");
    }
    expect(plan.asksPhoto).toBe(false);
  });

  it("a renter's check-in photo that shows the stain keeps it off the charge, and each finding names its photo", async () => {
    const booking = await twoMarksHeld();
    const view = addRenterPhoto(booking.renterToken, "check_in");
    expect(view.renterPhotos.check_in).toEqual(DEMO_RENTER_CHECK_IN);
    const review = await reviewPhotos(requireBooking(booking.id));
    expect(review.renterPhotos).toEqual(["check_in"]);
    expect(review.items.map((item) => [item.price, item.chargeCents, item.photo])).toEqual([[{ type: "scratch", size: "large" }, 15_000, undefined]]);
    expect(review.reasoning).toContain("renter's own check-in photo");

    saveBooking({ ...requireBooking(booking.id), status: "reviewed", review });
    const proposed = await runSettlementAgent(booking.id, "test");
    expect(proposed.proposal!.lines).toHaveLength(1);
    expect(proposed.proposal!.lines[0].note).toContain("renter's check-in photo");
  });

  it("a renter's check-out photo can carry the box, and the model is asked which photo", async () => {
    const booking = await twoMarksHeld();
    addRenterPhoto(booking.renterToken, "check_out", jpeg("cabin-check-out-two.jpg"));
    const saved = requireBooking(booking.id);
    expect(saved.renterPhotos!.check_out!.source).toMatchObject({ kind: "upload", by: "renter" });
    expect(saved.renterPhotos!.check_out!.src).toBe(`/api/bookings/${booking.id}/photos/renter_check_out`);
    expect(readPhoto(saved.renterPhotos!.check_out!).equals(readPhoto(DEMO_TWO_MARKS_CHECK_OUT))).toBe(true);
    const plan = comparisonPlan(saved);
    expect(plan.shown.map((s) => s.label)).toEqual(["Check-in photo (host)", "Check-out photo (host)", "Check-out photo (renter)"]);
    expect(plan.chargeQuestion).toContain("set photo to the check-out photo you drew its box on");
    expect(plan.asksPhoto).toBe(true);

    // The answer says the stain is boxed on the renter's photo: the item keeps it.
    const answer: Verdict = { ...MOCK_TWO_MARKS, findings: [MOCK_TWO_MARKS.findings[0], { ...MOCK_TWO_MARKS.findings[1], photo: "renter_check_out" }] };
    const review = toReview(answer, 30_000, { mocked: true, costUsd: 0 });
    expect(review.items.map((item) => item.photo)).toEqual([undefined, "renter_check_out"]);
  });

  it("refuses a file that isn't a photo, before any AI", async () => {
    const booking = await twoMarksHeld();
    expect(() => addRenterPhoto(booking.renterToken, "check_in", `data:image/jpeg;base64,${Buffer.from("not a photo").toString("base64")}`)).toThrow(/JPEG, PNG or WebP/);
    expect(requireBooking(booking.id).renterPhotos).toBeUndefined();
  });

  it("closes once the host compares, and can't be used before the hold", async () => {
    const booking = await twoMarksHeld();
    addRenterPhoto(booking.renterToken, "check_in");
    expect(renterView(booking.renterToken).canAddPhotos).toBe(true);
    saveBooking({ ...requireBooking(booking.id), status: "reviewed", review: await reviewPhotos(requireBooking(booking.id)) });
    expect(renterView(booking.renterToken).canAddPhotos).toBe(false);
    expect(() => addRenterPhoto(booking.renterToken, "check_out", jpeg("cabin-check-in.jpg"))).toThrow(/already compared/);
  });
});
