import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { overreachScript, runLimitTest, runSettlementAgent } from "@/agents/settlement";
import { captureDeposit } from "@/agents/tools/capture-deposit";
import { proposeSettlement } from "@/agents/tools/propose-settlement";
import { appConfig } from "@/app.config";
import { getApprovals } from "@/lib/agent/approvals";
import { getAuditLog } from "@/lib/agent/audit";
import { runTool } from "@/lib/agent/execute";
import { Guard } from "@/lib/agent/guard";
import { requireBooking, saveBooking } from "@/lib/deposit/bookings";
import { toDepositRow } from "@/lib/deposit/insights";
import { saveHostLines } from "@/lib/deposit/proposal";
import { renterView, respondAsRenter } from "@/lib/deposit/renter";
import { assertCaptureLimits, itemizedCents, renterClearance, RENTER_WINDOW_HOURS } from "@/lib/deposit/rules";
import { requestRelease, requestSettlement } from "@/lib/deposit/settle";
import { getPayPal } from "@/lib/paypal";
import { acceptedBooking, heldBooking, holdStatus, paypal, proposedBooking, waitForApproval } from "./deposit-fixtures";

const toolContext = () => ({ runId: `test_${Math.random()}`, actor: "agent:test", channel: "test", guard: new Guard({ paypal: getPayPal(), policy: appConfig.agentPolicy }) });

beforeEach(async () => {
  await paypal().reset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the agent proposes and stops", () => {
  it("itemizes the damage and moves no money", async () => {
    const booking = await proposedBooking();
    expect(booking.status).toBe("proposed");
    expect(booking.proposal).toMatchObject({ kind: "charge", aiCents: 15_000, simulated: true });
    expect(booking.proposal!.lines.map((line) => line.amountCents)).toEqual([15_000]);
    expect(await holdStatus(booking.authorizationId)).toBe("CREATED");
    expect(getApprovals().list({ state: "pending" })).toEqual([]);
  });

  it("can't be run into a second proposal", async () => {
    const booking = await proposedBooking();
    const { review } = requireBooking(booking.id);
    const result = await runTool(proposeSettlement, { booking_id: booking.id, decision: "charge", amount_cents: 1_000, items: [{ finding: 0, amount_cents: 1_000, note: "Again" }], rationale: "Again" }, toolContext());
    expect(result.isError).toBe(true);
    expect(requireBooking(booking.id).proposal?.aiCents).toBe(15_000);
    expect(review).toBeDefined();
  });

  it("records why when the agent stops without a proposal", async () => {
    const held = await heldBooking();
    saveBooking({ ...held, status: "reviewed", review: { newDamage: true, confidence: "high", reasoning: "x", items: [], suggestedCents: 0, cappedToHold: false, model: "m", mocked: true, costUsd: 0 } as never });
    vi.spyOn(paypal().payments, "getAuthorization").mockRejectedValue(new Error("PayPal is down"));
    const after = await runSettlementAgent(held.id, "test");
    vi.restoreAllMocks();
    expect(after.status).toBe("reviewed");
    expect(after.agentError).toBeTruthy();
  });

  it("proposes a full release when nothing is new", async () => {
    const booking = await proposedBooking(20_000, true);
    expect(booking.proposal).toMatchObject({ kind: "release", aiCents: 0, lines: [] });
    expect(await holdStatus(booking.authorizationId)).toBe("CREATED");
  });
});

describe("the limits are code", () => {
  it("assertCaptureLimits refuses above the itemized total or the hold", () => {
    expect(() => assertCaptureLimits(10_000, 10_000, 20_000)).not.toThrow();
    expect(() => assertCaptureLimits(10_001, 10_000, 20_000)).toThrow(/itemized/);
    expect(() => assertCaptureLimits(20_001, 30_000, 20_000)).toThrow(/more than/);
    expect(() => assertCaptureLimits(0, 10_000, 20_000)).toThrow();
  });

  it("a script asking for too much is refused every time, and the hold is untouched", async () => {
    const booking = await proposedBooking();
    const steps = overreachScript(booking);
    expect(steps.filter((step) => step.tool)).toHaveLength(3);

    await runLimitTest(booking.id, "test");

    const log = getAuditLog().list().filter((entry) => entry.actor === "agent:limit-test");
    const refused = log.filter((entry) => entry.action === "tool.failed");
    expect(refused.map((entry) => entry.tool)).toEqual(["propose_settlement", "capture_deposit", "capture_deposit"]);
    expect(refused[1].reason).toMatch(/more than/);
    expect(refused[2].reason).toMatch(/itemized/);
    expect(log.filter((entry) => entry.action === "tool.executed")).toEqual([]);
    expect(requireBooking(booking.id).proposal?.aiCents).toBe(15_000);
    expect(requireBooking(booking.id).status).toBe("proposed");
    expect(await holdStatus(booking.authorizationId)).toBe("CREATED");
    expect(getApprovals().list({ state: "pending" })).toEqual([]);
  });

  it("an agent can't capture directly, even within the limits and with the renter's OK", async () => {
    const booking = await acceptedBooking();
    const result = await runTool(captureDeposit, { booking_id: booking.id, amount_cents: 15_000 }, toolContext());
    expect(result.isError).toBe(true);
    expect(result.content).toMatch(/hasn't asked/);
    expect(await holdStatus(booking.authorizationId)).toBe("CREATED");
  });

  it("the agent has no money tool of its own", async () => {
    const { settlementAgent } = await import("@/agents/settlement");
    const tools = settlementAgent.tools();
    expect(tools.filter((tool) => tool.risk === "money")).toEqual([]);
    expect(tools.map((tool) => tool.name)).toEqual(["read_damage_review", "get_order", "get_authorization", "propose_settlement"]);
  });

  it("refuses more than the itemized lines even when the hold would cover it", async () => {
    const booking = await acceptedBooking();
    expect(() => requestSettlement(booking.id, 15_001, "test")).toThrow(/itemized/);
    expect(requireBooking(booking.id).status).toBe("proposed");
  });

  it("re-checks the limits at capture time, after the approval", async () => {
    const booking = await acceptedBooking();
    const { finished } = requestSettlement(booking.id, 15_000, "test");
    const approval = await waitForApproval(booking.id);
    const after = requireBooking(booking.id);
    saveBooking({ ...after, proposal: { ...after.proposal!, lines: [{ ...after.proposal!.lines[0], amountCents: 10_000 }] } });
    getApprovals().decide(approval.id, "approved");
    await finished;
    expect(requireBooking(booking.id).status).toBe("proposed");
    expect(requireBooking(booking.id).settlement?.error).toMatch(/itemized/);
    expect(await holdStatus(booking.authorizationId)).toBe("CREATED");
  });
});

describe("a full release", () => {
  it("waits for approval, then voids the hold and reads it back from PayPal", async () => {
    const booking = await proposedBooking(30_000, true);
    const { finished } = requestRelease(booking.id, "test");
    const approval = await waitForApproval(booking.id);
    expect(await holdStatus(booking.authorizationId)).toBe("CREATED");

    getApprovals().decide(approval.id, "approved");
    await finished;

    const settled = requireBooking(booking.id);
    expect(settled.status).toBe("settled");
    expect(settled.settlement).toMatchObject({ kind: "release", capturedCents: 0, releasedCents: 30_000, authorizationStatus: "VOIDED" });
    expect(await holdStatus(booking.authorizationId)).toBe("VOIDED");
  });

  it("a declined release moves nothing and stays open", async () => {
    const booking = await proposedBooking(20_000, true);
    const { finished } = requestRelease(booking.id, "test");
    getApprovals().decide((await waitForApproval(booking.id)).id, "denied", "you");
    await finished;
    expect(requireBooking(booking.id).status).toBe("proposed");
    expect(await holdStatus(booking.authorizationId)).toBe("CREATED");
    expect(() => requestRelease(booking.id, "test")).not.toThrow();
    getApprovals().decide((await waitForApproval(booking.id)).id, "denied", "you");
  });

  it("the host can release instead of a proposed charge, and the renter needn't answer", async () => {
    const booking = await proposedBooking();
    const { finished } = requestRelease(booking.id, "test");
    getApprovals().decide((await waitForApproval(booking.id)).id, "approved");
    await finished;
    expect(requireBooking(booking.id).settlement).toMatchObject({ capturedCents: 0, releasedCents: 20_000 });
  });
});

describe("the renter's say", () => {
  it("blocks a charge until the renter answers", async () => {
    const booking = await proposedBooking();
    expect(() => requestSettlement(booking.id, 15_000, "test")).toThrow(/renter/i);
    expect(requireBooking(booking.id).status).toBe("proposed");
  });

  it("the view shows the proposal and evidence, and nothing private", async () => {
    const booking = await proposedBooking();
    const view = renterView(booking.renterToken);
    expect(view).toMatchObject({ chargeCents: 15_000, releaseCents: 5_000, canAccept: true, canContest: true });
    expect(view.proposal?.lines).toHaveLength(1);
    expect(view.photos.check_out).toBeDefined();
    const json = JSON.stringify(view);
    expect(json).not.toContain(booking.authorizationId);
    expect(json).not.toContain(booking.orderId);
  });

  it("a contest stops the charge and brings the note back to the host", async () => {
    const booking = await proposedBooking();
    expect(() => respondAsRenter(booking.renterToken, "contested")).toThrow(/why/);
    respondAsRenter(booking.renterToken, "contested", "That scratch was there when I arrived.");

    const after = requireBooking(booking.id);
    expect(after.status).toBe("contested");
    expect(after.renterState?.response).toMatchObject({ decision: "contested", note: "That scratch was there when I arrived.", amountCents: 15_000 });
    expect(await holdStatus(booking.authorizationId)).toBe("CREATED");
    expect(() => respondAsRenter(booking.renterToken, "contested", "Again")).toThrow(/already/);
    expect(() => respondAsRenter(booking.renterToken, "accepted")).toThrow(/already/);
  });

  it("a contest during the approval wait turns the approval down", async () => {
    const booking = await acceptedBooking();
    const { finished } = requestSettlement(booking.id, 15_000, "test");
    const approval = await waitForApproval(booking.id);

    respondAsRenter(booking.renterToken, "contested", "Changed my mind.");
    await finished;

    expect(getApprovals().get(approval.id)?.state).toBe("denied");
    const after = requireBooking(booking.id);
    expect(after.status).toBe("contested");
    expect(after.settlement?.error).toMatch(/renter contested/);
    expect(await holdStatus(booking.authorizationId)).toBe("CREATED");
  });

  it("after a contest the host decides with the note in view, and can't go higher", async () => {
    const booking = await proposedBooking();
    respondAsRenter(booking.renterToken, "contested", "Too much.");
    expect(() => saveHostLines(booking.id, { lines: [], add: { description: "More", amountCents: 100 } })).toThrow(/only go down/);

    const lowered = saveHostLines(booking.id, { lines: [{ id: "ai-0", amountCents: 5_000 }] });
    expect(itemizedCents(lowered.proposal!.lines)).toBe(5_000);

    const { finished } = requestSettlement(booking.id, 5_000, "test");
    getApprovals().decide((await waitForApproval(booking.id)).id, "approved");
    await finished;
    expect(requireBooking(booking.id).settlement).toMatchObject({ capturedCents: 5_000, releasedCents: 15_000, contestHeard: true });
  });

  it("a raise goes back to the renter, and lowering needs nothing new", async () => {
    const booking = await acceptedBooking();
    const lowered = saveHostLines(booking.id, { lines: [{ id: "ai-0", amountCents: 12_000 }] });
    expect(lowered.renterState?.response?.decision).toBe("accepted");

    const raised = saveHostLines(booking.id, { lines: [{ id: "ai-0", amountCents: 18_000 }] });
    expect(raised.renterState?.response).toBeUndefined();
    expect(raised.proposal!.aiCents).toBe(15_000);
    expect(raised.proposal!.lines[0]).toMatchObject({ amountCents: 18_000, aiCents: 15_000 });
    expect(() => requestSettlement(booking.id, 18_000, "test")).toThrow(/renter/i);

    expect(() => saveHostLines(booking.id, { lines: [{ id: "ai-0", amountCents: 20_001 }] })).toThrow(/more than the hold/);
  });

  it("accepting a lower number doesn't clear a higher one", () => {
    const accepted = { deadline: new Date(Date.now() + 3_600_000).toISOString(), response: { decision: "accepted" as const, amountCents: 5_000 } };
    expect(renterClearance(accepted, 5_000).cleared).toBe(true);
    expect(renterClearance(accepted, 5_001).cleared).toBe(false);
  });

  it("a silent renter stops blocking once the window lapses, and the host can go ahead", async () => {
    const booking = await proposedBooking();
    expect(renterClearance(booking.renterState, 15_000)).toMatchObject({ cleared: false, until: booking.renterState!.deadline });
    expect(renterClearance(booking.renterState, 15_000).reason).not.toMatch(/UTC|GMT/);
    const deadline = Date.parse(booking.renterState!.deadline);
    expect(deadline - Date.now()).toBeLessThanOrEqual(RENTER_WINDOW_HOURS * 3_600_000);
    expect(renterClearance(booking.renterState, 15_000, deadline + 1).cleared).toBe(true);
  });

  it("an unknown link gets nothing", () => {
    expect(() => renterView("not-a-real-token")).toThrow();
  });
});

describe("the dashboard row", () => {
  it("shows what's held, and the AI's number, before anything settles", async () => {
    const row = toDepositRow(await proposedBooking());
    expect(row).toMatchObject({ property: "Lakeside cabin", held: 200, charged: 0, released: 0, aiProposed: 150, hostChange: 0, hostChanged: "No", contested: "No" });
  });

  it("shows the money from the settled numbers and where the host changed the AI's figure", async () => {
    const booking = await acceptedBooking();
    saveHostLines(booking.id, { lines: [{ id: "ai-0", amountCents: 10_000 }] });
    const { finished } = requestSettlement(booking.id, 10_000, "test");
    getApprovals().decide((await waitForApproval(booking.id)).id, "approved");
    await finished;
    expect(toDepositRow(requireBooking(booking.id))).toMatchObject({ held: 0, charged: 100, released: 100, aiProposed: 150, hostChange: -50, hostChanged: "Yes" });
  });
});
