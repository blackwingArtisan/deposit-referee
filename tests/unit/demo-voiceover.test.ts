import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { CHARS_PER_SECOND, fitVoiceover, spokenChars } from "../../demo/voiceover";
import { requireBooking, saveBooking } from "@/lib/deposit/bookings";
import { DEMO_PHOTOS, saveUpload } from "@/lib/deposit/photos";
import { MOCK_TWO_MARKS, reviewPhotos } from "@/lib/deposit/review";
import { heldBooking, paypal } from "./deposit-fixtures";

beforeEach(async () => {
  await paypal().reset();
});

const jpeg = (file: string) => `data:image/jpeg;base64,${fs.readFileSync(path.join("public/demo-photos", file)).toString("base64")}`;

describe("the demo's voiceover script", () => {
  it("counts an amount as the characters it takes to say", () => {
    expect(spokenChars("A $300 hold.")).toBe("A ".length + 20 + " hold.".length);
    expect(spokenChars("$150.00 captured")).toBe(20 + " captured".length);
    expect(spokenChars("$20.50 back")).toBe(30 + " back".length);
  });

  it("keeps the long line where it fits and trims to the short one where it doesn't, never moving a shot", () => {
    // 71 characters: 4.7 s at 15 a second.
    const long = "one two three four five six seven eight nine ten eleven twelve thirteen";
    const script = fitVoiceover(
      [
        { shot: 2, at: 6, lines: [long, "short line"] },
        { shot: 1, at: 0, lines: [long, "short"] },
        { shot: 3, at: 8, lines: ["far too many words for the time that is left here at the end"] },
      ],
      10,
    );
    expect(script.map((l) => [l.shot, l.at, l.text, l.fits])).toEqual([
      [1, 0, long, true],
      [2, 6, "short line", true],
      [3, 8, "far too many words for the time that is left here at the end", false],
    ]);
    for (const line of script.filter((l) => l.fits)) expect(line.chars / CHARS_PER_SECOND).toBeLessThanOrEqual(line.room);
  });
});

describe("the demo uploads its photos like a host would", () => {
  it("an uploaded copy of the two-marks demo photo gets the two-marks mock, so the demo never opens Demo tools", async () => {
    const held = await heldBooking(30_000);
    saveBooking({ ...held, photos: { check_in: saveUpload(held.id, "check_in", jpeg("cabin-check-in.jpg")) } });
    const booking = saveBooking({ ...requireBooking(held.id), photos: { ...requireBooking(held.id).photos, check_out: saveUpload(held.id, "check_out", jpeg("cabin-check-out-two.jpg")) } });
    expect(booking.photos.check_out!.source.kind).toBe("upload");
    const review = await reviewPhotos(booking);
    expect(review.items.map((item) => item.description)).toEqual(MOCK_TWO_MARKS.findings.map((f) => f.description));
  });

  it("an uploaded copy of the one-gouge demo photo still gets the one-gouge mock", async () => {
    const held = await heldBooking(30_000);
    const booking = saveBooking({ ...held, photos: { check_in: DEMO_PHOTOS.check_in, check_out: saveUpload(held.id, "check_out", jpeg("cabin-check-out.jpg")) } });
    expect((await reviewPhotos(booking)).items).toHaveLength(1);
  });
});
