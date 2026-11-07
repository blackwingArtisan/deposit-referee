import { ownPaypalIds } from "@/lib/deposit/bookings";
import { isOwnLedgerEntry } from "@/lib/deposit/own-records";
import { route } from "@/lib/http";
import { ledger, type LedgerKind } from "@/lib/paypal";

/** The PayPal objects behind this app's bookings (orders, authorizations, captures). */
export const GET = route(async (req) => {
  const kind = req.nextUrl.searchParams.get("kind") as LedgerKind | null;
  const ids = ownPaypalIds();
  return { entries: ledger.list(kind ? { kind } : {}).filter((e) => isOwnLedgerEntry(e, ids)) };
});
