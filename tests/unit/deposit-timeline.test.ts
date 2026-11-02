import { describe, expect, it } from "vitest";
import type { TimelineStep } from "@/lib/events/types";
import { bookingSteps } from "@/lib/deposit/timeline";

const createdAt = "2026-11-06T10:00:00.000Z";
const later = "2026-11-06T10:05:00.000Z";

const step = (id: string, fields: Partial<TimelineStep>): TimelineStep =>
  ({ id, stepId: id, channel: "s_tab", ts: later, startedAt: later, updatedAt: later, kind: "paypal", status: "succeeded", title: id, history: ["succeeded"], ...fields }) as TimelineStep;

const webhook = (id: string, resource: Record<string, unknown>) => step(id, { channel: "global", kind: "webhook", data: { event: { resource }, handlers: 0 } });

const titles = (steps: TimelineStep[]) => steps.map((s) => s.title);

describe("a booking's timeline", () => {
  const booking = { createdAt, orderId: "ORDER-A", authorizationId: "AUTH-A", settlement: { runId: "r", kind: "charge" as const, requestedCents: 100, captureId: "CAP-A" } };

  it("keeps webhooks that name this booking's order, hold or capture", () => {
    const steps = [webhook("order", { id: "ORDER-A" }), webhook("hold", { id: "AUTH-A" }), webhook("capture", { id: "CAP-A", supplementary_data: { related_ids: { order_id: "ORDER-A" } } })];
    expect(titles(bookingSteps(steps, booking))).toEqual(["order", "hold", "capture"]);
  });

  it("drops another booking's webhooks", () => {
    expect(bookingSteps([webhook("other", { id: "AUTH-B", supplementary_data: { related_ids: { order_id: "ORDER-B" } } })], booking)).toEqual([]);
  });

  it("shows no webhooks before the booking has any PayPal ids", () => {
    expect(bookingSteps([webhook("any", { id: "ORDER-A" })], { createdAt })).toEqual([]);
  });

  it("drops global steps that aren't webhooks", () => {
    expect(bookingSteps([step("job", { channel: "global", kind: "info" })], booking)).toEqual([]);
  });

  it("keeps this tab's steps, but not ones from before the booking", () => {
    const earlier = "2026-11-06T09:00:00.000Z";
    expect(titles(bookingSteps([step("mine", {}), step("old booking", { startedAt: earlier })], booking))).toEqual(["mine"]);
  });
});
