/**
 * Who is looking, without logins: a random id in a cookie, set when a visitor makes their first
 * booking. The bookings list and the dashboard show the samples and this visitor's own bookings,
 * so one judge's test bookings don't clutter the next judge's screen. A booking's own page still
 * opens for anyone with its link. Server only.
 */
import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";

export const VISITOR_COOKIE = "dr_visitor";
const VALID = /^[\w-]{8,64}$/;

export async function currentVisitor(): Promise<string | undefined> {
  const id = (await cookies()).get(VISITOR_COOKIE)?.value;
  return id && VALID.test(id) ? id : undefined;
}

/** The visitor's id, set now if they have none. Only in a route handler. */
export async function ensureVisitor(): Promise<string> {
  const known = await currentVisitor();
  if (known) return known;
  const id = randomUUID();
  (await cookies()).set(VISITOR_COOKIE, id, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 180 });
  return id;
}
