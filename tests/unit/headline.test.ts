import { describe, expect, it } from "vitest";
import { hostHeadline, secondLookHeadline } from "@/lib/deposit/headline";
import type { ChargeLine, SecondLook, SecondLookLine } from "@/lib/deposit/types";

const line = (id: string, amountCents: number) => ({ id, description: id, amountCents }) as ChargeLine;
const proposal = { runId: "r", kind: "charge" as const, aiCents: 25_000, lines: [line("a", 15_000), line("b", 10_000)], rationale: "", proposedAt: "", engine: "", simulated: true };
const base = { depositCents: 30_000, authorizedCents: 30_000 };
const lookLine = (over: Partial<SecondLookLine>): SecondLookLine => ({ lineId: "b", description: "Stain", verdict: "new", reasoning: "", fromCents: 10_000, toCents: 10_000, withPhoto: true, ...over });
const look = (status: SecondLook["status"], lines: SecondLookLine[], counter = false): SecondLook => ({ status, startedAt: "", lines, mocked: true, costUsd: 0, ...(counter ? { counter: { runId: "c", rationale: "", engine: "", simulated: true, proposedAt: "" } } : {}) });
const part = { captureId: "CAP", requestedCents: 15_000, capturedCents: 15_000, contestedCents: 10_000, lines: [line("a", 15_000)] } as never;

describe("one money headline per state", () => {
  it("before and after the proposal", () => {
    expect(hostHeadline({ ...base, status: "draft", authorizedCents: undefined })).toBe("Waiting for the renter's $300.00 hold");
    expect(hostHeadline({ ...base, status: "held" })).toBe("$300.00 on hold, nothing charged");
    expect(hostHeadline({ ...base, status: "proposed", proposal })).toBe("Proposed: charge $250.00, release $50.00");
    expect(hostHeadline({ ...base, status: "proposed", proposal: { ...proposal, kind: "release", lines: [] } })).toBe("Proposed: release all $300.00");
  });

  it("through a contest and the second look", () => {
    const contested = { ...base, status: "contested" as const, proposal, partCapture: part };
    expect(hostHeadline(contested)).toBe("$150.00 charged · $100.00 contested, still on hold");
    expect(hostHeadline({ ...contested, secondLook: look("ready", [lookLine({ verdict: "unsure", flagged: true })]) })).toBe("$150.00 charged · Decide: keep or drop $100.00");
    expect(hostHeadline({ ...contested, secondLook: look("ready", [lookLine({ toCents: 5_000 })], true) })).toBe("$150.00 charged · Counter ready: $100.00 → $50.00");
    expect(hostHeadline({ ...contested, secondLook: look("sent", [lookLine({ toCents: 5_000 })], true) })).toBe("$150.00 charged · Counter with the renter: $50.00");
    expect(hostHeadline({ ...contested, secondLook: look("ready", [lookLine({})]) })).toBe("$150.00 charged · $100.00 contested, unchanged by the second look");
  });

  it("at the approval gate and settled", () => {
    expect(hostHeadline({ ...base, status: "awaiting_approval", approval: { id: "x", summary: "", reason: "", amountValue: "250.00" } })).toBe("Your approval: capture $250.00, release $50.00");
    expect(hostHeadline({ ...base, status: "awaiting_approval", partCapture: part, approval: { id: "x", summary: "", reason: "" } })).toBe("Your approval: release $150.00");
    expect(hostHeadline({ ...base, status: "settled", settlement: { capturedCents: 15_000, releasedCents: 15_000 } as never })).toBe("$150.00 captured, $150.00 released");
  });

  it("the second-look card", () => {
    expect(secondLookHeadline(look("running", []))).toBe("Claude is taking a second look");
    expect(secondLookHeadline(look("ready", [lookLine({ verdict: "unsure", flagged: true })]))).toBe("Claude can't tell on $100.00: you decide");
    expect(secondLookHeadline(look("ready", [lookLine({ verdict: "unsure", flagged: true, hostChoice: "drop", toCents: 0 })]))).toBe("Contested $100.00 → $0.00");
    expect(secondLookHeadline(look("ready", [lookLine({})]))).toBe("No change: $100.00 stands");
  });
});
