"use client";

import type { LedgerEntry } from "@/lib/paypal/ledger";
import { col, DataGrid } from "../data-grid";

const KIND_LABEL: Record<string, string> = {
  order: "Order",
  authorization: "Authorization",
  capture: "Capture",
  refund: "Refund",
  payout: "Payout",
  invoice: "Invoice",
  dispute: "Dispute",
  payment_token: "Saved wallet",
};

/** AG Grid of the local PayPal ledger. */
export function LedgerGrid({ entries, height = 420, pageSize = 10 }: { entries: LedgerEntry[] | null; height?: number | "auto"; pageSize?: number | false }) {
  return (
    <DataGrid<LedgerEntry>
      rows={entries}
      getRowId={(r) => r.id}
      height={height}
      pageSize={pageSize}
      searchPlaceholder="Search ids, statuses, emails…"
      emptyMessage="No PayPal activity yet"
      columns={[
        col.date<LedgerEntry>("createdAt", "Created", { sort: null }), // rows arrive newest-first
        col.text<LedgerEntry>("kind", "Type", { valueFormatter: (p) => KIND_LABEL[p.value as string] ?? String(p.value), minWidth: 120 }),
        col.id<LedgerEntry>("paypalId", "PayPal ID"),
        col.status<LedgerEntry>("status"),
        col.money<LedgerEntry>("amount", "Amount", { direction: (r) => r.direction }),
        col.text<LedgerEntry>("counterparty", "Counterparty", { minWidth: 180 }),
        col.text<LedgerEntry>("description", "Details", { minWidth: 180 }),
      ]}
    />
  );
}
