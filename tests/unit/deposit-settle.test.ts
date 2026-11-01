import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getApprovals } from "@/lib/agent/approvals";
import { createBooking, requireBooking, saveBooking, viewBooking } from "@/lib/deposit/bookings";
import { DEMO_PHOTOS } from "@/lib/deposit/photos";
import { dollarsToCents } from "@/lib/deposit/rules";
import { MOCK_VERDICT, reviewPhotos, toReview } from "@/lib/deposit/review";
import { requestSettlement, retryRelease } from "@/lib/deposit/settle";
import { getMockPayPal } from "@/lib/paypal";
import { moneyFromMinor } from "@/lib/money";

const paypal = () => getMockPayPal()!;

/** A booking with a real mock hold, reviewed by the AI fixture and ready for the host. */
async function reviewedBooking(depositCents = 20_000) {
  const booking = createBooking({ item: "Lakeside cabin", renter: "Test Renter", depositCents });
  const order = await paypal().orders.create({ intent: "AUTHORIZE", purchase_units: [{ amount: moneyFromMinor(depositCents) }] });
  await paypal().simulateBuyerApproval(order.id);
  const auth = (await paypal().orders.authorize(order.id)).purchase_units![0].payments!.authorizations![0];
  const held = saveBooking({ ...booking, status: "held", orderId: order.id, authorizationId: auth.id, authorizedCents: depositCents, holdExpiresAt: auth.expiration_time, photos: DEMO_PHOTOS });
  return saveBooking({ ...held, status: "reviewed", review: await reviewPhotos(held) });
}

async function waitForApproval(bookingId: string) {
  await vi.waitFor(() => expect(viewBooking(requireBooking(bookingId)).approval).not.toBeNull());
  return viewBooking(requireBooking(bookingId)).approval!;
}

beforeEach(async () => {
  await paypal().reset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("settling a deposit", () => {
  it("moves no money until the host approves, then captures the exact charge and voids the rest", async () => {
    const booking = await reviewedBooking();
    const { finished } = requestSettlement(booking.id, 3_500, "test");
    const approval = await waitForApproval(booking.id);

    expect(approval.summary).toBe("Charge exactly $35.00 from the $200.00 hold and release $165.00 to the renter");
    expect(approval.amountValue).toBe("35.00");
    expect((await paypal().payments.getAuthorization(booking.authorizationId!)).status).toBe("CREATED");
    expect(requireBooking(booking.id).settlement?.captureId).toBeUndefined();

    getApprovals().decide(approval.id, "approved");
    await finished;

    const settled = requireBooking(booking.id);
    expect(settled.status).toBe("settled");
    expect(settled.settlement).toMatchObject({ capturedCents: 3_500, releasedCents: 16_500, authorizationStatus: "VOIDED" });
    const capture = await paypal().payments.getCapture(settled.settlement!.captureId!);
    expect(dollarsToCents(capture.amount.value)).toBe(3_500);
    expect(capture.final_capture).toBe(false);
  });

  it("a declined charge moves nothing and goes back to the host", async () => {
    const booking = await reviewedBooking();
    const { finished } = requestSettlement(booking.id, 3_500, "test");
    getApprovals().decide((await waitForApproval(booking.id)).id, "denied", "you", "Too high");
    await finished;

    expect(requireBooking(booking.id).status).toBe("reviewed");
    expect(requireBooking(booking.id).settlement?.error).toMatch(/declined/);
    expect((await paypal().payments.getAuthorization(booking.authorizationId!)).status).toBe("CREATED");
  });

  it("refuses to charge an expired hold, before and after approval", async () => {
    const booking = await reviewedBooking();
    const { finished } = requestSettlement(booking.id, 3_500, "test");
    const approval = await waitForApproval(booking.id);
    vi.useFakeTimers({ toFake: ["Date"], now: Date.parse(booking.holdExpiresAt!) + 1000 });
    getApprovals().decide(approval.id, "approved");
    await finished;
    expect(requireBooking(booking.id).status).toBe("reviewed");
    expect(requireBooking(booking.id).settlement?.error).toMatch(/expired/);
    expect((await paypal().payments.getAuthorization(booking.authorizationId!)).status).toBe("CREATED");

    expect(() => requestSettlement(booking.id, 3_500, "test")).toThrow(/expired/);
  });

  it("refuses a charge above the hold", async () => {
    const booking = await reviewedBooking();
    expect(() => requestSettlement(booking.id, 20_001, "test")).toThrow(/more than/);
    expect(requireBooking(booking.id).status).toBe("reviewed");
  });

  it("can't be settled twice", async () => {
    const booking = await reviewedBooking();
    const { finished } = requestSettlement(booking.id, 3_500, "test");
    expect(() => requestSettlement(booking.id, 5_000, "test")).toThrow(/already being settled/);
    getApprovals().decide((await waitForApproval(booking.id)).id, "approved");
    await finished;
    expect(() => requestSettlement(booking.id, 5_000, "test")).toThrow(/can't be charged/);
  });

  it("a full charge needs no void", async () => {
    const booking = await reviewedBooking();
    const { finished } = requestSettlement(booking.id, 20_000, "test");
    getApprovals().decide((await waitForApproval(booking.id)).id, "approved");
    await finished;
    expect(requireBooking(booking.id).settlement).toMatchObject({ capturedCents: 20_000, releasedCents: 0, authorizationStatus: "CAPTURED" });
  });

  it("a failed release can be retried without charging again", async () => {
    const booking = await reviewedBooking();
    const spy = vi.spyOn(paypal().payments, "voidAuthorization").mockRejectedValueOnce(new Error("PayPal is down"));
    const { finished } = requestSettlement(booking.id, 3_500, "test");
    getApprovals().decide((await waitForApproval(booking.id)).id, "approved");
    await finished;
    spy.mockRestore();

    const stuck = requireBooking(booking.id);
    expect(stuck.status).toBe("captured");
    expect(stuck.settlement?.error).toMatch(/not released/);

    await retryRelease(booking.id, "test").finished;
    const settled = requireBooking(booking.id);
    expect(settled.status).toBe("settled");
    expect(settled.settlement).toMatchObject({ captureId: stuck.settlement!.captureId, capturedCents: 3_500, releasedCents: 16_500, authorizationStatus: "VOIDED" });
  });
});

describe("the AI's answer", () => {
  const meta = { mocked: true, costUsd: 0 };

  it("adds up the charge in code and limits it to the hold", () => {
    expect(toReview(MOCK_VERDICT, 20_000, meta)).toMatchObject({ suggestedCents: 15_000, cappedToHold: false });
    expect(toReview(MOCK_VERDICT, 10_000, meta)).toMatchObject({ suggestedCents: 10_000, cappedToHold: true });
  });

  it("keeps charges in whole cents and boxes on the photo", () => {
    const review = toReview({ ...MOCK_VERDICT, findings: [{ description: "x", charge_cents: 1999.6, box: { x: 0.9, y: -0.2, w: 0.5, h: 0.4 } }] }, 20_000, meta);
    expect(review.suggestedCents).toBe(2000);
    expect(review.items[0].box).toEqual({ x: 0.9, y: 0, w: expect.closeTo(0.1), h: 0.4 });
  });

  it("charges nothing when it finds no new damage, whatever else it returned", () => {
    expect(toReview({ ...MOCK_VERDICT, new_damage: false }, 20_000, meta)).toMatchObject({ suggestedCents: 0, items: [] });
  });
});
