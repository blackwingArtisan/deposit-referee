import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { exifDateToIso, photoTakenAt, withExifDate } from "@/lib/deposit/exif";

const photo = () => new Uint8Array(fs.readFileSync("public/demo-photos/renter-check-in-stain.jpg"));

describe("the renter photo's EXIF date", () => {
  it("reads DateTimeOriginal with its offset, as a phone writes it", () => {
    expect(photoTakenAt(withExifDate(photo(), "2026-03-03T09:12:00.000Z", "-06:00"))).toBe("2026-03-03T09:12:00.000Z");
    expect(photoTakenAt(withExifDate(photo(), "2026-03-03T09:12:00.000Z"))).toBe("2026-03-03T09:12:00.000Z");
  });

  it("gives no date for a photo without EXIF, a PNG or a broken file", () => {
    expect(photoTakenAt(new Uint8Array(fs.readFileSync("public/demo-photos/cabin-check-in.jpg")))).toBeUndefined();
    expect(photoTakenAt(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeUndefined();
    expect(photoTakenAt(new Uint8Array([0xff, 0xd8, 0xff]))).toBeUndefined();
    expect(photoTakenAt(withExifDate(photo(), "2026-03-03T09:12:00.000Z").subarray(0, 30))).toBeUndefined();
  });

  it("the demo renter close-up carries its own date, before any take", () => {
    expect(photoTakenAt(photo())).toBe("2026-11-06T22:14:00.000Z");
  });

  it("parses EXIF's own date format, and refuses a zeroed one", () => {
    expect(exifDateToIso("2026:03:03 14:05:09", "+01:00")).toBe("2026-03-03T13:05:09.000Z");
    expect(exifDateToIso("2026:03:03 14:05:09")).toBe("2026-03-03T14:05:09.000Z");
    expect(exifDateToIso("0000:00:00 00:00:00")).toBeUndefined();
    expect(exifDateToIso("not a date")).toBeUndefined();
  });
});

describe("withoutExif", () => {
  it("gives back the same picture a dated copy was made from", async () => {
    const { withoutExif } = await import("@/lib/deposit/exif");
    expect(Buffer.from(withoutExif(withExifDate(photo(), "2026-03-03T09:12:00.000Z"))).equals(Buffer.from(withoutExif(photo())))).toBe(true);
  });
});
