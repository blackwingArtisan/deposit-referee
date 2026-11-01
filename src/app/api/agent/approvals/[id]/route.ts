import { z } from "zod";
import { readJson, route } from "@/lib/http";
import { getApprovals } from "@/lib/agent/approvals";

const Body = z.object({ decision: z.enum(["approved", "denied"]), note: z.string().max(500).optional() });

/** The human's answer to a pending approval. In a real app, check the user is allowed to approve. */
export const POST = route<RouteContext<"/api/agent/approvals/[id]">>(async (req, ctx) => {
  const b = await readJson(req, Body);
  return { approval: getApprovals().decide((await ctx.params).id, b.decision, "you", b.note) };
});
