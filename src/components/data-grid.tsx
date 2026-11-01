"use client";

/**
 * AG Grid (Community) with the kit's theme and sensible defaults: sortable, filterable,
 * resizable columns, quick search, pagination, empty state, brand accent.
 *
 *   <DataGrid rows={entries} columns={[col.date("createdAt"), col.status("status"), col.money("amount")]} getRowId={(r) => r.id} />
 */
import { useMemo, useState } from "react";
import { AllCommunityModule, ModuleRegistry, themeQuartz, type ColDef, type GetRowIdParams, type RowClickedEvent } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { Search } from "lucide-react";
import { formatMoney, type Money } from "@/lib/money";
import { MoneyBadge, type MoneyDirection } from "./money-badge";
import { StatusPill } from "./ui/badge";
import { cn } from "./ui/cn";

ModuleRegistry.registerModules([AllCommunityModule]);

export const kitGridTheme = themeQuartz.withParams({
  accentColor: "var(--brand)",
  backgroundColor: "#ffffff",
  foregroundColor: "#18181b",
  borderColor: "#e4e4e7",
  headerBackgroundColor: "#fafafa",
  headerTextColor: "#52525b",
  headerFontWeight: 600,
  fontFamily: "inherit",
  fontSize: 13,
  rowHeight: 46,
  headerHeight: 40,
  wrapperBorderRadius: 12,
  rowHoverColor: "color-mix(in oklab, var(--brand) 5%, white)",
  selectedRowBackgroundColor: "color-mix(in oklab, var(--brand) 9%, white)",
  oddRowBackgroundColor: "#ffffff",
  spacing: 7,
});

const moneyNumber = (m: Money | undefined | null) => (m ? Number(m.value) : null);

/** Column helpers with renderers that match the rest of the UI. */
export const col = {
  text<T>(field: keyof T & string, headerName?: string, extra: Partial<ColDef<T>> = {}): ColDef<T> {
    return { field: field as unknown as ColDef<T>["field"], headerName, ...extra };
  },
  id<T>(field: keyof T & string, headerName = "ID", extra: Partial<ColDef<T>> = {}): ColDef<T> {
    return { field: field as unknown as ColDef<T>["field"], headerName, cellClass: "font-mono text-[12px] text-zinc-600", minWidth: 170, ...extra };
  },
  status<T>(field: keyof T & string, headerName = "Status", extra: Partial<ColDef<T>> = {}): ColDef<T> {
    return {
      field: field as unknown as ColDef<T>["field"],
      headerName,
      minWidth: 150,
      cellRenderer: (p: { value?: string }) => (p.value ? <StatusPill status={p.value} /> : null),
      ...extra,
    };
  },
  money<T>(field: keyof T & string, headerName = "Amount", opts: { direction?: (row: T) => MoneyDirection } & Partial<ColDef<T>> = {}): ColDef<T> {
    const { direction, ...extra } = opts;
    return {
      field: field as unknown as ColDef<T>["field"],
      headerName,
      type: "rightAligned",
      minWidth: 130,
      comparator: (a: Money, b: Money) => (moneyNumber(a) ?? 0) - (moneyNumber(b) ?? 0),
      filter: "agNumberColumnFilter",
      filterValueGetter: (p) => moneyNumber((p.data as Record<string, unknown> | undefined)?.[field] as Money | undefined),
      getQuickFilterText: (p) => (p.value ? formatMoney(p.value as Money) : ""),
      valueFormatter: (p) => (p.value ? formatMoney(p.value as Money) : ""),
      cellRenderer: (p: { value?: Money; data?: T }) => (p.value ? <MoneyBadge amount={p.value} direction={p.data && direction ? direction(p.data) : "neutral"} size="sm" /> : null),
      ...extra,
    };
  },
  date<T>(field: keyof T & string, headerName = "Date", extra: Partial<ColDef<T>> = {}): ColDef<T> {
    return {
      field: field as unknown as ColDef<T>["field"],
      headerName,
      minWidth: 160,
      sort: "desc",
      valueFormatter: (p) => (p.value ? new Date(p.value as string).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : ""),
      ...extra,
    };
  },
};

export function DataGrid<T>({
  rows,
  columns,
  getRowId,
  height = 420,
  search = true,
  searchPlaceholder = "Search…",
  pageSize = 10,
  loading,
  emptyMessage = "No rows yet",
  onRowClicked,
  toolbar,
  className,
}: {
  rows: T[] | null | undefined;
  columns: ColDef<T>[];
  getRowId?: (row: T) => string;
  height?: number | "auto";
  search?: boolean;
  searchPlaceholder?: string;
  pageSize?: number | false;
  loading?: boolean;
  emptyMessage?: string;
  onRowClicked?: (row: T) => void;
  toolbar?: React.ReactNode;
  className?: string;
}) {
  const [quickFilter, setQuickFilter] = useState("");
  const defaultColDef = useMemo<ColDef<T>>(() => ({ sortable: true, filter: true, resizable: true, flex: 1, minWidth: 110, suppressHeaderMenuButton: false }), []);
  return (
    <div className={cn("flex flex-col gap-3", className)} data-testid="data-grid">
      {search || toolbar ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          {search ? (
            <div className="relative w-full max-w-xs">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400" />
              <input
                value={quickFilter}
                onChange={(e) => setQuickFilter(e.target.value)}
                placeholder={searchPlaceholder}
                className="h-9 w-full rounded-lg border border-zinc-200 bg-white pl-9 pr-3 text-sm shadow-sm placeholder:text-zinc-400 focus:border-brand-400 focus:outline-none focus:ring-4 focus:ring-brand-100"
              />
            </div>
          ) : (
            <span />
          )}
          {toolbar}
        </div>
      ) : null}
      <div style={{ height: height === "auto" ? undefined : height }}>
        <AgGridReact<T>
          theme={kitGridTheme}
          rowData={rows ?? []}
          columnDefs={columns}
          defaultColDef={defaultColDef}
          domLayout={height === "auto" ? "autoHeight" : "normal"}
          quickFilterText={quickFilter}
          getRowId={getRowId ? (p: GetRowIdParams<T>) => getRowId(p.data) : undefined}
          pagination={pageSize !== false}
          paginationPageSize={pageSize || undefined}
          paginationPageSizeSelector={pageSize ? [pageSize, pageSize * 2, pageSize * 5] : undefined}
          loading={loading ?? rows == null}
          overlayNoRowsTemplate={`<span class="text-sm text-zinc-500">${emptyMessage}</span>`}
          animateRows
          suppressCellFocus
          onRowClicked={onRowClicked ? (e: RowClickedEvent<T>) => e.data && onRowClicked(e.data) : undefined}
        />
      </div>
    </div>
  );
}
