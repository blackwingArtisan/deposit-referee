import { describe, expect, it } from "vitest";
import { assertChargeFits, assertHoldOpen, centsToDollars, dollarsToCents, formatCents, formatExactCents, holdClock, parseCharge, releasedCents } from "@/lib/deposit/rules";

describe("money rules", () => {
  it("released is authorized minus captured, in whole cents", () => {
    expect(releasedCents(20_000, 3_500)).toBe(16_500);
    expect(releasedCents(20_000, 20_000)).toBe(0);
    expect(releasedCents(10_001, 3_334)).toBe(6_667);
  });

  it("refuses captures above the hold, and anything that is not whole cents", () => {
    expect(() => releasedCents(20_000, 20_001)).toThrow(/more than/);
    expect(() => releasedCents(20_000, 35.5)).toThrow(/whole number of cents/);
    expect(() => releasedCents(20_000, -1)).toThrow(/whole number of cents/);
  });

  it("the charge must be above zero and fit the hold", () => {
    expect(() => assertChargeFits(0, 20_000)).toThrow(/at least/);
    expect(() => assertChargeFits(20_001, 20_000)).toThrow(/more than/);
    expect(() => assertChargeFits(20_000, 20_000)).not.toThrow();
  });

  it("converts without float drift", () => {
    expect(dollarsToCents("19.99")).toBe(1999);
    expect(dollarsToCents("1.10")).toBe(110);
    expect(centsToDollars(1999)).toBe("19.99");
    expect(() => dollarsToCents("1.999")).toThrow();
  });

  it("formats the headline and the exact amount", () => {
    expect(formatCents(3_500)).toBe("$35");
    expect(formatCents(3_550)).toBe("$35.50");
    expect(formatCents(16_500)).toBe("$165");
    expect(formatExactCents(3_500)).toBe("$35.00");
  });

  it("reads the host's input without throwing", () => {
    expect(parseCharge("150.00", 20_000)).toEqual({ cents: 15_000 });
    expect(parseCharge("abc", 20_000).error).toBeTruthy();
    expect(parseCharge("250", 20_000).error).toMatch(/more than/);
    expect(parseCharge("0", 20_000).error).toMatch(/at least/);
  });
});

describe("the 29-day hold", () => {
  const now = Date.parse("2026-11-01T12:00:00Z");
  const iso = (days: number) => new Date(now + days * 86_400_000).toISOString();

  it("counts down in whole days", () => {
    expect(holdClock(iso(29), now)).toMatchObject({ limitDays: 29, daysLeft: 29, expired: false, guaranteedUntil: iso(3) });
    expect(holdClock(iso(0.5), now)).toMatchObject({ daysLeft: 1, expired: false });
  });

  it("is expired at the exact end time and after", () => {
    expect(holdClock(iso(0), now)).toMatchObject({ daysLeft: 0, expired: true });
    expect(holdClock(iso(-1), now).expired).toBe(true);
  });

  it("refuses an expired hold", () => {
    expect(() => assertHoldOpen(iso(-1), now)).toThrow(/expired/);
    expect(() => assertHoldOpen(iso(1), now)).not.toThrow();
  });
});
