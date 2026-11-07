import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { holdToCapture } from "@/agents/tools/capture-deposit";
import { getApprovals } from "@/lib/agent/approvals";
import { requireBooking } from "@/lib/deposit/bookings";
import { dollarsToCents } from "@/lib/deposit/rules";
import { requestSettlement } from "@/lib/deposit/settle";
import { timeline } from "@/lib/events/bus";
import { PayPalApiError } from "@/lib/paypal/errors";
import { acceptedBooking, holdStatus, paypal, waitForApproval } from "./deposit-fixtures";

const DAY = 24 * 60 * 60 * 1000;

beforeEach(async () => {
  await paypal().reset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Settles a $35 charge with the clock moved `days` past the hold's start, and returns the booking. */
async function settleAfter(days: number) {
  const booking = await acceptedBooking();
  const { finished } = requestSettlement(booking.id, 3_500, "test");
  const approval = await waitForApproval(booking.id);
  vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + days * DAY });
  getApprovals().decide(approval.id, "approved");
  await finished;
  return requireBooking(booking.id);
}

describe("refreshing a hold past PayPal's 3-day honor period", () => {
  it("leaves a fresh hold alone", async () => {
    const reauthorize = vi.spyOn(paypal().payments, "reauthorize");
    const settled = await settleAfter(1);
    expect(reauthorize).not.toHaveBeenCalled();
    expect(settled.refreshedAuthorizationId).toBeUndefined();
    expect(settled.settlement).toMatchObject({ capturedCents: 3_500, releasedCents: 16_500, authorizationStatus: "VOIDED" });
  });

  it("reauthorizes an old hold, charges the new one and releases the rest", async () => {
    const settled = await settleAfter(4);
    expect(settled.status).toBe("settled");
    expect(settled.refreshedAuthorizationId).toBeTruthy();
    expect(settled.refreshedAuthorizationId).not.toBe(settled.authorizationId);
    const capture = await paypal().payments.getCapture(settled.settlement!.captureId!);
    expect(dollarsToCents(capture.amount.value)).toBe(3_500);
    expect(capture.links?.find((l) => l.rel === "up")?.href).toContain(settled.refreshedAuthorizationId);
    expect(settled.settlement).toMatchObject({ capturedCents: 3_500, releasedCents: 16_500, authorizationStatus: "VOIDED" });
    expect(await holdStatus(settled.refreshedAuthorizationId)).not.toBe("CREATED");
  });

  it("charges the original hold when PayPal refuses to reauthorize", async () => {
    const booking = await acceptedBooking();
    const auth = await paypal().payments.getAuthorization(booking.authorizationId!);
    vi.spyOn(paypal().payments, "reauthorize").mockRejectedValueOnce(new PayPalApiError({ status: 422, name: "UNPROCESSABLE_ENTITY", message: "Refused", details: [{ issue: "REAUTHORIZATION_TOO_SOON" }] }));
    const emit = vi.spyOn(timeline, "emit");
    const id = await holdToCapture(paypal(), booking.id, auth, Date.parse(auth.create_time) + 4 * DAY);
    expect(id).toBe(booking.authorizationId);
    expect(requireBooking(booking.id).refreshedAuthorizationId).toBeUndefined();
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ title: "Hold not refreshed", detail: expect.stringContaining("REAUTHORIZATION_TOO_SOON") }));
  });

  it("reuses a hold it already refreshed", async () => {
    const booking = await acceptedBooking();
    const auth = await paypal().payments.getAuthorization(booking.authorizationId!);
    const later = Date.parse(auth.create_time) + 4 * DAY;
    vi.useFakeTimers({ toFake: ["Date"], now: later });
    const first = await holdToCapture(paypal(), booking.id, auth, later);
    const reauthorize = vi.spyOn(paypal().payments, "reauthorize");
    expect(await holdToCapture(paypal(), booking.id, auth, later)).toBe(first);
    expect(reauthorize).not.toHaveBeenCalled();
  });
});
