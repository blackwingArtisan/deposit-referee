import { z } from "zod";
import { forBooking } from "@/lib/deposit/booking-events";
import { requireBookingByToken } from "@/lib/deposit/bookings";
import { respondAsRenter } from "@/lib/deposit/renter";
import { enforceRateLimit } from "@/lib/ai/rate-limit";
import { readJson, route } from "@/lib/http";

const Body = z.object({
  decision: z.enum(["accepted", "contested"]),
  note: z.string().max(500).optional(),
  accepted_line_ids: z.array(z.string().max(40)).max(20).optional(),
  /** On a contest: the renter's own photo for a contested item, as a browser data: URL. */
  evidence: z.array(z.object({ line_id: z.string().max(40), data_url: z.string() })).max(5).optional(),
});

/** The renter's answer. A contest stops the capture, hands it back to the host with this note, and starts Claude's second look. */
export const POST = route<RouteContext<"/api/renter/[token]/respond">>(async (req, ctx) => {
  const { decision, note, accepted_line_ids, evidence } = await readJson(req, Body);
  const { token } = await ctx.params;
  // A contest starts Claude's second look, so it counts against the AI limit.
  if (decision === "contested") enforceRateLimit(req, "ai");
  const photos = Object.fromEntries((evidence ?? []).map((e) => [e.line_id, e.data_url]));
  return forBooking(requireBookingByToken(token).id, () => respondAsRenter(token, decision, note, accepted_line_ids, photos));
});
