import { beforeEach, describe, expect, it, vi } from "vitest";
import { getApprovals } from "@/lib/agent/approvals";
import { runSettlementAgent } from "@/agents/settlement";
import { requireBooking, saveBooking } from "@/lib/deposit/bookings";
import { DEMO_TWO_MARKS_CHECK_OUT } from "@/lib/deposit/photos";
import { respondAsRenter } from "@/lib/deposit/renter";
import { reviewPhotos } from "@/lib/deposit/review";
import { requestRelease, requestSettlement } from "@/lib/deposit/settle";
import { requestPartCapture } from "@/lib/deposit/split";
import { heldBooking, holdStatus, paypal, waitForApproval } from "./deposit-fixtures";

beforeEach(async () => {
  await paypal().reset();
});

/** The two-marks photo: the gouge ($150) and the stain ($100) on a $300 hold. */
async function twoMarks() {
  const held = await heldBooking(30_000);
  const withTwo = saveBooking({ ...held, photos: { ...held.photos, check_out: DEMO_TWO_MARKS_CHECK_OUT } });
  saveBooking({ ...withTwo, status: "reviewed", review: await reviewPhotos(withTwo) });
  return runSettlementAgent(held.id, "test");
}

/** The renter accepts the gouge and contests the stain; the host approves the accepted part. */
async function acceptedPartCharged() {
  const booking = await twoMarks();
  respondAsRenter(booking.renterToken, "contested", "The stain was there when I arrived.", ["ai-0"]);
  getApprovals().decide((await waitForApproval(booking.id)).id, "approved");
  await vi.waitFor(() => expect(requireBooking(booking.id).partCapture?.captureId).toBeTruthy());
  return requireBooking(booking.id);
}

describe("split capture: the renter accepts some items and contests others", () => {
  it("sends the accepted items to the approval gate at once, and nothing moves before approval", async () => {
    const booking = await twoMarks();
    expect(booking.proposal!.lines.map((line) => [line.id, line.amountCents])).toEqual([["ai-0", 15_000], ["ai-1", 10_000]]);
    respondAsRenter(booking.renterToken, "contested", "The stain was there when I arrived.", ["ai-0"]);

    const approval = await waitForApproval(booking.id);
    expect(approval.summary).toBe("Charge exactly $150.00 now for the items the renter accepted. The $100.00 they contested stays on the $300.00 hold until you settle it");
    expect(approval.amountValue).toBe("150.00");
    expect(await holdStatus(booking.authorizationId)).toBe("CREATED");
    expect(requireBooking(booking.id).partCapture?.captureId).toBeUndefined();
  });

  it("captures the accepted part, never final, and leaves only the contested items to decide", async () => {
    const after = await acceptedPartCharged();
    expect(after.status).toBe("contested");
    expect(after.partCapture).toMatchObject({ requestedCents: 15_000, capturedCents: 15_000, finalCapture: false });
    expect(after.proposal!.lines.map((line) => line.id)).toEqual(["ai-1"]);
    const capture = await paypal().payments.getCapture(after.partCapture!.captureId!);
    expect(capture.amount.value).toBe("150.00");
    expect(capture.final_capture).toBe(false);
    expect(await holdStatus(after.authorizationId)).toBe("PARTIALLY_CAPTURED");
  });

  it("lets a person settle the contested part later, from the same hold, and never above it", async () => {
    const after = await acceptedPartCharged();
    expect(() => requestSettlement(after.id, 10_001, "test")).toThrow(/more than/);

    const { finished } = requestSettlement(after.id, 4_000, "test");
    const approval = await waitForApproval(after.id);
    expect(approval.summary).toBe("Charge exactly $40.00 of the contested $100.00 and release $110.00 to the renter ($150.00 was already charged for the items they accepted)");
    getApprovals().decide(approval.id, "approved");
    await finished;

    const done = requireBooking(after.id);
    expect(done.status).toBe("settled");
    expect(done.settlement).toMatchObject({ capturedCents: 19_000, releasedCents: 11_000, authorizationStatus: "VOIDED" });
    const order = await paypal().orders.get(done.orderId!);
    const captures = order.purchase_units![0].payments!.captures!;
    expect(captures.map((c) => c.amount.value)).toEqual(["150.00", "40.00"]);
    expect(captures.map((c) => c.id)).toEqual([done.partCapture!.captureId, done.settlement!.captureId]);
  });

  it("releasing the contested part keeps the accepted charge and voids the rest", async () => {
    const after = await acceptedPartCharged();
    const { finished } = requestRelease(after.id, "test");
    const approval = await waitForApproval(after.id);
    expect(approval.summary).toBe("Release the remaining $150.00 of the hold to the renter. Nothing more is charged ($150.00 was already charged for the items they accepted).");
    getApprovals().decide(approval.id, "approved");
    await finished;
    expect(requireBooking(after.id).settlement).toMatchObject({ kind: "release", capturedCents: 15_000, releasedCents: 15_000, authorizationStatus: "VOIDED" });
  });

  it("a declined charge of the accepted part moves nothing and the host can ask again", async () => {
    const booking = await twoMarks();
    respondAsRenter(booking.renterToken, "contested", "The stain was there when I arrived.", ["ai-0"]);
    getApprovals().decide((await waitForApproval(booking.id)).id, "denied");
    await vi.waitFor(() => expect(requireBooking(booking.id).status).toBe("contested"));
    expect(requireBooking(booking.id).partCapture?.error).toContain("declined");
    expect(await holdStatus(booking.authorizationId)).toBe("CREATED");
    // The whole charge can't skip the accepted part.
    expect(() => requestSettlement(booking.id, 25_000, "test")).toThrow(/accepted items first/);

    const { finished } = requestPartCapture(booking.id, "test");
    getApprovals().decide((await waitForApproval(booking.id)).id, "approved");
    await finished;
    expect(requireBooking(booking.id).partCapture?.capturedCents).toBe(15_000);
  });

  it("refuses an unknown item, and a contest that accepts every item", async () => {
    const booking = await twoMarks();
    expect(() => respondAsRenter(booking.renterToken, "contested", "No.", ["ai-9"])).toThrow(/isn't on this charge/);
    expect(() => respondAsRenter(booking.renterToken, "contested", "No.", ["ai-0", "ai-1"])).toThrow(/Press Accept/);
  });
});
