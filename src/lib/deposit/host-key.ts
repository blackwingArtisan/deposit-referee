/**
 * The host's booking secret. There are no logins, so the browser that made a booking gets a
 * random secret for it in an httpOnly cookie, and every route that moves money, approves, edits
 * the charge or sends evidence checks it. Anyone else with the booking's link can look, not act.
 * Scripts can send it as the x-booking-secret header. Server only.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies, headers } from "next/headers";
import { HttpError } from "@/lib/http";
import type { Booking, HostLink } from "./types";

export const HOST_SECRET_HEADER = "x-booking-secret";
export const hostCookie = (bookingId: string) => `dr_host_${bookingId}`;
export const newHostSecret = () => randomBytes(24).toString("base64url");

/** Gives this browser the host's secret for a booking it just made. Only in a route handler. */
export async function grantHost(booking: Booking) {
  if (!booking.hostSecret) return;
  (await cookies()).set(hostCookie(booking.id), booking.hostSecret, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 180 });
}

/** How long an "open on another device" link works, and how many links a booking keeps. */
export const HOST_LINK_MINUTES = 30;
export const HOST_LINKS_KEPT = 5;
const hashCode = (code: string) => createHash("sha256").update(code).digest("hex");

/**
 * A one-time link that gives one other device this booking's host secret. Only the code's hash is
 * kept, so the stored booking can't be turned back into a working link.
 */
export function addHostLink(booking: Booking, now = Date.now()): { booking: Booking; code: string; expiresAt: string } {
  const code = randomBytes(24).toString("base64url");
  const link: HostLink = { hash: hashCode(code), createdAt: new Date(now).toISOString(), expiresAt: new Date(now + HOST_LINK_MINUTES * 60_000).toISOString() };
  return { booking: { ...booking, hostLinks: [...(booking.hostLinks ?? []), link].slice(-HOST_LINKS_KEPT) }, code, expiresAt: link.expiresAt };
}

/** Finds the booking a link's code belongs to, and whether it can still be used. */
export function findHostLink(all: Booking[], code: string, now = Date.now()): { booking: Booking; link: HostLink; state: "ok" | "used" | "expired" } | undefined {
  const hash = hashCode(code);
  for (const booking of all) {
    const link = booking.hostLinks?.find((l) => same(l.hash, hash));
    if (link) return { booking, link, state: link.usedAt ? "used" : Date.parse(link.expiresAt) <= now ? "expired" : "ok" };
  }
  return undefined;
}

/** Marks a link used, so it never works again. */
export function spendHostLink(booking: Booking, link: HostLink, now = Date.now()): Booking {
  return { ...booking, hostLinks: booking.hostLinks?.map((l) => (l.hash === link.hash ? { ...l, usedAt: new Date(now).toISOString() } : l)) };
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
