/**
 * The sandbox app's credentials are shared with other apps, and the starter seed adds shop orders,
 * invoices and payouts. A host should only see the PayPal records behind their own bookings.
 */
import type { LedgerEntry } from "@/lib/paypal/ledger";

export function isOwnLedgerEntry(entry: Pick<LedgerEntry, "paypalId" | "orderId" | "parentId">, ids: Set<string>): boolean {
  return [entry.paypalId, entry.orderId, entry.parentId].some((id) => !!id && ids.has(id));
}

/** A webhook belongs here when its payload names one of this app's order, authorization or capture ids. */
export function isOwnWebhook(event: { resource?: unknown }, ids: Set<string>): boolean {
  const payload = JSON.stringify(event.resource ?? null);
  return [...ids].some((id) => payload.includes(id));
}
