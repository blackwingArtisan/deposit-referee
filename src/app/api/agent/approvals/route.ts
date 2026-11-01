import { route } from "@/lib/http";
import { getApprovals, type Approval } from "@/lib/agent/approvals";
import { getContext } from "@/lib/events/bus";

export const GET = route(async (req) => {
  const state = (req.nextUrl.searchParams.get("state") as Approval["state"] | null) ?? undefined;
  return { approvals: getApprovals().list({ state, channel: getContext().channel }) };
});
