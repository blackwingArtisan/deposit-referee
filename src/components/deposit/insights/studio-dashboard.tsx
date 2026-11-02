"use client";

/**
 * The host's self-serve dashboard, built with AG Studio. Only reaches the browser when
 * NEXT_PUBLIC_SPONSOR_UI=1 at build time; see deposit-insights.tsx.
 */
import { useMemo, useState } from "react";
import type { AgDataSourcesDefinition, AgReportState } from "ag-studio";
import { AgStudio, AgStudioProvider } from "ag-studio-react";
import { Button } from "@/components/ui";
import type { DepositRow } from "@/lib/deposit/insights";

const STORAGE_KEY = "deposit-referee:studio-report";

const value = (field: keyof DepositRow, title: string) => ({
  type: "value" as const,
  dataMapping: { value: [{ id: `deposits.${field}`, aggregation: "sum" as const }] },
  format: { title: { enabled: true, text: title } },
});

const REPORT: AgReportState = {
  selectedPageId: "overview",
  pages: [
    {
      id: "overview",
      widgets: {
        held: value("held", "Held now"),
        charged: value("charged", "Charged"),
        released: value("released", "Released"),
        "host-change": value("hostChange", "Host change vs AI"),
        "by-property": {
          type: "bar-chart-stacked",
          dataMapping: {
            categoryKey: [{ id: "deposits.property" }],
            valueKey: [
              { id: "deposits.held", aggregation: "sum" },
              { id: "deposits.charged", aggregation: "sum" },
              { id: "deposits.released", aggregation: "sum" },
            ],
          },
          format: { title: { enabled: true, text: "Held, charged and released by property" } },
        },
        "ai-vs-charged": {
          type: "bar-chart-grouped",
          dataMapping: {
            categoryKey: [{ id: "deposits.property" }],
            valueKey: [
              { id: "deposits.aiProposed", aggregation: "sum" },
              { id: "deposits.charged", aggregation: "sum" },
            ],
          },
          format: { title: { enabled: true, text: "AI proposed vs charged" } },
        },
        deposits: {
          type: "grid",
          dataMapping: {
            cols: [
              { id: "deposits.property" },
              { id: "deposits.renter" },
              { id: "deposits.stage" },
              { id: "deposits.hostChanged" },
              { id: "deposits.contested" },
              { id: "deposits.aiProposed", aggregation: "sum" },
              { id: "deposits.charged", aggregation: "sum" },
              { id: "deposits.released", aggregation: "sum" },
              { id: "deposits.hostChange", aggregation: "sum" },
            ],
          },
          format: { title: { enabled: true, text: "Every deposit" } },
        },
      },
      widgetLayout: {
        held: { xTrack: 0, yTrack: 0, xSpan: 6, ySpan: 7 },
        charged: { xTrack: 6, yTrack: 0, xSpan: 6, ySpan: 7 },
        released: { xTrack: 12, yTrack: 0, xSpan: 6, ySpan: 7 },
        "host-change": { xTrack: 18, yTrack: 0, xSpan: 6, ySpan: 7 },
        "by-property": { xTrack: 0, yTrack: 7, xSpan: 12, ySpan: 18 },
        "ai-vs-charged": { xTrack: 12, yTrack: 7, xSpan: 12, ySpan: 18 },
        deposits: { xTrack: 0, yTrack: 25, xSpan: 24, ySpan: 20 },
      },
    },
  ],
};

/** A saved layout is a convenience for this browser; the page works without it. */
function savedReport(): AgReportState {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    return saved ? (JSON.parse(saved) as AgReportState) : REPORT;
  } catch {
    return REPORT;
  }
}

function saveReport(state: AgReportState) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* no storage in this browser: the layout just won't be remembered */
  }
}

export default function StudioDashboard({ rows }: { rows: DepositRow[] }) {
  const [mode, setMode] = useState<"view" | "edit">("view");
  const data = useMemo<AgDataSourcesDefinition>(() => ({ sources: [{ id: "deposits", name: "Deposits", data: rows as unknown as Record<string, string | number | null>[] }] }), [rows]);
  const [initialState] = useState(savedReport);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-zinc-600">{mode === "edit" ? "Drag fields and widgets to build your own view. It's saved in this browser." : "Click a bar to filter the rest of the page."}</p>
        <Button variant="secondary" size="sm" onClick={() => setMode(mode === "edit" ? "view" : "edit")} data-testid="studio-mode">
          {mode === "edit" ? "Done" : "Customize"}
        </Button>
      </div>
      <div data-testid="studio-host" style={{ height: 860 }}>
        <AgStudioProvider licenseKey={process.env.AG_STUDIO_LICENSE_KEY}>
          <AgStudio style={{ height: "100%", width: "100%" }} data={data} initialState={initialState} mode={mode} onStateUpdated={(e) => saveReport(e.state)} />
        </AgStudioProvider>
      </div>
      <p className="text-xs text-zinc-500">Dashboard built with AG Studio, used under evaluation.</p>
    </div>
  );
}
