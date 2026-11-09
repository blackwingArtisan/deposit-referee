import { beforeEach, describe, expect, it } from "vitest";
import { getApprovals } from "@/lib/agent/approvals";
import { requireBooking } from "@/lib/deposit/bookings";
import { requestSettlement } from "@/lib/deposit/settle";
import { timeline } from "@/lib/events/bus";
import type { TimelineEvent } from "@/lib/events/types";
import { TOOLKIT_GAPS } from "@/lib/paypal/toolkit-coverage";
import { acceptedBooking, paypal, waitForApproval } from "./deposit-fixtures";

beforeEach(async () => {
  await paypal().reset();
});

describe("PayPal calls name the tool that made them", () => {
  it("reads the hold with the Agent Toolkit's get_order, and says plainly the Toolkit has no capture or void", async () => {
    const booking = await acceptedBooking();
    const seen: TimelineEvent[] = [];
    const stop = timeline.subscribe((e) => {
      if (e.paypal) seen.push(e);
    });
    const { finished } = requestSettlement(booking.id, 3_500, "test");
    getApprovals().decide((await waitForApproval(booking.id)).id, "approved");
    await finished;
    stop();
    expect(requireBooking(booking.id).status).toBe("settled");

    const done = seen.filter((e) => e.status !== "running");
    const reads = done.filter((e) => e.paypal!.operation === "orders.get");
    expect(reads.length).toBeGreaterThan(0);
    for (const read of reads) expect(read.paypal!.via).toEqual({ tool: "get_order", toolkit: "get_order" });
    // No hold read went around the Toolkit.
    expect(done.filter((e) => e.paypal!.operation === "payments.getAuthorization")).toEqual([]);

    const capture = done.find((e) => e.paypal!.operation === "payments.captureAuthorization")!;
    expect(capture.paypal!.via).toEqual({ tool: "capture_deposit", toolkit: null, gap: TOOLKIT_GAPS["payments.captureAuthorization"] });
    expect(capture.paypal!.via!.gap).toContain("has no tool to capture from a hold");
    const voided = done.find((e) => e.paypal!.operation === "payments.voidAuthorization")!;
    expect(voided.paypal!.via).toEqual({ tool: "void_authorization", toolkit: null, gap: TOOLKIT_GAPS["payments.voidAuthorization"] });
  });
});
