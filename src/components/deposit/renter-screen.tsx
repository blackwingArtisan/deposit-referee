"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Check, MessageSquareWarning } from "lucide-react";
import { useKit } from "@/components/kit/kit-provider";
import { useToast } from "@/components/toast";
import { Badge, Button, Card, CardBody, EmptyState, Field, SkeletonCard, Textarea } from "@/components/ui";
import { formatCents, formatExactCents, localTime } from "@/lib/deposit/rules";
import type { RenterView } from "@/lib/deposit/types";
import { DamageItems } from "./damage-items";
import { PhotoFrame } from "./photo-frame";

function Headline({ view }: { view: RenterView }) {
  if (view.settled) return <>{formatCents(view.settled.capturedCents)} charged, {formatCents(view.settled.releasedCents)} released</>;
  if (!view.proposal) return <>Your {formatCents(view.depositCents)} deposit is on hold</>;
  if (view.chargeCents === 0) return <>No charge proposed. Your {formatCents(view.depositCents)} deposit is going back.</>;
  return <>Proposed charge: {formatExactCents(view.chargeCents)}. {formatExactCents(view.releaseCents)} goes back to you.</>;
}

/** The renter's own page: the proposal, its evidence, and a way to say no before any capture. */
export function RenterScreen() {
  const { token } = useParams<{ token: string }>();
  const { kitFetch } = useKit();
  const { toast } = useToast();
  const [view, setView] = useState<RenterView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => kitFetch<RenterView>(`/api/renter/${token}`), [kitFetch, token]);

  useEffect(() => {
    let live = true;
    const tick = () =>
      load()
        .then((v) => {
          if (live) setView(v);
        })
        .catch((e: Error) => {
          if (live) setLoadError(e.message);
        });
    void tick();
    const timer = setInterval(tick, 3000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [load]);

  async function respond(decision: "accepted" | "contested") {
    setBusy(decision);
    try {
      setView(await kitFetch<RenterView>(`/api/renter/${token}/respond`, { json: { decision, note: decision === "contested" ? note : undefined } }));
    } catch (e) {
      toast({ title: "That didn't go through", description: (e as Error).message, variant: "error", durationMs: 7000 });
    } finally {
      setBusy(null);
    }
  }

  if (loadError) return <EmptyState title="Link not found" description={loadError} />;
  if (!view) return <SkeletonCard />;

  const { proposal, renterState, photos } = view;
  const response = renterState?.response;
  return (
    <main className="mx-auto max-w-3xl space-y-6 px-4 py-8 sm:py-12">
      <header>
        <p className="text-sm font-medium text-brand">Deposit for {view.item}</p>
        <h1 data-testid="renter-headline" className="mt-1 text-2xl font-semibold tracking-tight text-zinc-900 tabular-nums sm:text-3xl"><Headline view={view} /></h1>
        <p className="mt-2 text-[15px] text-zinc-600">Hi {view.renter}. Nothing is charged while this is open. The money is held by PayPal, not taken.</p>
      </header>

      {proposal ? (
        <Card>
          <CardBody className="space-y-5 py-6">
            <div className="grid gap-4 sm:grid-cols-2">
              {photos.check_in ? <PhotoFrame label="Check-in" photo={photos.check_in} /> : null}
              {photos.check_out ? <PhotoFrame label="Check-out" photo={photos.check_out} items={proposal.lines} /> : null}
            </div>
            <div>
              <h2 className="mb-2 text-sm font-semibold text-zinc-900">What&rsquo;s proposed</h2>
              <DamageItems lines={proposal.lines} />
            </div>
            <div>
              <h2 className="mb-1 text-sm font-semibold text-zinc-900">Why</h2>
              <p className="text-sm leading-relaxed text-zinc-700" data-testid="renter-rationale">{proposal.rationale}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Badge tone={proposal.simulated ? "warning" : "brand"}>{proposal.engine}</Badge>
                {view.confidence ? <Badge>Photo review confidence: {view.confidence}</Badge> : null}
              </div>
              <p className="mt-2 text-xs text-zinc-500">An AI compared the photos and proposed this. The amounts are not repair quotes, and the host makes the final decision.</p>
            </div>
          </CardBody>
        </Card>
      ) : (
        <Card><CardBody className="py-6 text-sm text-zinc-600">The host hasn&rsquo;t finished the check-out yet. This page updates by itself.</CardBody></Card>
      )}

      {response?.decision === "contested" ? (
        <div data-testid="renter-contested" className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          <p className="font-semibold">Your note went to the host. The charge is stopped until they decide.</p>
          <p className="mt-1">&ldquo;{response.note}&rdquo;</p>
          <p className="mt-2 text-xs">This is a note to the host inside this app, not a PayPal dispute. If you&rsquo;re charged and still disagree, you can open a dispute with PayPal.</p>
        </div>
      ) : null}

      {response?.decision === "accepted" ? <p data-testid="renter-accepted" className="rounded-lg bg-zinc-50 px-4 py-3 text-sm text-zinc-700">You accepted this charge. The host still has to approve it before anything moves.</p> : null}

      {view.canContest ? (
        <Card>
          <CardBody className="space-y-4 py-6">
            {renterState && !response ? <p className="text-sm text-zinc-700">You have until {localTime(renterState.deadline)} to answer. If you don&rsquo;t, the host may go ahead.</p> : null}
            <Field label="Disagree? Tell the host why" htmlFor="contest-note" hint="Contesting stops the charge and sends this note to the host. This isn't a PayPal dispute.">
              <Textarea id="contest-note" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} data-testid="contest-note" />
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" icon={<MessageSquareWarning className="size-4" />} loading={busy === "contested"} disabled={!!busy || !note.trim()} onClick={() => respond("contested")} data-testid="contest">
                Contest this charge
              </Button>
              {view.canAccept ? (
                <Button icon={<Check className="size-4" />} loading={busy === "accepted"} disabled={!!busy} onClick={() => respond("accepted")} data-testid="accept">
                  Accept
                </Button>
              ) : null}
            </div>
          </CardBody>
        </Card>
      ) : null}
    </main>
  );
}
