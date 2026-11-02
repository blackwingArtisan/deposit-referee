import { beforeEach, describe, expect, it } from "vitest";
import { readDamageReview, proposeSettlement } from "@/agents/tools/propose-settlement";
import { appConfig } from "@/app.config";
import { runSettlementAgent } from "@/agents/settlement";
import { runTool } from "@/lib/agent/execute";
import { getApprovals } from "@/lib/agent/approvals";
import { Guard } from "@/lib/agent/guard";
import { requireBooking, saveBooking } from "@/lib/deposit/bookings";
import { DEMO_FAINT_CHECK_OUT, DEMO_PHOTOS } from "@/lib/deposit/photos";
import { lookLineId, saveHostLines } from "@/lib/deposit/proposal";
import { renterView, respondAsRenter } from "@/lib/deposit/renter";
import { MOCK_FAINT_MARK, MOCK_VERDICT, reviewPhotos, toReview } from "@/lib/deposit/review";
import { requestSettlement } from "@/lib/deposit/settle";
import { getPayPal } from "@/lib/paypal";
import { heldBooking, holdStatus, paypal, waitForApproval } from "./deposit-fixtures";

const meta = { mocked: true, costUsd: 0 };
const look = { description: "Faint scuff", box: { x: 0.2, y: 0.3, w: 0.1, h: 0.1 }, charge_cents: 7_500 };
const toolContext = () => ({ runId: `test_${Math.random()}`, actor: "agent:test", channel: "test", guard: new Guard({ paypal: getPayPal(), policy: appConfig.agentPolicy }) });

/** The AI noticed something, charged nothing, and the agent proposed a release. */
async function flaggedBooking(depositCents = 30_000) {
  const held = await heldBooking(depositCents);
  const withFaint = saveBooking({ ...held, photos: { check_in: DEMO_PHOTOS.check_in, check_out: DEMO_FAINT_CHECK_OUT } });
  saveBooking({ ...withFaint, status: "reviewed", review: await reviewPhotos(withFaint) });
  return runSettlementAgent(held.id, "test");
}

beforeEach(async () => {
  await paypal().reset();
});

describe("what the review keeps", () => {
  it("never counts a worth-a-look item as a charge", () => {
    const review = toReview({ ...MOCK_VERDICT, worth_a_look: [look] }, 30_000, meta);
    expect(review.suggestedCents).toBe(MOCK_VERDICT.findings[0].charge_cents);
    expect(review.items).toHaveLength(1);
    expect(review.worthALook).toEqual([{ description: "Faint scuff", box: look.box, chargeCents: 7_500 }]);

    const clean = toReview({ ...MOCK_VERDICT, new_damage: false, findings: [], worth_a_look: [look] }, 30_000, meta);
    expect(clean).toMatchObject({ newDamage: false, items: [], suggestedCents: 0, cappedToHold: false });
    expect(clean.worthALook).toHaveLength(1);
  });

  it("keeps a finding the model listed and then declined to charge", () => {
    const review = toReview({ ...MOCK_VERDICT, new_damage: false, worth_a_look: [] }, 30_000, meta);
    expect(review.items).toEqual([]);
    expect(review.worthALook).toHaveLength(1);
  });

  it("drops an item with no box on the photo, and keeps three at most", () => {
    const off = { ...look, box: { x: 2, y: 2, w: 0.1, h: 0.1 } };
    const review = toReview({ ...MOCK_VERDICT, worth_a_look: [off, look, look, look, look] }, 30_000, meta);
    expect(review.worthALook).toHaveLength(3);
    expect(review.worthALook!.every((item) => item.box)).toBe(true);
  });
});

describe("the agent can't charge a worth-a-look item", () => {
  it("proposes a release and never sees the item", async () => {
    const booking = await flaggedBooking();
    expect(booking.review!.worthALook).toHaveLength(MOCK_FAINT_MARK.worth_a_look.length);
    expect(booking.proposal).toMatchObject({ kind: "release", aiCents: 0, lines: [] });
    const read = await runTool(readDamageReview, { booking_id: booking.id }, toolContext());
    expect(JSON.stringify(read.output)).not.toContain("scuff");
    expect(read.output).toMatchObject({ findings: [], max_charge_cents: 0 });
  });

  it("is refused if it names one as a finding", async () => {
    const held = await heldBooking();
    saveBooking({ ...held, status: "reviewed", review: await reviewPhotos({ ...held, photos: { check_in: DEMO_PHOTOS.check_in, check_out: DEMO_FAINT_CHECK_OUT } }) });
    const result = await runTool(proposeSettlement, { booking_id: held.id, decision: "charge", amount_cents: 1_000, items: [{ finding: 0, amount_cents: 1_000, note: "Trying the flagged mark" }], rationale: "A charge for the flagged mark." }, toolContext());
    expect(result.isError).toBe(true);
    expect(requireBooking(held.id).proposal).toBeUndefined();
  });
});

describe("the host adds one to the charge", () => {
  it("goes through the renter and the approval gate like any other line", async () => {
    const booking = await flaggedBooking();
    const { box, chargeCents, description } = booking.review!.worthALook![0];
    expect(renterView(booking.renterToken).proposal!.lines).toEqual([]);

    const added = saveHostLines(booking.id, { lines: [], addLook: 0 });
    const line = added.proposal!.lines[0];
    expect(line).toMatchObject({ id: lookLineId(0), description, box, amountCents: chargeCents });
    expect(line.aiCents).toBeUndefined();
    expect(added.proposal!.aiCents).toBe(0);

    // Nothing moved, and the renter now sees the line with its box.
    expect(await holdStatus(booking.authorizationId)).toBe("CREATED");
    expect(getApprovals().list({ state: "pending" })).toEqual([]);
    const seen = renterView(booking.renterToken);
    expect(seen).toMatchObject({ chargeCents, canAccept: true, canContest: true });
    expect(seen.proposal!.lines[0].box).toEqual(box);

    // The same gate as a line the AI proposed: no charge before the renter answers.
    expect(() => requestSettlement(booking.id, chargeCents, "test")).toThrow(/renter/i);
    respondAsRenter(booking.renterToken, "accepted");

    const { finished } = requestSettlement(booking.id, chargeCents, "test");
    const approval = await waitForApproval(booking.id);
    expect(await holdStatus(booking.authorizationId)).toBe("CREATED");
    getApprovals().decide(approval.id, "approved");
    await finished;
    const after = requireBooking(booking.id);
    expect(after.settlement).toMatchObject({ kind: "charge", capturedCents: chargeCents, releasedCents: 30_000 - chargeCents, authorizationStatus: "VOIDED" });
  });

  it("can't be charged above what the renter last saw", async () => {
    const booking = await flaggedBooking();
    const added = saveHostLines(booking.id, { lines: [], addLook: 0 });
    respondAsRenter(added.renterToken, "accepted");
    const amount = added.proposal!.lines[0].amountCents;
    expect(() => requestSettlement(booking.id, amount + 1, "test")).toThrow();
  });

  it("can only be added once, and only if the review has it", async () => {
    const booking = await flaggedBooking();
    saveHostLines(booking.id, { lines: [], addLook: 0 });
    expect(() => saveHostLines(booking.id, { lines: [], addLook: 0 })).toThrow(/already on the charge/);
    expect(() => saveHostLines(booking.id, { lines: [], addLook: 9 })).toThrow(/isn't in the photo review/);
    expect(requireBooking(booking.id).proposal!.lines).toHaveLength(1);
  });

  it("stops at the hold", async () => {
    const booking = await flaggedBooking(5_000);
    const added = saveHostLines(booking.id, { lines: [], addLook: 0 });
    expect(added.proposal!.lines[0].amountCents).toBe(5_000);
  });

  it("is refused after the renter contests, because the charge can only go down then", async () => {
    const booking = await flaggedBooking();
    const added = saveHostLines(booking.id, { lines: [], add: { description: "Broken lamp", amountCents: 2_000 } });
    respondAsRenter(added.renterToken, "contested", "It was already like that.");
    expect(() => saveHostLines(booking.id, { lines: [], addLook: 0 })).toThrow(/can only go down/);
  });
});
