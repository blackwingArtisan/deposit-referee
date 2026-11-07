"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import type { ColDef } from "ag-grid-community";
import { DataGrid } from "@/components/data-grid";
import { useKit } from "@/components/kit/kit-provider";
import { PageHeader } from "@/components/shell/app-shell";
import { useToast } from "@/components/toast";
import { Stat } from "@/components/ui";
import { aiVersusHost, usd, type DepositRow } from "@/lib/deposit/insights";

/**
 * Sponsor UI sits behind a build-time switch. With NEXT_PUBLIC_SPONSOR_UI unset, the page shows
 * the plain grid, and next.config.ts aliases the sponsor's packages to a stub so none of their
 * code is built.
 */
const StudioDashboard =
  process.env.NEXT_PUBLIC_SPONSOR_UI === "1"
    ? dynamic(() => import("./studio-dashboard"), { ssr: false, loading: () => <p className="text-sm text-zinc-500">Loading the dashboard.</p> })
    : null;

const amount = (field: keyof DepositRow, headerName: string): ColDef<DepositRow> => ({
  field,
  headerName,
  type: "rightAligned",
  minWidth: 120,
  filter: "agNumberColumnFilter",
  valueFormatter: (p) => (p.value === null || p.value === undefined ? "" : usd(p.value as number)),
});

const COLUMNS: ColDef<DepositRow>[] = [
  { field: "property", headerName: "Property", minWidth: 170 },
  { field: "renter", headerName: "Renter", minWidth: 130 },
  { field: "stage", headerName: "Stage", minWidth: 130 },
  amount("held", "Held"),
  amount("charged", "Charged"),
  amount("released", "Released"),
  { colId: "aiVersusHost", headerName: "AI's figure vs yours", minWidth: 330, flex: 1, valueGetter: (p) => (p.data ? aiVersusHost(p.data) : ""), tooltipValueGetter: (p) => p.value as string },
  { field: "contested", headerName: "Contested", minWidth: 110 },
];

function PlainDashboard({ rows }: { rows: DepositRow[] | null }) {
  const totals = useMemo(() => (rows ?? []).reduce((sum, r) => ({ held: sum.held + r.held, charged: sum.charged + r.charged, released: sum.released + r.released, changed: sum.changed + (r.hostChanged === "Yes" ? 1 : 0) }), { held: 0, charged: 0, released: 0, changed: 0 }), [rows]);
  return (
    <div className="space-y-6" data-testid="plain-dashboard">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Held now" value={usd(totals.held)} />
        <Stat label="Charged" value={usd(totals.charged)} />
        <Stat label="Released" value={usd(totals.released)} />
        <Stat label="AI figure changed" value={totals.changed} hint="Bookings where you changed the AI's number" />
      </div>
      <DataGrid<DepositRow> rows={rows} columns={COLUMNS} getRowId={(r) => r.bookingId} searchPlaceholder="Search deposits…" emptyMessage="No bookings yet" />
    </div>
  );
}

export function DepositInsights() {
  const { kitFetch } = useKit();
  const { toast } = useToast();
  const [rows, setRows] = useState<DepositRow[] | null>(null);
  const [samples, setSamples] = useState(0);

  useEffect(() => {
    // Browser tests ask for their own rows with ?tests=1. Nobody else sees them.
    const tests = new URLSearchParams(window.location.search).has("tests");
    kitFetch<{ rows: DepositRow[]; samples: number }>(`/api/insights${tests ? "?tests=1" : ""}`)
      .then((r) => {
        setRows(r.rows);
        setSamples(r.samples);
      })
      .catch((e: Error) => toast({ title: "Could not load the dashboard", description: e.message, variant: "error" }));
  }, [kitFetch, toast]);

  return (
    <>
      <PageHeader title="Dashboard" description="What's held, charged and released by property, and where you changed the AI's number. Amounts come from PayPal, re-read when each deposit settled." />
      {samples ? <p data-testid="sample-note" className="mb-4 text-sm text-zinc-600">{samples === 1 ? "1 booking here is a sample" : `${samples} bookings here are samples`}, loaded so there&rsquo;s something to look at. They&rsquo;re marked on the Bookings page.</p> : null}
      {StudioDashboard ? rows ? <StudioDashboard rows={rows} /> : null : <PlainDashboard rows={rows} />}
    </>
  );
}
