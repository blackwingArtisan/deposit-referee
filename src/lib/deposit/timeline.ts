/** What one booking's live timeline shows. Shared by server and browser, so no Node imports. */
import type { TimelineEvent, TimelineStep } from "@/lib/events/types";
import type { Booking } from "./types";

/**
 * Webhooks arrive on a channel every booking shares, so only the ones naming this booking's own
 * PayPal ids belong here. A step filed under a booking belongs to that booking only. This tab's other
 * steps stay, apart from any from before the booking existed.
 */

/** The booking's saved events and this tab's live ones, each once, in the order they happened. */
export function combineEvents(saved: TimelineEvent[], live: TimelineEvent[]): TimelineEvent[] {
  const byId = new Map<string, TimelineEvent>();
  for (const e of [...saved, ...live]) byId.set(e.id, e);
  return [...byId.values()].sort((a, b) => a.ts.localeCompare(b.ts));
}
export function bookingSteps(steps: TimelineStep[], booking: Pick<Booking, "createdAt"> & Partial<Pick<Booking, "id" | "orderId" | "authorizationId" | "refreshedAuthorizationId" | "settlement" | "partCapture">>): TimelineStep[] {
  const ids = [booking.orderId, booking.authorizationId, booking.refreshedAuthorizationId, booking.settlement?.captureId, booking.partCapture?.captureId].filter((id): id is string => !!id);
  return steps.filter((step) => {
    if (step.bookingId) return step.bookingId === booking.id;
    if (step.channel !== "global") return step.startedAt >= booking.createdAt;
    if (step.kind !== "webhook") return false;
    const payload = JSON.stringify(step.data ?? null);
    return ids.some((id) => payload.includes(id));
  });
}
