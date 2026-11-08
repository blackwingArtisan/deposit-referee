/**
 * Every timeline event that belongs to a booking, kept on disk, so the booking's "PayPal calls"
 * list is the same after a reload, in another tab and on the finished booking. Events carry the
 * booking id when they happen inside forBooking(); a webhook belongs to the booking whose PayPal
 * ids it names. Server only.
 */
import fs from "node:fs";
import path from "node:path";
import { getContext, timeline, withContext } from "@/lib/events/bus";
import type { TimelineEvent } from "@/lib/events/types";
import { singleton } from "@/lib/singleton";
import { collection } from "@/lib/store/collection";
import { dataPath } from "@/lib/store/files";
import type { Booking } from "./types";

/** Enough for a long booking; the oldest go first past this. */
const MAX_EVENTS = 800;

const file = (bookingId: string) => dataPath("booking-events", `${bookingId.replace(/[^\w-]/g, "")}.jsonl`);

function append(bookingId: string, event: TimelineEvent) {
  const target = file(bookingId);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.appendFileSync(target, `${JSON.stringify(event)}\n`);
}

/**
 * The booking a webhook, or a PayPal call made outside a booking route (the buyer's approval of
 * the order, say), is about, from the PayPal ids in it.
 */
function bookingNamedIn(event: TimelineEvent): string | undefined {
  const payload = JSON.stringify([event.data ?? null, event.paypal?.path ?? null]);
  return collection<Booking>("bookings")
    .list()
    .find((b) => [b.orderId, b.authorizationId, b.refreshedAuthorizationId, b.settlement?.captureId, b.partCapture?.captureId].some((id) => id && payload.includes(id)))?.id;
}

/** Starts recording once per process. Called from bookings.ts, which every booking route loads. */
export function recordBookingEvents() {
  singleton("deposit:booking-events", () =>
    timeline.subscribe((event) => {
      const bookingId = event.bookingId ?? (event.kind === "webhook" || event.paypal ? bookingNamedIn(event) : undefined);
      if (bookingId) append(bookingId, event);
    }),
  );
}

/** Runs fn filed under the booking that owns this PayPal order, if one does. */
export function forOrder<T>(orderId: string, fn: () => T): T {
  const owner = collection<Booking>("bookings")
    .list()
    .find((b) => b.orderId === orderId);
  return owner ? forBooking(owner.id, fn) : fn();
}

/** Runs fn with every event it emits filed under this booking. */
export function forBooking<T>(bookingId: string, fn: () => T): T {
  return withContext({ ...getContext(), bookingId }, fn);
}

export function bookingEvents(bookingId: string): TimelineEvent[] {
  let text = "";
  try {
    text = fs.readFileSync(file(bookingId), "utf8");
  } catch {
    return [];
  }
  const events = text
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as TimelineEvent];
      } catch {
        return [];
      }
    });
  return events.slice(-MAX_EVENTS);
}
