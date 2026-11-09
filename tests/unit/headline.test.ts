import { describe, expect, it } from "vitest";
import { approvalAction, approvalPlan } from "@/lib/deposit/approval-plan";
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
    const approval = { id: "x", summary: "", reason: "" };
    const charge = { kind: "charge", requestedCents: 25_000 } as never;
    expect(hostHeadline({ ...base, status: "awaiting_approval", settlement: charge, approval: { ...approval, amountValue: "250.00" } })).toBe("Your approval: capture $250.00, release $50.00");
    expect(hostHeadline({ ...base, status: "awaiting_approval", partCapture: part, settlement: { kind: "release" } as never, approval })).toBe("Your approval: release $150.00");
  });

  it("at the approval gate, the headline names what the Approve button moves, never another number", () => {
    const approval = { id: "x", summary: "", reason: "" };
    // The hosted take's bug: a $90 part capture on a $300 hold, the Guard's amount missing. It read "release $300.00".
    const pending = { runId: "p", requestedCents: 9_000, contestedCents: 5_000, lines: [line("a", 9_000)] } as never;
    const gate = { ...base, status: "awaiting_approval" as const, partCapture: pending, approval };
    const plan = approvalPlan(gate);
    expect(hostHeadline(gate)).toBe("Your approval: capture $90.00, keep $210.00 on hold");
    expect(hostHeadline(gate)).toContain(approvalAction(plan)!);
    // An amount on the Guard's approval that disagrees with the booking doesn't change the headline either.
    expect(hostHeadline({ ...gate, approval: { ...approval, amountValue: "300.00" } })).toBe("Your approval: capture $90.00, keep $210.00 on hold");
    // Nothing on the booking names an amount: neutral words, no number.
    const unknown = hostHeadline({ ...base, status: "awaiting_approval", approval });
    expect(unknown).toBe("Waiting for your approval: nothing moves until you decide");
    expect(unknown).not.toMatch(/\$/);
    expect(approvalAction(approvalPlan({ ...base }))).toBeNull();
    // Approved, PayPal answering: no "waiting for your approval" once the host has clicked.
    expect(hostHeadline({ ...gate, approval: null })).toBe("Working with PayPal");
    expect(hostHeadline({ ...base, status: "settled", settlement: { capturedCents: 15_000, releasedCents: 15_000 } as never })).toBe("$150.00 captured, $150.00 released");
  });

  it("the second-look card", () => {
    expect(secondLookHeadline(look("running", []))).toBe("Claude is taking a second look");
    expect(secondLookHeadline(look("ready", [lookLine({ verdict: "unsure", flagged: true })]))).toBe("Claude can't tell on $100.00: you decide");
    expect(secondLookHeadline(look("ready", [lookLine({ verdict: "unsure", flagged: true, hostChoice: "drop", toCents: 0 })]))).toBe("Contested $100.00 → $0.00");
    expect(secondLookHeadline(look("ready", [lookLine({})]))).toBe("No change: $100.00 stands");
  });
});
