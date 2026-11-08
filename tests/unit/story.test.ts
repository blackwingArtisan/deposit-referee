import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { appConfig } from "@/app.config";
import { BLIND_TEST } from "@/lib/deposit/blind-test";
import answers from "./blind-test-answers.json";

const readme = fs.readFileSync(path.join(process.cwd(), "README.md"), "utf8");
const research = (() => {
  try {
    return fs.readFileSync(path.join(process.cwd(), "../../round4/research/deposit-referee.md"), "utf8");
  } catch {
    return null; // not in a clean checkout of this repo alone
  }
})();

describe("first-visit story", () => {
  it("the blind-test panel's numbers are the saved answers' numbers", () => {
    const fresh = answers.filter((a) => a.pair.startsWith("fresh-"));
    const others = answers.filter((a) => !a.pair.startsWith("fresh-"));
    expect(fresh).toHaveLength(BLIND_TEST.pairs);
    expect(fresh.filter((a) => a.saved.charged > 0)).toHaveLength(3);
    expect(fresh.filter((a) => a.saved.looks > 0)).toHaveLength(1);
    // No more than 3 + 1 of the 10 got anything, so none of the 5 clean pairs was charged.
    expect(fresh.filter((a) => a.saved.charged > 0 || a.saved.looks > 0).length).toBeLessThanOrEqual(BLIND_TEST.pairs - 5 - BLIND_TEST.falseCharges);
    expect(others.every((a) => a.saved.charged > 0)).toBe(true);
    expect(BLIND_TEST.rows[2].pairs).toBe(others.length);
  });

  it("the headline and every pain point link their sources, and the README carries the same ones", () => {
    const { landing } = appConfig;
    expect(landing.headline).toBe("More than half of hosts have had a guest damage their place.");
    const links = [...landing.headlineSources, ...landing.painPoints.flatMap((p) => p.sources)].map((s) => s.href);
    for (const href of links) {
      expect(href).toMatch(/^https:\/\//);
      expect(readme).toContain(href);
      if (research) expect(research).toContain(href);
    }
    expect(readme).toContain("More than half of hosts have had a guest damage their place");
  });

  it("no claim that partial capture is unique to PayPal", () => {
    const copy = JSON.stringify(appConfig) + readme;
    expect(copy).not.toMatch(/only PayPal can|(?<!isn't )unique to PayPal|no other (provider|processor)/i);
    expect(readme).toContain("Partial capture itself isn't unique to PayPal");
    expect(copy).toMatch(/29 days/);
    expect(copy).toMatch(/capture from it more than once|several captures|more captures/i);
  });

  it("the hero's example is the README's: $150 of a $300 hold", () => {
    expect(readme).toContain("$150 captured, $150 released");
    const hero = fs.readFileSync(path.join(process.cwd(), "src/components/marketing/landing.tsx"), "utf8");
    expect(hero).toContain("Proposed $150.00 of the $300.00 hold");
    expect(hero).toContain('money: { v: "150.00", d: "in" as const }');
  });
});

describe("sample bookings carry their PayPal calls", () => {
  it("files each sample's hold, capture and void under it as it is placed", async () => {
    const { collection } = await import("@/lib/store/collection");
    const { getPayPal } = await import("@/lib/paypal");
    const { bookingEvents } = await import("@/lib/deposit/booking-events");
    const { sampleBookingId, seedSampleBookings } = await import("@/lib/deposit/sample-bookings");
    collection("bookings").replaceAll([]);
    await seedSampleBookings(getPayPal(), {});
    const calls = (key: string) => bookingEvents(sampleBookingId(key)).filter((e) => e.paypal);
    expect(calls("pine-ridge").length).toBeGreaterThanOrEqual(2);
    const harbor = calls("harbor").map((e) => e.paypal!.path);
    expect(harbor.some((p) => /capture/.test(p))).toBe(true);
    expect(harbor.some((p) => /void/.test(p))).toBe(true);
    expect(calls("hilltop").some((e) => /void/.test(e.paypal!.path))).toBe(true);
  });

  it("after a fresh boot that reuses the saved PayPal ids (the hosted site), each sample still has its calls on disk", async () => {
    const fs = await import("node:fs");
    const { collection } = await import("@/lib/store/collection");
    const { dataPath } = await import("@/lib/store/files");
    const { getPayPal } = await import("@/lib/paypal");
    const { bookingEvents } = await import("@/lib/deposit/booking-events");
    const { sampleBookingId, SAMPLES, seedSampleBookings } = await import("@/lib/deposit/sample-bookings");
    const manifest: Record<string, string> = {};
    collection("bookings").replaceAll([]);
    await seedSampleBookings(getPayPal(), manifest);
    // A redeploy or a wake from sleep: the disk is empty, the manifest of PayPal ids is not.
    collection("bookings").replaceAll([]);
    fs.rmSync(dataPath("booking-events"), { recursive: true, force: true });
    await seedSampleBookings(getPayPal(), manifest);
    for (const { key } of SAMPLES) {
      const calls = bookingEvents(sampleBookingId(key)).filter((e) => e.paypal && e.status === "succeeded");
      expect(calls.length, key).toBeGreaterThanOrEqual(1);
      expect(calls.every((e) => e.bookingId === sampleBookingId(key))).toBe(true);
    }
    expect(bookingEvents(sampleBookingId("harbor")).filter((e) => e.paypal && e.status === "succeeded").length).toBeGreaterThanOrEqual(2);
  });
});
