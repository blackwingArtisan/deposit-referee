/** What one booking's live timeline shows. Shared by server and browser, so no Node imports. */
import type { TimelineStep } from "@/lib/events/types";
import type { Booking } from "./types";

/**
 * Webhooks arrive on a channel every booking shares, so only the ones naming this booking's own
 * PayPal ids belong here. This tab's own steps stay, apart from any from before the booking existed.
 */
export function bookingSteps(steps: TimelineStep[], booking: Pick<Booking, "createdAt" | "orderId" | "authorizationId" | "settlement">): TimelineStep[] {
  const ids = [booking.orderId, booking.authorizationId, booking.settlement?.captureId].filter((id): id is string => !!id);
  return steps.filter((step) => {
    if (step.channel !== "global") return step.startedAt >= booking.createdAt;
    if (step.kind !== "webhook") return false;
    const payload = JSON.stringify(step.data ?? null);
    return ids.some((id) => payload.includes(id));
  });
}
