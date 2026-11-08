"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Check, MessageSquareWarning } from "lucide-react";
import { useKit } from "@/components/kit/kit-provider";
import { useToast } from "@/components/toast";
import { Badge, Button, Card, CardBody, EmptyState, Field, SkeletonCard, Textarea } from "@/components/ui";
import { formatCents, formatExactCents, localTime } from "@/lib/deposit/rules";
import type { RenterView } from "@/lib/deposit/types";
import { DamageItems, PriceTable } from "./damage-items";
import { PhotoFrame } from "./photo-frame";

function Headline({ view }: { view: RenterView }) {
  if (view.settled) return <>{formatCents(view.settled.capturedCents)} charged, {formatCents(view.settled.releasedCents)} released</>;
  if (!view.proposal) return <>Your {formatCents(view.depositCents)} deposit is on hold</>;
  if (view.split?.chargedCents) return <>{formatExactCents(view.split.chargedCents)} charged for what you accepted. {formatExactCents(view.split.contestedCents)} you contested is with the host.</>;
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
  // With more than one item, the renter can accept some and contest the rest. Ticked = contested.
  const [contested, setContested] = useState<Record<string, boolean>>({});
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
      const lines = view?.proposal?.lines ?? [];
      const accepted = lines.length > 1 ? lines.filter((line) => contested[line.id] === false).map((line) => line.id) : [];
      setView(await kitFetch<RenterView>(`/api/renter/${token}/respond`, { json: { decision, note: decision === "contested" ? note : undefined, ...(decision === "contested" && accepted.length ? { accepted_line_ids: accepted } : {}) } }));
    } catch (e) {
      toast({ title: "That didn't go through", description: (e as Error).message, variant: "error", durationMs: 7000 });
    } finally {
      setBusy(null);
    }
  }

  if (loadError) return <EmptyState title="Link not found" description={loadError} />;
  if (!view) return <SkeletonCard />;

  const { proposal, renterState, photos, split } = view;
  const lines = proposal?.lines ?? [];
  const choosing = lines.length > 1;
  const contestedCount = lines.filter((line) => contested[line.id] !== false).length;
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
              <div className="mt-3">
                <PriceTable highlight={proposal.lines.flatMap((line) => (line.price ? [line.price] : []))} />
              </div>
            </div>
            <div>
              <h2 className="mb-1 text-sm font-semibold text-zinc-900">Why</h2>
              <p className="text-sm leading-relaxed text-zinc-700" data-testid="renter-rationale">{proposal.rationale}</p>
              {proposal.hostReason ? <p className="mt-2 text-sm text-zinc-800" data-testid="renter-host-reason"><span className="font-medium">The host&rsquo;s note:</span> {proposal.hostReason}</p> : null}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Badge tone={proposal.simulated ? "warning" : "brand"}>{proposal.engine}</Badge>
                {view.confidence ? <Badge>Photo review confidence: {view.confidence}</Badge> : null}
              </div>
              <p className="mt-2 text-xs text-zinc-500">An AI compared the photos and named each mark. The amounts come from a fixed price table, not the AI. They are not repair quotes, and the host makes the final decision.</p>
            </div>
          </CardBody>
        </Card>
      ) : (
        <Card><CardBody className="py-6 text-sm text-zinc-600">The host hasn&rsquo;t finished the check-out yet. This page updates by itself.</CardBody></Card>
      )}

      {response?.decision === "contested" ? (
        <div data-testid="renter-contested" className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          <p className="font-semibold">{split ? `You accepted ${formatExactCents(split.acceptedCents)} and contested ${formatExactCents(split.contestedCents)}. The contested part is stopped until the host decides.` : "Your note went to the host. The charge is stopped until they decide."}</p>
          <p className="mt-1">&ldquo;{response.note}&rdquo;</p>
          {split?.chargedCents ? <p className="mt-1" data-testid="renter-part-charged">{formatExactCents(split.chargedCents)} for the items you accepted has been charged.</p> : null}
          <p className="mt-2 text-xs">From now on the host can only keep {split ? "the contested part" : "this charge"} at {formatExactCents(split ? split.contestedCents : response.amountCents)} or lower it, never raise it. This is a note inside this app, not a PayPal dispute. If you&rsquo;re charged and still disagree, you can open a dispute with PayPal.</p>
        </div>
      ) : null}

      {response?.decision === "accepted" ? <p data-testid="renter-accepted" className="rounded-lg bg-zinc-50 px-4 py-3 text-sm text-zinc-700">You accepted this charge. The host still has to approve it before anything moves.</p> : null}

      {view.canContest ? (
        <Card>
          <CardBody className="space-y-4 py-6">
            {renterState && !response ? <p className="text-sm text-zinc-700">You have until {localTime(renterState.deadline)} to answer. If you don&rsquo;t, the host may go ahead.</p> : null}
            {choosing ? (
              <fieldset className="space-y-2" data-testid="contest-lines">
                <legend className="mb-1 text-sm font-medium text-zinc-900">Which items do you disagree with?</legend>
                {lines.map((line) => (
                  <label key={line.id} className="flex items-start gap-2 text-sm text-zinc-700">
                    <input type="checkbox" className="mt-0.5 size-4 accent-brand" checked={contested[line.id] !== false} onChange={(e) => setContested((all) => ({ ...all, [line.id]: e.target.checked }))} data-testid={`contest-line-${line.id}`} />
                    <span>{line.description} <span className="tabular-nums text-zinc-500">({formatExactCents(line.amountCents)})</span></span>
                  </label>
                ))}
                <p className="text-xs text-zinc-500">Untick an item to accept it. Accepted items can be charged right away; the rest waits for the host.</p>
              </fieldset>
            ) : null}
            <Field label="Disagree? Tell the host why" htmlFor="contest-note" hint="Contesting stops the charge and sends this note to the host. This isn't a PayPal dispute.">
              <Textarea id="contest-note" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} data-testid="contest-note" />
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" icon={<MessageSquareWarning className="size-4" />} loading={busy === "contested"} disabled={!!busy || !note.trim() || (choosing && contestedCount === 0)} onClick={() => respond("contested")} data-testid="contest">
                {choosing && contestedCount < lines.length ? `Contest ${contestedCount} of ${lines.length} items` : "Contest this charge"}
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
