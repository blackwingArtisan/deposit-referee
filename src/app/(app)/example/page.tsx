"use client";

/**
 * Kit example: AUTHORIZE order -> buyer approval -> partial capture -> void the rest,
 * by hand or by the settlement agent, with the live timeline and the ledger grid.
 * Delete this page (and src/agents/settlement.ts) once your app has its own flow.
 */
import { useCallback, useState } from "react";
import { Bot, Hand, PackageCheck, RotateCcw } from "lucide-react";
import { ToolCallTimeline } from "@/components/agent/tool-call-timeline";
import { useCaption } from "@/components/caption";
import { ApiError, useKit } from "@/components/kit/kit-provider";
import { useLedger } from "@/components/kit/use-ledger";
import { useTimeline } from "@/components/kit/use-timeline";
import { LedgerGrid } from "@/components/ledger/ledger-grid";
import { MoneyBadge } from "@/components/money-badge";
import { CheckoutButton } from "@/components/paypal/checkout-button";
import { PageHeader } from "@/components/shell/app-shell";
import { useToast } from "@/components/toast";
import { Badge, Button, Card, CardBody, CardHeader, Field, Input, MoneyInput, StatusPill } from "@/components/ui";
import { formatMoney, type Money } from "@/lib/money";
import type { Authorization, Order } from "@/lib/paypal/types";
import type { TimelineEvent } from "@/lib/events/types";

interface AuthSummary {
  authorization: Authorization;
  captured: Money;
  remaining: Money;
  order_id?: string;
}

const SHIPPED = [
  { name: "Ceramic pour-over set", price: "55.00", shipped: true },
  { name: "Gooseneck kettle", price: "25.00", shipped: true },
  { name: "Burr grinder", price: "40.00", shipped: false },
];

function Step({ n, title, done, children }: { n: number; title: string; done?: boolean; children: React.ReactNode }) {
  return (
    <div className="relative pl-11">
      <span className={`absolute left-0 top-0 flex size-8 items-center justify-center rounded-full text-sm font-semibold ${done ? "bg-emerald-600 text-white" : "bg-brand text-brand-foreground"}`}>{done ? "✓" : n}</span>
      <h3 className="font-semibold text-zinc-900">{title}</h3>
      <div className="mt-3">{children}</div>
    </div>
  );
}

export default function ExamplePage() {
  const { kitFetch, status } = useKit();
  const { toast } = useToast();
  const { caption, autoCaptions } = useCaption();
  const ledger = useLedger();
  const [amount, setAmount] = useState("120.00");
  const [description, setDescription] = useState("Order #1042 · 3 items");
  const [order, setOrder] = useState<Order | null>(null);
  const [auth, setAuth] = useState<AuthSummary | null>(null);
  const [captureAmount, setCaptureAmount] = useState("45.00");
  const [busy, setBusy] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);

  const refreshAuth = useCallback(
    async (id?: string) => {
      const authId = id ?? auth?.authorization.id;
      if (!authId) return;
      setAuth(await kitFetch<AuthSummary>(`/api/paypal/authorizations/${authId}`));
    },
    [auth?.authorization.id, kitFetch],
  );

  const onEvent = useCallback(
    (e: TimelineEvent) => {
      ledger.onTimelineEvent(e);
      if (e.kind === "tool" && e.status === "succeeded" && /capture_authorization|void_authorization/.test(e.tool?.name ?? "")) void refreshAuth();
      if (autoCaptions && e.kind === "agent.message" && e.detail) caption(e.detail, 3800);
    },
    [ledger, refreshAuth, autoCaptions, caption],
  );
  const { steps } = useTimeline({ onEvent });

  const fail = (title: string, e: unknown) => {
    const debug = e instanceof ApiError && e.debugId ? ` (debug_id ${e.debugId})` : "";
    toast({ title, description: `${(e as Error).message}${debug}`, variant: "error", durationMs: 7000 });
  };

  async function createOrder() {
    const o = await kitFetch<Order>("/api/paypal/orders", { json: { intent: "AUTHORIZE", amount, description } });
    setOrder(o);
    setAuth(null);
    setRunId(null);
    return { orderId: o.id };
  }

  async function onApprove({ orderId }: { orderId: string }) {
    setBusy("authorize");
    try {
      const o = await kitFetch<Order>(`/api/paypal/orders/${orderId}/authorize`, { method: "POST" });
      setOrder(o);
      const a = o.purchase_units?.[0]?.payments?.authorizations?.[0];
      if (a) await refreshAuth(a.id);
      toast({ title: `Authorized ${formatMoney(a?.amount)}`, description: `Hold placed (authorization ${a?.id}).`, variant: "success" });
    } catch (e) {
      fail("Authorization failed", e);
    } finally {
      setBusy(null);
    }
  }

  async function capture() {
    if (!auth) return;
    setBusy("capture");
    try {
      const cap = await kitFetch<{ id: string; amount: Money }>(`/api/paypal/authorizations/${auth.authorization.id}/capture`, { json: { amount: captureAmount, final_capture: false } });
      toast({ title: `Captured ${formatMoney(cap.amount)}`, description: `Capture ${cap.id}`, variant: "success" });
      await refreshAuth();
    } catch (e) {
      fail("Capture failed", e);
    } finally {
      setBusy(null);
    }
  }

  async function voidRest() {
    if (!auth) return;
    setBusy("void");
    try {
      await kitFetch(`/api/paypal/authorizations/${auth.authorization.id}/void`, { method: "POST" });
      toast({ title: "Remaining hold voided", description: `${formatMoney(auth.remaining)} released to the buyer.`, variant: "success" });
      await refreshAuth();
    } catch (e) {
      fail("Void failed", e);
    } finally {
      setBusy(null);
    }
  }

  async function runAgent() {
    if (!auth) return;
    setBusy("agent");
    try {
      const shipped = SHIPPED.filter((i) => i.shipped);
      const value = shipped.reduce((s, i) => s + Number(i.price), 0).toFixed(2);
      const { run } = await kitFetch<{ run: { id: string } }>("/api/agent/runs", {
        json: {
          agentId: "settlement",
          goal: `Order "${description}" shipped ${shipped.length} of ${SHIPPED.length} items. Capture what shipped and release the rest of the hold.`,
          context: {
            authorization_id: auth.authorization.id,
            authorized_amount: auth.authorization.amount,
            items: SHIPPED,
            capture_amount: value,
            currency_code: auth.authorization.amount.currency_code,
          },
        },
      });
      setRunId(run.id);
    } catch (e) {
      fail("Could not start the agent", e);
    } finally {
      setBusy(null);
    }
  }

  async function reset() {
    try {
      if (status?.paypal.mode === "mock") await kitFetch("/api/dev/reset", { method: "POST" });
      setOrder(null);
      setAuth(null);
      setRunId(null);
      await ledger.refresh();
    } catch (e) {
      fail("Reset failed", e);
    }
  }

  const a = auth?.authorization;
  const settledPct = a ? Math.min(100, (Number(auth!.captured.value) / Number(a.amount.value)) * 100) : 0;
  const open = a && (a.status === "CREATED" || a.status === "PARTIALLY_CAPTURED");

  return (
    <>
      <PageHeader
        eyebrow="Kit example"
        title="Authorize, capture part, void the rest"
        description="A buyer approves a hold for the whole order. When only some items ship, capture what shipped and release the remainder, yourself or with the guarded settlement agent."
        actions={
          <Button variant="secondary" icon={<RotateCcw className="size-4" />} onClick={reset}>
            Start over
          </Button>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
        <Card>
          <CardHeader title="Checkout and settlement" description="Every action goes through the same server routes as production code." />
          <CardBody className="space-y-8 py-6">
            <Step n={1} title="Buyer approves a hold for the order" done={!!a}>
              <div className="grid gap-3 sm:grid-cols-[140px_1fr]">
                <Field label="Amount">
                  <MoneyInput value={amount} onChange={(e) => setAmount(e.target.value)} disabled={!!order && !a} aria-label="Order amount" />
                </Field>
                <Field label="Description">
                  <Input value={description} onChange={(e) => setDescription(e.target.value)} />
                </Field>
              </div>
              <div className="mt-4">
                {!a ? (
                  <CheckoutButton createOrder={createOrder} onApprove={onApprove} amountLabel={formatMoney({ currency_code: "USD", value: amount })} onError={(e) => fail("Checkout failed", e)} disabled={busy === "authorize"} />
                ) : (
                  <div className="flex flex-wrap items-center gap-2 text-sm text-zinc-600">
                    <span>Order</span>
                    <span className="font-mono text-xs">{order?.id}</span>
                    <StatusPill status={order?.status ?? ""} />
                  </div>
                )}
              </div>
            </Step>

            <Step n={2} title="Authorization (funds on hold)" done={!!a && !open}>
              {a ? (
                <div className="rounded-xl border border-zinc-200 bg-zinc-50/60 p-4" data-testid="authorization-panel">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-mono text-xs text-zinc-600">{a.id}</span>
                    <StatusPill status={a.status} />
                  </div>
                  <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-zinc-200">
                    <div className="h-full rounded-full bg-emerald-500 transition-all duration-700" style={{ width: `${settledPct}%` }} />
                  </div>
                  <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
                    <div>
                      <dt className="text-zinc-500">Authorized</dt>
                      <dd><MoneyBadge amount={a.amount} direction="hold" size="sm" /></dd>
                    </div>
                    <div>
                      <dt className="text-zinc-500">Captured</dt>
                      <dd><MoneyBadge amount={auth!.captured} direction="in" size="sm" /></dd>
                    </div>
                    <div>
                      <dt className="text-zinc-500">{a.status === "VOIDED" ? "Released" : "Remaining"}</dt>
                      <dd><MoneyBadge amount={auth!.remaining} direction="neutral" size="sm" /></dd>
                    </div>
                  </dl>
                  <p className="mt-3 text-xs text-zinc-500">Valid until {new Date(a.expiration_time).toLocaleDateString()} (29 days). Capture within the 3-day honor period for best results.</p>
                </div>
              ) : (
                <p className="text-sm text-zinc-500">Appears after the buyer approves and the server authorizes the order.</p>
              )}
            </Step>

            <Step n={3} title="Settle: 2 of 3 items shipped" done={!!a && !open}>
              <ul className="mb-4 space-y-1.5 text-sm">
                {SHIPPED.map((i) => (
                  <li key={i.name} className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2">
                      <PackageCheck className={`size-4 ${i.shipped ? "text-emerald-600" : "text-zinc-300"}`} />
                      <span className={i.shipped ? "text-zinc-800" : "text-zinc-400 line-through"}>{i.name}</span>
                      {!i.shipped ? <Badge tone="warning">out of stock</Badge> : null}
                    </span>
                    <span className="tabular-nums text-zinc-600">${i.price}</span>
                  </li>
                ))}
              </ul>
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-xl border border-zinc-200 p-4">
                  <p className="flex items-center gap-2 text-sm font-semibold text-zinc-900">
                    <Hand className="size-4 text-zinc-500" /> Do it yourself
                  </p>
                  <div className="mt-3 flex gap-2">
                    <MoneyInput value={captureAmount} onChange={(e) => setCaptureAmount(e.target.value)} className="w-28" aria-label="Capture amount" />
                    <Button onClick={capture} disabled={!open || !!busy || !!runId} loading={busy === "capture"} data-testid="partial-capture">
                      Capture
                    </Button>
                  </div>
                  <Button variant="secondary" className="mt-2 w-full" onClick={voidRest} disabled={!open || !!busy || !!runId} loading={busy === "void"} data-testid="void-rest">
                    Void remaining {auth && open ? formatMoney(auth.remaining) : ""}
                  </Button>
                </div>
                <div className="rounded-xl border border-brand-200 bg-brand-50/50 p-4">
                  <p className="flex items-center gap-2 text-sm font-semibold text-zinc-900">
                    <Bot className="size-4 text-brand" /> Let the agent settle it
                  </p>
                  <p className="mt-2 text-sm text-zinc-600">
                    {status?.ai.mode === "live" ? `${status.ai.models.default} plans it` : "Scripted agent (AI mock mode)"}, calls guarded PayPal tools, and asks you before capturing more than ${status?.policy.approvalThreshold ?? "50.00"}.
                  </p>
                  <Button className="mt-3 w-full" onClick={runAgent} disabled={!open || !!busy || !!runId} loading={busy === "agent"} icon={<Bot className="size-4" />} data-testid="run-agent">
                    Ask the settlement agent
                  </Button>
                </div>
              </div>
            </Step>
          </CardBody>
        </Card>

        <Card className="flex flex-col">
          <CardHeader title="Live timeline" description="Agent steps, guard decisions and every PayPal call, as they happen." action={runId ? <Badge tone="brand">{runId}</Badge> : undefined} />
          <CardBody className="flex-1">
            <ToolCallTimeline steps={steps.filter((s) => s.channel !== "global" || s.kind === "webhook")} className="max-h-[720px] min-h-[420px]" />
          </CardBody>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader title="PayPal ledger" description="Every PayPal object this app touched, updated from API responses and webhooks." />
        <CardBody>
          <LedgerGrid entries={ledger.entries} height="auto" />
        </CardBody>
      </Card>
    </>
  );
}
