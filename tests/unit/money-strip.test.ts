import { describe, expect, it } from "vitest";
import { moneyLine, moneySteps } from "@/lib/deposit/money-strip";
import type { Booking } from "@/lib/deposit/types";

const settled = (over: Partial<Booking>) => ({ status: "settled", authorizedCents: 30_000, ...over }) as Booking;

describe("the money strip", () => {
  it("shows two captures from one hold, then the release", () => {
    const b = settled({ partCapture: { runId: "r", lines: [], requestedCents: 15_000, captureId: "C1", capturedCents: 15_000 }, settlement: { runId: "r2", kind: "charge", requestedCents: 2_000, captureId: "C2", capturedCents: 17_000, releasedCents: 13_000 } });
    expect(moneyLine(moneySteps(b)!)).toBe("$300 held → $150 captured → $20 captured → $130 released");
  });
  it("shows one capture, and a whole release as nothing captured", () => {
    expect(moneyLine(moneySteps(settled({ settlement: { runId: "r", kind: "charge", requestedCents: 25_000, captureId: "C", capturedCents: 25_000, releasedCents: 5_000 } }))!)).toBe("$300 held → $250 captured → $50 released");
    expect(moneyLine(moneySteps(settled({ settlement: { runId: "r", kind: "release", requestedCents: 0, capturedCents: 0, releasedCents: 30_000 } }))!)).toBe("$300 held → $0 captured → $300 released");
  });
  it("shows the accepted part and the release when the host lets the contested part go", () => {
    const b = settled({ partCapture: { runId: "r", lines: [], requestedCents: 15_000, captureId: "C1", capturedCents: 15_000 }, settlement: { runId: "r2", kind: "release", requestedCents: 0, capturedCents: 15_000, releasedCents: 15_000 } });
    expect(moneyLine(moneySteps(b)!)).toBe("$300 held → $150 captured → $150 released");
  });
  it("is absent until PayPal's amounts are in", () => {
    expect(moneySteps({ ...settled({}), status: "captured" } as Booking)).toBeNull();
    expect(moneySteps(settled({ settlement: { runId: "r", kind: "charge", requestedCents: 100 } }))).toBeNull();
  });
});
