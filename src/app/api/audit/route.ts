import { route } from "@/lib/http";
import { getAuditLog } from "@/lib/agent/audit";

/** Append-only audit log + hash-chain verification. */
export const GET = route(async (req) => {
  const log = getAuditLog();
  const runId = req.nextUrl.searchParams.get("runId") ?? undefined;
  return { entries: log.list({ runId, limit: 500 }).reverse(), integrity: log.verify() };
});
