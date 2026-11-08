import { beforeEach, describe, expect, it } from "vitest";
import { getApprovals } from "@/lib/agent/approvals";
import { bookingEvents, forBooking } from "@/lib/deposit/booking-events";
import { requireBooking } from "@/lib/deposit/bookings";
import { requestSettlement } from "@/lib/deposit/settle";
import { bookingSteps, combineEvents } from "@/lib/deposit/timeline";
import { timeline } from "@/lib/events/bus";
import { mergeEvents, type TimelineEvent } from "@/lib/events/types";
import { acceptedBooking, paypal, waitForApproval } from "./deposit-fixtures";

beforeEach(async () => {
  await paypal().reset();
});

const operations = (events: TimelineEvent[]) => mergeEvents(events).filter((s) => s.paypal).map((s) => `${s.paypal!.operation} ${s.paypal!.httpStatus}`);

describe("a booking's PayPal calls are kept with the booking", () => {
  it("files the capture and the release under the booking, so a reload still shows them", async () => {
    const booking = await acceptedBooking();
    const { finished } = forBooking(booking.id, () => requestSettlement(booking.id, 3_500, "another-tab"));
    getApprovals().decide((await waitForApproval(booking.id)).id, "approved");
    await finished;

    const ops = operations(bookingEvents(booking.id));
    expect(ops.some((op) => /capture/i.test(op))).toBe(true);
    expect(ops.some((op) => /void/i.test(op))).toBe(true);
    expect(bookingEvents(booking.id).every((e) => !e.bookingId || e.bookingId === booking.id)).toBe(true);
  });

  it("files a webhook under the booking whose capture it names", async () => {
    const booking = await acceptedBooking();
    const { finished } = forBooking(booking.id, () => requestSettlement(booking.id, 3_500, "another-tab"));
    getApprovals().decide((await waitForApproval(booking.id)).id, "approved");
    await finished;
    const captureId = requireBooking(booking.id).settlement!.captureId!;

    timeline.emit({ kind: "webhook", status: "info", channel: "global", title: "PAYMENT.CAPTURE.COMPLETED", data: { event: { resource: { id: captureId } } } });
    expect(bookingEvents(booking.id).some((e) => e.kind === "webhook" && e.title === "PAYMENT.CAPTURE.COMPLETED")).toBe(true);
  });

  it("shows saved steps from another tab, each once, and never another booking's", () => {
    const at = (s: number) => `2026-11-06T10:0${s}:00.000Z`;
    const event = (id: string, fields: Partial<TimelineEvent>): TimelineEvent => ({ id, stepId: id, channel: "s_other_tab", ts: at(1), kind: "paypal", status: "succeeded", title: id, ...fields });
    const saved = [event("hold", { bookingId: "bk_a" }), event("capture", { bookingId: "bk_a", ts: at(3) })];
    const live = [event("capture", { bookingId: "bk_a", ts: at(3) }), event("theirs", { bookingId: "bk_b", channel: "s_tab" })];
    const steps = bookingSteps(mergeEvents(combineEvents(saved, live)), { id: "bk_a", createdAt: at(0) });
    expect(steps.map((s) => s.title)).toEqual(["hold", "capture"]);
  });
});
