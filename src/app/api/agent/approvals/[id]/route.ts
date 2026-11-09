import { z } from "zod";
import { readJson, route, HttpError } from "@/lib/http";
import { getApprovals } from "@/lib/agent/approvals";
import { bookingForRun } from "@/lib/deposit/bookings";
import { requireHost } from "@/lib/deposit/host-key";

const Body = z.object({ decision: z.enum(["approved", "denied"]), note: z.string().max(500).optional() });

/** The host's answer to a pending approval. Only the booking's host can give it. */
export const POST = route<RouteContext<"/api/agent/approvals/[id]">>(async (req, ctx) => {
  const id = (await ctx.params).id;
  const approval = getApprovals().get(id);
  if (!approval) throw new HttpError(404, "No such approval.", "not_found");
  const booking = approval.runId ? bookingForRun(approval.runId) : undefined;
  if (!booking) throw new HttpError(403, "This approval isn't for a booking, so no host can answer it here.", "host_secret_wrong");
  await requireHost(booking);
  const b = await readJson(req, Body);
  return { approval: getApprovals().decide(id, b.decision, "you", b.note) };
});
