import { route } from "@/lib/http";
import { ledger, type LedgerKind } from "@/lib/paypal";

/** Everything this app has done with PayPal (orders, captures, refunds, payouts, invoices...). */
export const GET = route(async (req) => {
  const kind = req.nextUrl.searchParams.get("kind") as LedgerKind | null;
  return { entries: ledger.list(kind ? { kind } : {}) };
});
