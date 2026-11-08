/**
 * The host's booking secret. There are no logins, so the browser that made a booking gets a
 * random secret for it in an httpOnly cookie, and every route that moves money, approves, edits
 * the charge or sends evidence checks it. Anyone else with the booking's link can look, not act.
 * Scripts can send it as the x-booking-secret header. Server only.
 */
import { randomBytes, timingSafeEqual } from "node:crypto";
import { cookies, headers } from "next/headers";
import { HttpError } from "@/lib/http";
import type { Booking } from "./types";

export const HOST_SECRET_HEADER = "x-booking-secret";
export const hostCookie = (bookingId: string) => `dr_host_${bookingId}`;
export const newHostSecret = () => randomBytes(24).toString("base64url");

/** Gives this browser the host's secret for a booking it just made. Only in a route handler. */
export async function grantHost(booking: Booking) {
  if (!booking.hostSecret) return;
  (await cookies()).set(hostCookie(booking.id), booking.hostSecret, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 180 });
}

function same(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** 401 with no secret, 403 with the wrong one. Runs before anything reaches PayPal. */
export async function requireHost(booking: Booking) {
  const presented = (await headers()).get(HOST_SECRET_HEADER) ?? (await cookies()).get(hostCookie(booking.id))?.value;
  if (!presented) throw new HttpError(401, "Only the host who made this booking can do this. Open it in the browser you made it in.", "host_secret_required");
  if (!booking.hostSecret || !same(presented, booking.hostSecret)) throw new HttpError(403, "That isn't this booking's host secret.", "host_secret_wrong");
}

/** Whether this request carries the booking's host secret. */
export async function isHost(booking: Booking): Promise<boolean> {
  return requireHost(booking).then(
    () => true,
    () => false,
  );
}
