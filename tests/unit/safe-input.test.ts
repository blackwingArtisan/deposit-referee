import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { describe, expect, it } from "vitest";
import { AiCreditError, RateLimitedError } from "@/lib/ai/errors";
import { respondAsRenter } from "@/lib/deposit/renter";
import { isReadablePhoto, UNREADABLE_PHOTO } from "@/lib/deposit/image-check";
import { saveUpload } from "@/lib/deposit/photos";
import { AI_BUSY, AI_DIDNT_FINISH, AI_UNREADABLE_PHOTO, plainAgentError, plainAiError } from "@/lib/deposit/plain-errors";
import { parseCharge, parseDeposit, parseLineAmount, photoChangeBlocked } from "@/lib/deposit/rules";
import { HttpError } from "@/lib/http";
import { heldBooking, proposedBooking } from "./deposit-fixtures";

const demo = (name: string) => fs.readFileSync(path.join(process.cwd(), "public/demo-photos", name));

/** A real 2x2 PNG, built here so the test needs no file. */
function tinyPng(): Buffer {
  const chunk = (type: string, body: Buffer) => {
    const head = Buffer.alloc(4);
    head.writeUInt32BE(body.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(Buffer.concat([Buffer.from(type, "latin1"), body])));
    return Buffer.concat([head, Buffer.from(type, "latin1"), body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(2, 0);
  ihdr.writeUInt32BE(2, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const rows = Buffer.alloc(2 * (1 + 2 * 3), 0x7f);
  rows[0] = rows[7] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(rows)), chunk("IEND", Buffer.alloc(0))]);
}

const dataUrl = (bytes: Buffer, type: string) => `data:${type};base64,${bytes.toString("base64")}`;

describe("safe input: amounts", () => {
  it.each(["-5", "-0.01", " -150.00"])("a negative line amount (%s) is a plain message", (value) => {
    expect(parseLineAmount(value)).toEqual({ error: "An amount can't be below zero." });
    expect(parseCharge(value, 30_000).error).toBe("An amount can't be below zero.");
  });

  it.each(["abc", "1e9", "12.345", "", "$"])("a non-numeric line amount (%s) is a plain message, never a throw", (value) => {
    expect(() => parseLineAmount(value)).not.toThrow();
    expect(parseLineAmount(value).error).toBeTruthy();
  });

  it("zero still drops a line", () => {
    expect(parseLineAmount("0")).toEqual({ cents: 0 });
  });

  it.each(["-5", "0", "0.50", "999999999", "500.01", "abc", ""])("a deposit of %s says the range", (value) => {
    expect(parseDeposit(value)).toEqual({ error: "Enter a deposit from $1 to $500, like 300.00." });
  });

  it.each([["1", 100], ["300.00", 30_000], ["500", 50_000]])("a deposit of %s is fine", (value, cents) => {
    expect(parseDeposit(value)).toEqual({ cents });
  });
});

describe("safe input: photos", () => {
  it("the demo JPEGs and a real PNG are readable", () => {
    for (const name of fs.readdirSync(path.join(process.cwd(), "public/demo-photos"))) expect(isReadablePhoto(demo(name), "image/jpeg"), name).toBe(true);
    expect(isReadablePhoto(tinyPng(), "image/png")).toBe(true);
  });

  it("a fake or cut-off image is not", () => {
    const fakePng = Buffer.concat([tinyPng().subarray(0, 8), Buffer.from("this is not a picture at all, just text after a PNG signature")]);
    const cutPng = tinyPng().subarray(0, 40);
    const jpeg = demo("cabin-check-in.jpg");
    const cutJpeg = jpeg.subarray(0, Math.floor(jpeg.length / 3));
    const fakeJpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.from("not a jpeg".repeat(20))]);
    const badCrc = Buffer.from(tinyPng());
    badCrc[20] ^= 0xff;
    for (const [bytes, type] of [[fakePng, "image/png"], [cutPng, "image/png"], [badCrc, "image/png"], [cutJpeg, "image/jpeg"], [fakeJpeg, "image/jpeg"], [Buffer.from("RIFF0000WEBPVP8 nope"), "image/webp"]] as const) {
      expect(isReadablePhoto(bytes, type)).toBe(false);
    }
  });

  it("an upload that isn't a readable photo is refused before it is kept, so the AI never sees it", async () => {
    const held = await heldBooking(30_000);
    const fake = Buffer.concat([tinyPng().subarray(0, 8), Buffer.from("junk".repeat(50))]);
    expect(() => saveUpload(held.id, "check_out", dataUrl(fake, "image/png"))).toThrow(UNREADABLE_PHOTO);
    try {
      saveUpload(held.id, "check_out", dataUrl(fake, "image/png"));
    } catch (e) {
      expect(e).toBeInstanceOf(HttpError);
      expect((e as HttpError).status).toBe(400);
    }
    expect(saveUpload(held.id, "check_out", dataUrl(tinyPng(), "image/png")).mediaType).toBe("image/png");
  });

  it("the host can replace photos until the renter answers or money moves", async () => {
    const held = await heldBooking(30_000);
    expect(photoChangeBlocked(held)).toBeNull();
    const proposed = await proposedBooking(30_000);
    expect(proposed.status).toBe("proposed");
    expect(photoChangeBlocked(proposed)).toBeNull();
    respondAsRenter(proposed.renterToken, "accepted");
    const { requireBooking } = await import("@/lib/deposit/bookings");
    expect(photoChangeBlocked(requireBooking(proposed.id))).toMatch(/can't change now/);
    expect(photoChangeBlocked({ status: "reviewed", partCapture: { captureId: "X" } })).toMatch(/can't change now/);
    expect(photoChangeBlocked({ status: "settled", settlement: { captureId: "X" } })).toMatch(/can't change now/);
    expect(photoChangeBlocked({ status: "draft" })).toMatch(/once the deposit is on hold/);
  });
});

describe("safe input: AI errors in plain words", () => {
  const apiError = (status: number, message: string) => Object.assign(new Error(`${status} ${JSON.stringify({ type: "error", error: { type: "invalid_request_error", message } })}`), { status, request_id: "req_011CVabc" });

  it("a photo Claude can't read says to replace it", () => {
    const e = plainAiError(apiError(400, "Could not process image"));
    expect(e).toBeInstanceOf(HttpError);
    expect((e as HttpError).status).toBe(422);
    expect(e.message).toBe(AI_UNREADABLE_PHOTO);
  });

  it("busy and anything else are plain, with no JSON or request id", () => {
    expect(plainAiError(apiError(529, "Overloaded")).message).toBe(AI_BUSY);
    expect(plainAiError(apiError(429, "rate_limit_error")).message).toBe(AI_BUSY);
    const other = plainAiError(apiError(500, "Internal server error"));
    expect(other.message).toBe(AI_DIDNT_FINISH);
    for (const e of [other, plainAiError(apiError(529, "Overloaded"))]) expect(e.message).not.toMatch(/[{}]|req_/);
  });

  it("errors that are already plain pass through", () => {
    const credit = new AiCreditError();
    const limited = new RateLimitedError(30);
    const http = new HttpError(409, "This booking isn't ready for a review.", "conflict");
    expect(plainAiError(credit)).toBe(credit);
    expect(plainAiError(limited)).toBe(limited);
    expect(plainAiError(http)).toBe(http);
  });

  it("the settlement agent's stop reason loses raw JSON and request ids", () => {
    expect(plainAgentError("The agent ran out of steps.")).toBe("The agent ran out of steps.");
    const raw = plainAgentError('529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"},"request_id":"req_011CV"}');
    expect(raw).toBe(AI_BUSY);
    expect(plainAgentError('400 {"error":{"message":"bad"}}')).not.toMatch(/[{}]|req_/);
  });
});

describe("safe input: big amounts read as one", () => {
  it("groups thousands", async () => {
    const { formatCents, formatExactCents } = await import("@/lib/deposit/rules");
    expect(formatExactCents(99_999_900)).toBe("$999,999.00");
    expect(formatCents(100_000)).toBe("$1,000");
    expect(formatExactCents(30_000)).toBe("$300.00");
    expect(formatCents(15_050)).toBe("$150.50");
  });
});
