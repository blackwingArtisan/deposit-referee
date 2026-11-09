import { allBookings, saveBooking } from "@/lib/deposit/bookings";
import { findHostLink, grantHost, spendHostLink } from "@/lib/deposit/host-key";

const page = (status: number, title: string, body: string) =>
  new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title></head><body style="font:16px/1.5 system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 16px;color:#18181b"><h1 style="font-size:1.4rem" data-testid="host-link-error">${title}</h1><p>${body}</p><p><a href="/bookings" style="color:#0f766e">Go to bookings</a></p></body></html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } },
  );

/**
 * Opens a booking as its host on this device: the one-time link's code is checked, spent, and the
 * booking's host secret goes into this browser's httpOnly cookie. A second use does nothing.
 */
export async function GET(_req: Request, ctx: RouteContext<"/host-link/[code]">) {
  const found = findHostLink(allBookings({ tests: true }), (await ctx.params).code);
  if (!found) return page(404, "This link doesn't open a booking", "Ask the host for a new link from the booking page.");
  if (found.state === "used") return page(410, "This link was already used", "Each link opens the booking on one device, once. Make a new one from the booking page on the device you made it on.");
  if (found.state === "expired") return page(410, "This link has expired", "Links work for 30 minutes. Make a new one from the booking page on the device you made it on.");
  const booking = saveBooking(spendHostLink(found.booking, found.link));
  await grantHost(booking);
  return new Response(null, { status: 303, headers: { Location: `/bookings/${booking.id}`, "Cache-Control": "no-store" } });
}
