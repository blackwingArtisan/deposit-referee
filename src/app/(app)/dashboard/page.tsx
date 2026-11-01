"use client";

/**
 * APP TEMPLATE: the logged-in home. Replace the KPIs and panels with your app's own; keep the
 * timeline visible somewhere so judges can watch the agent work.
 */
import { useMemo, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, Database, FileText, Lock, Sparkles } from "lucide-react";
import { ToolCallTimeline } from "@/components/agent/tool-call-timeline";
import { readTextStream } from "@/components/ai/read-text-stream";
import { useKit } from "@/components/kit/kit-provider";
import { useLedger } from "@/components/kit/use-ledger";
import { useTimeline } from "@/components/kit/use-timeline";
import { LedgerGrid } from "@/components/ledger/ledger-grid";
import { PageHeader } from "@/components/shell/app-shell";
import { useToast } from "@/components/toast";
import { Button, ButtonLink, Card, CardBody, CardHeader, Stat } from "@/components/ui";
import { formatMoney, moneyFromMinor, toMinor } from "@/lib/money";
import type { LedgerEntry } from "@/lib/paypal/ledger";

function total(entries: LedgerEntry[], pred: (e: LedgerEntry) => boolean) {
  const minor = entries.filter((e) => pred(e) && e.amount?.currency_code === "USD").reduce((s, e) => s + toMinor(e.amount!.value, "USD"), 0);
  return formatMoney(moneyFromMinor(minor, "USD"));
}

export default function DashboardPage() {
  const { kitFetch, sessionId, status } = useKit();
  const { toast } = useToast();
  const ledger = useLedger();
  const { steps } = useTimeline({ onEvent: ledger.onTimelineEvent });
  const [seeding, setSeeding] = useState(false);
  const [summary, setSummary] = useState("");
  const [summarizing, setSummarizing] = useState(false);
  const entries = useMemo(() => ledger.entries ?? [], [ledger.entries]);

  async function seed() {
    setSeeding(true);
    try {
      const res = await kitFetch<{ created: Record<string, number> }>("/api/dev/seed", { method: "POST" });
      toast({ title: "Demo data loaded", description: Object.entries(res.created).map(([k, v]) => `${v} ${k}`).join(", "), variant: "success" });
      await ledger.refresh();
    } catch (e) {
      toast({ title: "Seeding failed", description: (e as Error).message, variant: "error" });
    } finally {
      setSeeding(false);
    }
  }

  async function summarize() {
    setSummarizing(true);
    setSummary("");
    try {
      const res = await fetch("/api/ai/summarize", { method: "POST", headers: { "x-kit-session": sessionId } });
      await readTextStream(res, (full) => setSummary(full));
    } catch (e) {
      toast({ title: "AI summary failed", description: (e as Error).message, variant: "error" });
    } finally {
      setSummarizing(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Your PayPal activity, what the agent did, and what needs you."
        actions={
          <>
            {status?.paypal.mode === "mock" ? (
              <Button variant="secondary" icon={<Database className="size-4" />} loading={seeding} onClick={seed} data-testid="seed">
                Load demo data
              </Button>
            ) : null}
            <ButtonLink href="/example">Run the example flow</ButtonLink>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Captured" value={total(entries, (e) => e.kind === "capture")} icon={<ArrowDownLeft className="size-4" />} hint="Money received" />
        <Stat label="Refunded" value={total(entries, (e) => e.kind === "refund")} icon={<ArrowUpRight className="size-4" />} hint="Returned to buyers" />
        <Stat label="On hold" value={total(entries, (e) => e.kind === "authorization" && (e.status === "CREATED" || e.status === "PARTIALLY_CAPTURED"))} icon={<Lock className="size-4" />} hint="Open authorizations" />
        <Stat label="Invoices due" value={total(entries, (e) => e.kind === "invoice" && ["SENT", "UNPAID", "PARTIALLY_PAID"].includes(e.status))} icon={<FileText className="size-4" />} hint="Sent, not yet paid" />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader
            title="Recent PayPal activity"
            description="From the local ledger (PayPal has no list-orders API)."
            action={
              <Button size="sm" variant="secondary" icon={<Sparkles className="size-4" />} loading={summarizing} onClick={summarize} data-testid="summarize">
                Summarize with AI
              </Button>
            }
          />
          <CardBody>
            {summary ? <p className="mb-4 rounded-xl border border-violet-200 bg-violet-50/60 p-3 text-sm leading-relaxed text-zinc-800">{summary}</p> : null}
            <LedgerGrid entries={ledger.entries} height={460} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Live timeline" description="This session and incoming webhooks." />
          <CardBody>
            <ToolCallTimeline steps={steps} className="max-h-[540px]" />
          </CardBody>
        </Card>
      </div>
    </>
  );
}
