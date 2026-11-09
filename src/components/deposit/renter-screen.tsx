"use client";

import { useCallback, useEffect, useState, type ChangeEvent, type ReactNode } from "react";
import { useParams } from "next/navigation";
import { Camera, Check, ChevronDown, CircleCheck, Eye, ImagePlus, Lock, MessageSquareWarning, ScanSearch, Upload, X } from "lucide-react";
import { CheckoutButton } from "@/components/paypal/checkout-button";
import { useKit } from "@/components/kit/kit-provider";
import { useToast } from "@/components/toast";
import { Badge, Button, Card, CardBody, EmptyState, Field, SkeletonCard, Textarea } from "@/components/ui";
import { formatCents, formatExactCents, localTime } from "@/lib/deposit/rules";
import type { ChargeLine, PhotoSlot, RenterView } from "@/lib/deposit/types";
import { DamageItems, PriceSource, PriceTable } from "./damage-items";
import { photoDataUrl } from "./photo-file";
import { PhotoFrame, RENTER_SLOTS } from "./photo-frame";
import { Ruling } from "./ruling";
import { SecondLookLineRow } from "./second-look";

const longDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

function Headline({ view }: { view: RenterView }) {
  if (view.status === "draft") return <>Place your {formatCents(view.depositCents)} deposit hold</>;
  if (view.settled) return <>{formatCents(view.settled.capturedCents)} charged, {formatCents(view.settled.releasedCents)} released</>;
  if (!view.proposal) return <>Your {formatCents(view.depositCents)} deposit is on hold</>;
  if (view.secondLook?.status === "sent" && view.secondLook.lines) return <>Counter: {formatExactCents(view.secondLook.lines.reduce((sum, l) => sum + l.toCents, 0))} for what you contested</>;
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
  // The renter's answer to each item, by line id. Unanswered items have no entry.
  const [choice, setChoice] = useState<Record<string, "accept" | "contest">>({});
  const [busy, setBusy] = useState<string | null>(null);
  // The renter's own photo for a contested item, by line id, sent with the contest.
  const [evidence, setEvidence] = useState<Record<string, string>>({});

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

  /** No file: the demo close-up at check-in. */
  async function addPhoto(slot: PhotoSlot, event?: ChangeEvent<HTMLInputElement>) {
    const file = event?.target.files?.[0];
    if (event) event.target.value = "";
    if (event && !file) return;
    setBusy(`photo:${slot}`);
    try {
      setView(await kitFetch<RenterView>(`/api/renter/${token}/photos`, { json: { slot, ...(file ? { dataUrl: await photoDataUrl(file) } : {}) } }));
    } catch (e) {
      toast({ title: "The photo didn't go through", description: (e as Error).message, variant: "error", durationMs: 7000 });
    } finally {
      setBusy(null);
    }
  }

  /** The renter approved in PayPal: the server places the hold and returns this page's new state. */
  async function holdPlaced(orderId: string) {
    setBusy("hold");
    try {
      setView(await kitFetch<RenterView>(`/api/renter/${token}/deposit/authorize`, { json: { orderId } }));
    } catch (e) {
      toast({ title: "PayPal did not place the hold", description: (e as Error).message, variant: "error", durationMs: 7000 });
    } finally {
      setBusy(null);
    }
  }

  async function attach(lineId: string, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const dataUrl = await photoDataUrl(file);
      setEvidence((all) => ({ ...all, [lineId]: dataUrl }));
    } catch (e) {
      toast({ title: "The photo didn't go through", description: (e as Error).message, variant: "error", durationMs: 7000 });
    }
  }

  const dropEvidence = (lineId: string) =>
    setEvidence((all) => {
      const next = { ...all };
      delete next[lineId];
      return next;
    });

  async function acceptCounter() {
    setBusy("counter");
    try {
      setView(await kitFetch<RenterView>(`/api/renter/${token}/counter`, { method: "POST" }));
    } catch (e) {
      toast({ title: "That didn't go through", description: (e as Error).message, variant: "error", durationMs: 7000 });
    } finally {
      setBusy(null);
    }
  }

  async function respond(decision: "accepted" | "contested") {
    setBusy(decision);
    try {
      const lines = view?.proposal?.lines ?? [];
      const accepted = lines.length > 1 ? lines.filter((line) => choice[line.id] === "accept").map((line) => line.id) : [];
      const photos = decision === "contested" ? Object.entries(evidence).filter(([id]) => !accepted.includes(id) && lines.some((line) => line.id === id)).map(([line_id, data_url]) => ({ line_id, data_url })) : [];
      setView(await kitFetch<RenterView>(`/api/renter/${token}/respond`, { json: { decision, note: decision === "contested" ? note : undefined, ...(decision === "contested" && accepted.length ? { accepted_line_ids: accepted } : {}), ...(photos.length ? { evidence: photos } : {}) } }));
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
  const response = renterState?.response;
  const hasOwnPhotos = RENTER_SLOTS.some(({ slot }) => view.renterPhotos[slot]);
  // Answering: one card per item with Accept and Contest. The renter can still contest after accepting, until the host approves.
  const answering = view.canContest && !!proposal && lines.length > 0;
  const contestedIds = lines.filter((line) => choice[line.id] === "contest").map((line) => line.id);
  const undecided = lines.filter((line) => !choice[line.id]).length;
  const contesting = contestedIds.length > 0;
  const choose = (id: string, value: "accept" | "contest") => setChoice((all) => ({ ...all, [id]: value }));
  const settled = view.ruling;

  return (
    <main className="mx-auto max-w-3xl space-y-5 px-4 py-6 sm:py-12">
      <header>
        <p className="text-sm font-medium text-brand">Deposit for {view.item}</p>
        <h1 data-testid="renter-headline" className={settled ? "sr-only" : "mt-1 text-2xl font-semibold tracking-tight text-zinc-900 tabular-nums sm:text-3xl"}><Headline view={view} /></h1>
        {proposal && !settled ? <RenterSummary view={view} answering={answering} /> : !settled ? <p className="mt-2 text-[15px] text-zinc-600">Hi {view.renter}. Nothing is charged while this is open. The money is held by PayPal, not taken.</p> : <p className="mt-1 text-[15px] text-zinc-600">Hi {view.renter}. Your deposit is settled.</p>}
      </header>

      {settled ? <Ruling booking={settled} viewer="renter" pack={settled.settlement?.capturedCents ? `/api/renter/${token}/evidence` : undefined} /> : null}

      {view.status === "draft" ? (
        <Card>
          <CardBody className="space-y-4 py-6" data-testid="renter-pay">
            <div>
              <h2 className="text-sm font-semibold text-zinc-900">Approve the deposit hold</h2>
              <p className="mt-1 text-sm text-zinc-600">
                The host asks for a {formatCents(view.depositCents)} damage deposit for {view.item}. You approve a hold with PayPal: the money stays with you, nothing is taken. After the stay you&rsquo;ll see any proposed charge here, with the photos, and can accept or contest each item before anything is charged.
              </p>
            </div>
            <CheckoutButton
              createOrder={() => kitFetch<{ orderId: string }>(`/api/renter/${token}/deposit`, { method: "POST" })}
              onApprove={({ orderId }) => holdPlaced(orderId)}
              amountLabel={formatExactCents(view.depositCents)}
              onError={(e) => toast({ title: "Checkout failed", description: e.message, variant: "error", durationMs: 7000 })}
              onCancel={() => toast({ title: "PayPal was closed before the hold was approved", description: "Nothing is held and nothing was charged. Press the button again when you're ready.", durationMs: 7000 })}
              disabled={busy === "hold"}
            />
          </CardBody>
        </Card>
      ) : view.hold && !view.settled && !proposal ? (
        <div data-testid="renter-hold" className="flex items-start gap-3 rounded-lg bg-brand-50/70 px-4 py-3 text-sm text-zinc-700">
          <Lock className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
          <div className="min-w-0">
            <p className="font-medium text-zinc-900" data-testid="renter-hold-headline">{formatCents(view.hold.authorizedCents)} authorized, nothing charged</p>
            <p className="mt-0.5">PayPal is holding it on your account. Any charge the host proposes shows here first, and you can answer it line by line.</p>
            {view.hold.expiresAt ? <p className="mt-0.5" data-testid="renter-hold-ends">The hold ends on {longDate(view.hold.expiresAt)} at the latest. Anything not charged goes back to you.</p> : null}
          </div>
        </div>
      ) : null}

      {view.secondLook && !settled ? <RenterSecondLook view={view} busy={busy} onAccept={acceptCounter} /> : null}

      {response?.decision === "contested" && !settled ? (
        <div data-testid="renter-contested" className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          <p className="font-semibold">{split ? `You accepted ${formatExactCents(split.acceptedCents)} and contested ${formatExactCents(split.contestedCents)}. The contested part is stopped until the host decides.` : "Your note went to the host. The charge is stopped until they decide."}</p>
          <p className="mt-1">&ldquo;{response.note}&rdquo;</p>
          {split?.chargedCents ? <p className="mt-1" data-testid="renter-part-charged">{formatExactCents(split.chargedCents)} for the items you accepted has been charged.</p> : null}
          <p className="mt-2 text-xs">From now on the host can only keep {split ? "the contested part" : "this charge"} at {formatExactCents(split ? split.contestedCents : response.amountCents)} or lower it, never raise it. This is a note inside this app, not a PayPal dispute. If you&rsquo;re charged and still disagree, you can open a dispute with PayPal.</p>
        </div>
      ) : null}

      {response?.decision === "accepted" && !settled ? <p data-testid="renter-accepted" className="rounded-lg bg-zinc-50 px-4 py-3 text-sm text-zinc-700">You accepted this charge. The host still has to approve it before anything moves.{view.canContest ? " You can still change your mind and contest until then." : ""}</p> : null}

      {proposal && !settled ? (
        <section className="space-y-3" data-testid="renter-lines" aria-label="Each item">
          {lines.map((line, i) => (
            <LineCard key={line.id} view={view} line={line} number={i + 1} choice={answering ? choice[line.id] : undefined} answered={answeredAs(view, line.id)} onChoose={answering ? (value) => choose(line.id, value) : undefined} busy={!!busy}>
              {answering && choice[line.id] === "contest" ? <EvidencePicker lineId={line.id} dataUrl={evidence[line.id]} disabled={!!busy} onPick={attach} onClear={dropEvidence} /> : null}
            </LineCard>
          ))}
          {!lines.length ? <Card><CardBody className="py-5 text-sm text-zinc-700" data-testid="renter-no-charge">The host found nothing to charge. The whole deposit goes back to you.</CardBody></Card> : null}
        </section>
      ) : view.status !== "draft" && !settled ? (
        <Card><CardBody className="py-6 text-sm text-zinc-600">The host hasn&rsquo;t finished the check-out yet. This page updates by itself.</CardBody></Card>
      ) : null}

      {answering ? (
        <Card>
          <CardBody className="space-y-3 py-5" data-testid="renter-answer">
            {contesting ? (
              <Field label="Tell the host why you contest" htmlFor="contest-note">
                <Textarea id="contest-note" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="It was there when I arrived." data-testid="contest-note" />
              </Field>
            ) : null}
            <div className="flex flex-wrap gap-2">
              {contesting ? (
                <Button icon={<MessageSquareWarning className="size-4" />} loading={busy === "contested"} disabled={!!busy || !note.trim() || undecided > 0} onClick={() => respond("contested")} data-testid="contest">
                  {lines.length > 1 && contestedIds.length < lines.length ? `Contest ${contestedIds.length} of ${lines.length} items` : lines.length > 1 ? "Contest all items" : "Contest this charge"}
                </Button>
              ) : view.canAccept ? (
                <Button icon={<Check className="size-4" />} loading={busy === "accepted"} disabled={!!busy} onClick={() => respond("accepted")} data-testid="accept">
                  {lines.length > 1 ? `Accept all: ${formatExactCents(view.chargeCents)}` : `Accept ${formatExactCents(view.chargeCents)}`}
                </Button>
              ) : null}
            </div>
            {contesting && undecided > 0 ? <p className="text-xs text-zinc-600" data-testid="contest-why">Choose Accept or Contest for {undecided === 1 ? "the other item" : `the other ${undecided} items`}.</p> : contesting && !note.trim() ? <p className="text-xs text-zinc-600" data-testid="contest-why">Write a note to the host to contest.</p> : null}
            {contesting ? <p className="text-xs text-zinc-500">Accepted items can be charged now. What you contest waits for the host, and Claude looks again with your note and photo. A contested item can only go down.</p> : null}
          </CardBody>
        </Card>
      ) : null}

      {proposal && !settled ? (
        <details className="group rounded-xl border border-zinc-200/80 bg-white" data-testid="renter-details">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-sm font-medium text-zinc-800 [&::-webkit-details-marker]:hidden">
            Both photos, the price table and the reasoning
            <ChevronDown className="size-4 text-zinc-400 transition-transform group-open:rotate-180" aria-hidden />
          </summary>
          <div className="space-y-5 border-t border-zinc-100 px-4 py-4">
            {hasOwnPhotos ? <p className="text-sm text-zinc-600" data-testid="renter-photos">Your own photos are here too. The comparison weighed these alongside the host&rsquo;s photos.</p> : null}
            <div className="grid gap-4 sm:grid-cols-2">
              {photos.check_in ? <PhotoFrame label="Check-in" photo={photos.check_in} /> : null}
              {photos.check_out ? <PhotoFrame label="Check-out" photo={photos.check_out} items={proposal.lines} /> : null}
              {RENTER_SLOTS.map(({ slot, label }) => {
                const photo = view.renterPhotos[slot];
                return photo ? <PhotoFrame key={slot} label={label} photo={photo} on="renter_check_out" items={slot === "check_out" ? proposal.lines : undefined} /> : null;
              })}
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
          </div>
        </details>
      ) : null}

      {view.canAddPhotos || (hasOwnPhotos && !proposal) ? (
        <section data-testid="renter-photos">
          <Card>
            <CardBody className="space-y-4 py-6">
              <div>
                <h2 className="text-sm font-semibold text-zinc-900">Your own photos</h2>
                <p className="mt-1 text-sm text-zinc-600">
                  {view.canAddPhotos ? "Took photos when you arrived or left? Add them before the host compares the photos, and the comparison weighs them alongside the host's." : "The comparison weighed these alongside the host's photos."}
                </p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                {RENTER_SLOTS.map(({ slot, label }) => {
                  const photo = view.renterPhotos[slot];
                  if (!photo && !view.canAddPhotos) return null;
                  return (
                    <div key={slot} className="space-y-2">
                      {photo ? <PhotoFrame label={label} photo={photo} on="renter_check_out" items={slot === "check_out" ? proposal?.lines : undefined} /> : <p className="text-sm font-medium text-zinc-800">{label}</p>}
                      {view.canAddPhotos ? (
                        <div className="flex flex-wrap gap-2">
                          <label className="inline-flex h-8 cursor-pointer items-center justify-center gap-2 rounded-lg border border-zinc-200 px-3 text-sm font-medium text-zinc-700 hover:bg-zinc-100 focus-within:ring-2 focus-within:ring-brand-300">
                            <Upload className="size-4" /> {photo ? "Replace photo" : "Upload photo"}
                            <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" disabled={!!busy} onChange={(e) => addPhoto(slot, e)} data-testid={`renter-upload-${slot}`} />
                          </label>
                          {slot === "check_in" && !photo ? (
                            <Button variant="ghost" size="sm" icon={<ImagePlus className="size-4" />} loading={busy === `photo:${slot}`} disabled={!!busy} onClick={() => addPhoto(slot)} data-testid="renter-demo-check_in">
                              Use demo close-up
                            </Button>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </CardBody>
          </Card>
        </section>
      ) : null}
    </main>
  );
}

/** How the renter answered one item, once they have. */
function answeredAs(view: RenterView, lineId: string): "accepted" | "contested" | undefined {
  const response = view.renterState?.response;
  if (!response) return undefined;
  if (response.decision === "accepted") return "accepted";
  return response.acceptedLineIds?.includes(lineId) ? "accepted" : "contested";
}

/**
 * The first thing the renter reads, in three lines: what PayPal holds, what the host proposes, and
 * what to do by when.
 */
function RenterSummary({ view, answering }: { view: RenterView; answering: boolean }) {
  const lines = view.proposal?.lines ?? [];
  const held = view.hold?.authorizedCents ?? view.depositCents;
  const charged = view.split?.chargedCents;
  const response = view.renterState?.response;
  const marks = `${lines.length} ${lines.length === 1 ? "mark" : "marks"}`;
  const deadline = view.renterState?.deadline;
  return (
    <ol className="mt-3 space-y-1.5 text-[15px] text-zinc-800" data-testid="renter-summary">
      <li className="flex items-start gap-2" data-testid="renter-summary-hold">
        <Lock className="mt-1 size-4 shrink-0 text-brand" aria-hidden />
        <span>{charged ? `${formatExactCents(charged)} charged for what you accepted. ${formatExactCents(held - charged)} is still on hold, not charged.` : `${formatCents(held)} is on hold with PayPal, not charged.`}</span>
      </li>
      <li className="flex items-start gap-2" data-testid="renter-summary-proposal">
        <ScanSearch className="mt-1 size-4 shrink-0 text-brand" aria-hidden />
        <span>{lines.length ? `The host proposes ${formatExactCents(view.chargeCents)} for ${marks}.` : "The host proposes no charge."}</span>
      </li>
      <li className="flex items-start gap-2 font-medium" data-testid="renter-summary-action">
        <CircleCheck className="mt-1 size-4 shrink-0 text-brand" aria-hidden />
        <span>
          {answering && !response
            ? `${lines.length > 1 ? "Accept or contest each one" : "Accept or contest it"}${deadline ? ` by ${localTime(deadline)}` : ""}.`
            : response?.decision === "contested"
              ? "You answered. The host decides what you contested."
              : response?.decision === "accepted"
                ? "You accepted. The host approves before anything moves."
                : "Nothing to answer right now."}
        </span>
      </li>
    </ol>
  );
}

/** One proposed item: where it is on the check-out photo, its price row, and the renter's two choices. */
function LineCard({ view, line, number, choice, answered, onChoose, busy, children }: { view: RenterView; line: ChargeLine; number: number; choice?: "accept" | "contest"; answered?: "accepted" | "contested"; onChoose?: (value: "accept" | "contest") => void; busy: boolean; children?: ReactNode }) {
  const onRenterPhoto = line.photo === "renter_check_out";
  const photo = onRenterPhoto ? view.renterPhotos.check_out : view.photos.check_out;
  const state = choice ?? (answered === "accepted" ? "accept" : answered === "contested" ? "contest" : undefined);
  const ring = state === "contest" ? "border-amber-300 bg-amber-50/40" : state === "accept" ? "border-emerald-300 bg-emerald-50/30" : "border-zinc-200/80 bg-white";
  return (
    <div className={`overflow-hidden rounded-xl border ${ring}`} data-testid={`renter-line-${line.id}`} data-choice={state ?? "none"}>
      <div className="grid gap-3 p-3 sm:grid-cols-[minmax(0,14rem)_1fr] sm:p-4">
        {photo ? <PhotoFrame label={`Item ${number}`} photo={photo} items={[{ ...line, number }]} on={onRenterPhoto ? "renter_check_out" : "check_out"} credit={false} /> : null}
        <div className="min-w-0 space-y-2">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-[15px] font-medium text-zinc-900">{number}. {line.description.split(/(?<=\.)\s/)[0]}</p>
            <p className="shrink-0 text-lg font-semibold tabular-nums text-zinc-900" data-testid={`renter-line-amount-${line.id}`}>{formatExactCents(line.amountCents)}</p>
          </div>
          <PriceSource price={line.price} />
          {onChoose ? (
            <div className="grid grid-cols-2 gap-2 pt-1" role="group" aria-label={`Your answer to item ${number}`}>
              <button type="button" aria-pressed={choice === "accept"} disabled={busy} onClick={() => onChoose("accept")} data-testid={`line-accept-${line.id}`} className={`inline-flex h-11 items-center justify-center gap-1.5 rounded-lg border text-sm font-medium transition-colors ${choice === "accept" ? "border-emerald-600 bg-emerald-600 text-white" : "border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-50"}`}>
                <Check className="size-4" aria-hidden /> Accept
              </button>
              <button type="button" aria-pressed={choice === "contest"} disabled={busy} onClick={() => onChoose("contest")} data-testid={`line-contest-${line.id}`} className={`inline-flex h-11 items-center justify-center gap-1.5 rounded-lg border text-sm font-medium transition-colors ${choice === "contest" ? "border-amber-600 bg-amber-500 text-white" : "border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-50"}`}>
                <MessageSquareWarning className="size-4" aria-hidden /> Contest
              </button>
            </div>
          ) : answered ? (
            <Badge tone={answered === "accepted" ? "success" : "warning"} data-testid={`renter-line-answer-${line.id}`}>{answered === "accepted" ? "You accepted" : "You contested"}</Badge>
          ) : null}
          {children}
        </div>
      </div>
    </div>
  );
}

/** An optional photo of one contested item, from the renter's camera or files. */
function EvidencePicker({ lineId, dataUrl, disabled, onPick, onClear }: { lineId: string; dataUrl?: string; disabled: boolean; onPick: (lineId: string, e: ChangeEvent<HTMLInputElement>) => void; onClear: (lineId: string) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid={`evidence-${lineId}`}>
      {dataUrl ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element -- a local preview of the renter's own photo */}
          <img src={dataUrl} alt="Your photo for this item" className="h-14 w-20 rounded object-cover" data-testid={`evidence-preview-${lineId}`} />
          <button type="button" className="inline-flex items-center gap-1 text-xs text-zinc-600 underline underline-offset-2" disabled={disabled} onClick={() => onClear(lineId)}>
            <X className="size-3" aria-hidden /> Remove
          </button>
        </>
      ) : (
        <label className="inline-flex h-8 cursor-pointer items-center justify-center gap-2 rounded-lg border border-zinc-200 px-3 text-sm font-medium text-zinc-700 hover:bg-zinc-100 focus-within:ring-2 focus-within:ring-brand-300">
          <Camera className="size-4" aria-hidden /> Add your photo (optional)
          <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" disabled={disabled} onChange={(e) => onPick(lineId, e)} data-testid={`evidence-upload-${lineId}`} />
        </label>
      )}
    </div>
  );
}

/** Claude's second look, as the renter sees it: running, with the host, then the counter to accept. */
function RenterSecondLook({ view, busy, onAccept }: { view: RenterView; busy: string | null; onAccept: () => void }) {
  const look = view.secondLook!;
  if (look.status === "running" || look.status === "with_host") {
    return (
      <p data-testid="renter-second-look" data-status={look.status} className="flex items-start gap-2 rounded-lg bg-brand-50/70 px-4 py-3 text-sm text-zinc-800">
        <Eye className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
        {look.status === "running" ? "Claude is taking a second look at what you contested, with your evidence. A contested item can only go down." : "Claude's second look is with the host. You'll see their answer here."}
      </p>
    );
  }
  const lines = look.lines ?? [];
  const from = lines.reduce((sum, l) => sum + l.fromCents, 0);
  const to = lines.reduce((sum, l) => sum + l.toCents, 0);
  const proposal = view.proposal?.lines ?? [];
  return (
    <Card>
      <CardBody className="space-y-4 py-6" data-testid="renter-counter" data-status={look.status}>
        <div>
          <h2 className="text-sm font-semibold text-zinc-900">The host&rsquo;s counter, from Claude&rsquo;s second look</h2>
          <p className="mt-1 text-sm text-zinc-700" data-testid="renter-counter-total">What you contested: {formatExactCents(from)} &rarr; {formatExactCents(to)}</p>
        </div>
        <ul className="space-y-5">
          {lines.map((line, i) => (
            <SecondLookLineRow key={line.lineId} line={line} charge={proposal.find((l) => l.id === line.lineId)} number={i + 1} checkOut={view.photos.check_out} evidence={view.renterState?.response?.evidence?.[line.lineId]?.photo} />
          ))}
        </ul>
        {look.rationale ? <p className="text-sm text-zinc-700" data-testid="renter-counter-rationale">{look.rationale}</p> : null}
        {look.canAccept ? (
          <Button icon={<Check className="size-4" />} loading={busy === "counter"} disabled={!!busy} onClick={onAccept} data-testid="accept-counter">
            Accept the counter: {formatExactCents(to)}
          </Button>
        ) : (
          <p className="text-sm text-zinc-700" data-testid="renter-counter-accepted">You accepted the counter. The host approves the final charge, and anything not charged goes back to you.</p>
        )}
      </CardBody>
    </Card>
  );
}
