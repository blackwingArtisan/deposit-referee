"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Bot, ChevronDown, CircleAlert, Clock, ExternalLink, ImagePlus, Landmark, Lock, ScanSearch, Upload } from "lucide-react";
import { ApprovalHero } from "./approval-hero";
import { ToolCallTimeline } from "@/components/agent/tool-call-timeline";
import { useKit } from "@/components/kit/kit-provider";
import { useTimeline } from "@/components/kit/use-timeline";
import { PageHeader } from "@/components/shell/app-shell";
import { useToast } from "@/components/toast";
import { Badge, Button, Card, CardBody, EmptyState, SkeletonCard } from "@/components/ui";
import { formatCents, HOLD_LIMIT_DAYS, HONOR_DAYS, photoChangeBlocked } from "@/lib/deposit/rules";
import { bookingSteps, combineEvents } from "@/lib/deposit/timeline";
import type { BookingStatus, BookingView, PhotoSlot } from "@/lib/deposit/types";
import { mergeEvents, type TimelineEvent, type TimelineStep } from "@/lib/events/types";
import { DamageItems } from "./damage-items";
import { DisputePanel } from "./dispute-panel";
import { HostDecision } from "./host-decision";
import { photoDataUrl } from "./photo-file";
import { PhotoFrame, RENTER_SLOTS } from "./photo-frame";
import { Ruling } from "./ruling";
import { WaitStory, type CompareRun } from "./wait-story";

const STATUS_LABEL: Record<BookingStatus, { label: string; tone: "neutral" | "info" | "warning" | "brand" | "success" }> = {
  draft: { label: "Waiting for the renter’s hold", tone: "neutral" },
  held: { label: "Deposit on hold", tone: "info" },
  reviewed: { label: "Agent working", tone: "brand" },
  proposed: { label: "Host deciding", tone: "brand" },
  contested: { label: "Contested by the renter", tone: "warning" },
  awaiting_approval: { label: "Waiting for approval", tone: "warning" },
  captured: { label: "Charged, releasing the rest", tone: "warning" },
  settled: { label: "Settled", tone: "success" },
};

const SLOTS: { slot: PhotoSlot; label: string }[] = [
  { slot: "check_in", label: "Check-in" },
  { slot: "check_out", label: "Check-out" },
];

const longDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

function Step({ n, title, done, children }: { n: number; title: string; done?: boolean; children?: ReactNode }) {
  return (
    <div className="relative pl-11">
      <span className={`absolute left-0 top-0 flex size-8 items-center justify-center rounded-full text-sm font-semibold ${done ? "bg-brand text-brand-foreground" : "bg-zinc-100 text-zinc-600"}`}>{done ? "✓" : n}</span>
      <h3 className="pt-1 font-semibold text-zinc-900">{title}</h3>
      {children ? <div className="mt-3">{children}</div> : null}
    </div>
  );
}

function Notice({ tone, children }: { tone: "error" | "muted"; children: ReactNode }) {
  return (
    <p data-testid={tone === "error" ? "booking-error" : undefined} className={`flex items-start gap-2 rounded-lg px-3 py-2 text-sm ${tone === "error" ? "bg-red-50 text-red-800" : "bg-zinc-50 text-zinc-600"}`}>
      {tone === "error" ? <CircleAlert className="mt-0.5 size-4 shrink-0" /> : <Clock className="mt-0.5 size-4 shrink-0" />}
      <span>{children}</span>
    </p>
  );
}

/** Before the hold: the host sends the renter their link, and the renter places it from their own page. */
function WaitingForHold({ booking }: { booking: BookingView }) {
  const { toast } = useToast();
  const path = `/renter/${booking.renterToken}`;
  const copy = () =>
    navigator.clipboard
      .writeText(`${window.location.origin}${path}`)
      .then(() => toast({ title: "Renter link copied", variant: "success" }))
      .catch(() => toast({ title: "Could not copy the link", variant: "error" }));
  return (
    <div data-testid="waiting-for-hold" className="rounded-lg border border-zinc-200 px-4 py-3 text-sm">
      <p className="font-medium text-zinc-900" data-testid="waiting-headline">Waiting for the renter&rsquo;s hold</p>
      <p className="mt-1 text-zinc-600">Send {booking.renter} their link. They approve a {formatCents(booking.depositCents)} hold with PayPal on their own page, on their phone or computer. The money is held, not taken, and this page updates when PayPal confirms it.</p>
      {booking.renterToken ? (
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <Link href={path} target="_blank" className="inline-flex items-center gap-1 font-medium text-brand underline underline-offset-2" data-testid="renter-pay-link">
            Open the renter&rsquo;s page <ExternalLink className="size-3.5" aria-hidden />
          </Link>
          <button type="button" onClick={copy} className="text-zinc-600 underline underline-offset-2 hover:text-zinc-900">Copy link</button>
        </div>
      ) : null}
    </div>
  );
}

function HoldPanel({ booking }: { booking: BookingView }) {
  const { hold, authorizedCents, authorizationId, refreshedAuthorizationId } = booking;
  if (!hold || authorizedCents === undefined) return null;
  if (hold.expired) return <Notice tone="error">This hold ended on {longDate(hold.expiresAt)}, so it can&rsquo;t be charged.</Notice>;
  return (
    <div data-testid="hold-panel" className="flex items-start gap-3 rounded-lg bg-brand-50/70 px-4 py-3">
      <Lock className="mt-0.5 size-4 shrink-0 text-brand" />
      <div className="min-w-0 text-sm text-zinc-700">
        <p className="font-medium text-zinc-900" data-testid="hold-headline">
          {formatCents(authorizedCents)} authorized, nothing charged
        </p>
        {authorizationId ? (
          <p className="mt-0.5 break-all">
            PayPal authorization <span className="font-mono text-xs text-zinc-900" data-testid="hold-authorization-id">{refreshedAuthorizationId ?? authorizationId}</span>
            {refreshedAuthorizationId ? <span className="text-zinc-500"> (refreshed from {authorizationId})</span> : null}
          </p>
        ) : null}
        <p className="mt-0.5" data-testid="hold-length">
          PayPal keeps an authorization for {HOLD_LIMIT_DAYS} days, so this one ends on {longDate(hold.expiresAt)}. The funds are guaranteed for the first {HONOR_DAYS} days, until {longDate(hold.guaranteedUntil)}.
        </p>
      </div>
    </div>
  );
}

/** The PayPal calls behind this booking, folded into one line until the host asks for them. */
function PayPalCalls({ steps, loading }: { steps: TimelineStep[]; loading: boolean }) {
  const [open, setOpen] = useState(false);
  const calls = steps.filter((s) => s.paypal);
  const last = calls.at(-1);
  return (
    <Card data-testid="paypal-calls">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center gap-3 px-5 py-3 text-left" data-testid="paypal-calls-toggle">
        <Landmark className="size-4 shrink-0 text-brand" aria-hidden />
        {/* No count until the booking's saved calls are in, so a slow first load never reads as "(0)". */}
        <span className="text-sm font-semibold text-zinc-900" aria-busy={loading}>
          PayPal calls{loading ? "" : ` (${calls.length})`}
        </span>
        {loading ? <span className="text-sm text-zinc-500" data-testid="paypal-calls-loading">Loading…</span> : last ? <span className="hidden min-w-0 truncate text-sm text-zinc-500 sm:inline">Last: {last.title}</span> : null}
        <span className="ml-auto inline-flex shrink-0 items-center gap-1 text-xs font-medium text-zinc-500">
          {open ? "Hide" : "Show every call"} <ChevronDown className={`size-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
        </span>
      </button>
      {open ? (
        <CardBody className="border-t border-zinc-100">
          <ToolCallTimeline steps={steps} showQuiet autoScroll={false} className="max-h-[560px]" />
        </CardBody>
      ) : null}
    </Card>
  );
}

export function BookingScreen() {
  const { id } = useParams<{ id: string }>();
  const { kitFetch, status: kit } = useKit();
  const { toast } = useToast();
  const { events } = useTimeline();
  const [saved, setSaved] = useState<TimelineEvent[]>([]);
  const [savedLoaded, setSavedLoaded] = useState(false);
  const [booking, setBooking] = useState<BookingView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [compareRun, setCompareRun] = useState<CompareRun | null>(null);

  const load = useCallback(() => kitFetch<BookingView>(`/api/bookings/${id}`), [id, kitFetch]);
  const refresh = useCallback(() => load().then(setBooking), [load]);

  useEffect(() => {
    load()
      .then(setBooking)
      .catch((e: Error) => setLoadError(e.message));
  }, [load]);

  // The money moves in the background once the host approves, so follow it until it stops.
  // While the host decides, the renter can answer from their own page at any moment.
  const evidence = booking?.dispute?.evidence;
  const moving = booking?.status === "awaiting_approval" || (booking?.status === "captured" && !booking.settlement?.error) || (!!evidence && !evidence.submittedAt && !evidence.error);
  const renterPending = booking?.status === "proposed" || booking?.status === "draft";
  useEffect(() => {
    if (!moving && !renterPending) return;
    const timer = setInterval(() => void refresh().catch(() => undefined), moving ? 700 : 2000);
    return () => clearInterval(timer);
  }, [moving, renterPending, refresh]);

  // The booking keeps its own PayPal calls, so a reload or another tab shows every one of them.
  const savedKey = booking ? `${booking.status}:${booking.settlement?.captureId ?? ""}:${booking.settlement?.settledAt ?? ""}:${booking.dispute?.status ?? ""}:${booking.dispute?.readAt ?? ""}` : null;
  useEffect(() => {
    if (!savedKey) return;
    kitFetch<{ events: TimelineEvent[] }>(`/api/bookings/${id}/activity`)
      .then((r) => setSaved(r.events))
      .catch(() => undefined)
      .finally(() => setSavedLoaded(true));
  }, [id, kitFetch, savedKey]);

  // On a phone the approval card and the result appear far from the button that asked for them.
  const decision = useRef<HTMLDivElement>(null);
  const approvalId = booking?.approval?.id;
  useEffect(() => {
    // The whole card when it fits, else its foot, so the Approve button is always on screen.
    const card = decision.current;
    if (approvalId && card) card.scrollIntoView({ behavior: "smooth", block: card.offsetHeight <= window.innerHeight - 48 ? "start" : "end" });
  }, [approvalId]);
  const shownStatus = useRef(booking?.status);
  useEffect(() => {
    if (booking?.status === "settled" && shownStatus.current && shownStatus.current !== "settled") window.scrollTo({ top: 0, behavior: "smooth" });
    shownStatus.current = booking?.status;
  }, [booking?.status]);

  // The approval card sits next to the amount, so the timeline only reports the wait.
  const timelineSteps = useMemo(() => (booking ? bookingSteps(mergeEvents(combineEvents(saved, events)), booking) : []).map((s) => (s.approval?.state === "pending" ? { ...s, approval: undefined } : s)), [saved, events, booking]);

  const fail = (title: string, e: unknown) => toast({ title, description: (e as Error).message, variant: "error", durationMs: 7000 });

  async function run(name: string, failTitle: string, action: () => Promise<BookingView>) {
    setBusy(name);
    try {
      setBooking(await action());
    } catch (e) {
      fail(failTitle, e);
    } finally {
      setBusy(null);
    }
  }

  // A failed comparison leaves the booking as it was, so the reason has to stay on the screen.
  async function compare() {
    setBusy("review");
    setReviewError(null);
    const startedAt = Date.now();
    setCompareRun({ startedAt });
    try {
      setBooking(await kitFetch<BookingView>(`/api/bookings/${id}/review`, { method: "POST" }));
      setCompareRun({ startedAt, finishedAt: Date.now() });
    } catch (e) {
      setReviewError((e as Error).message);
      setCompareRun({ startedAt, finishedAt: Date.now(), error: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  if (loadError) return <EmptyState title="Booking not found" description={loadError} />;
  if (!booking) return <SkeletonCard />;

  const url = `/api/bookings/${booking.id}`;
  const { status, review, proposal, settlement, photos, authorizedCents = booking.depositCents } = booking;
  const deciding = status === "proposed" || status === "contested";

  const addDemoPhoto = (slot: PhotoSlot, kind?: { clean?: boolean; faint?: boolean; two?: boolean }) => run(`photo:${slot}`, "Could not add the photo", () => kitFetch<BookingView>(`${url}/photos`, { json: { slot, ...kind } }));

  async function uploadPhoto(slot: PhotoSlot, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) await run(`photo:${slot}`, "Could not add the photo", async () => kitFetch<BookingView>(`${url}/photos`, { json: { slot, dataUrl: await photoDataUrl(file) } }));
  }

  const approval = booking.approval;
  const timeline = <PayPalCalls steps={timelineSteps} loading={!savedLoaded} />;
  const canReplace = !photoChangeBlocked(booking);

  return (
    <>
      <PageHeader
        eyebrow={`Rented by ${booking.renter}`}
        title={booking.item}
        description={`${formatCents(booking.depositCents)} damage deposit`}
        actions={<Badge tone={STATUS_LABEL[status].tone} dot>{STATUS_LABEL[status].label}</Badge>}
      />

      {booking.viewer === "visitor" && !booking.sample ? (
        <div className="mb-6" data-testid="visitor-note">
          <Notice tone="muted">You&rsquo;re viewing this booking from a browser that didn&rsquo;t make it. Only the host&rsquo;s browser can add photos, approve or charge, and only the host can send the renter their link.</Notice>
        </div>
      ) : null}

      {booking.sample ? (
        <div className="mb-6" data-testid="sample-note">
          <Notice tone="muted">This is a sample booking. Its hold and any charge are {kit?.paypal.mode === "sandbox" ? "real objects on the PayPal sandbox" : "on mock PayPal"}. Its photo findings were written for the sample, not made by Claude on this booking. Its PayPal calls are the ones made when the sample was loaded.</Notice>
        </div>
      ) : null}

      {status === "settled" ? (
        <div className="space-y-6">
          <Ruling booking={booking} calls={timeline} />
          <DisputePanel booking={booking} busy={busy} act={run} onDecided={() => void refresh().catch(() => undefined)} />
        </div>
      ) : (
        <div className="mx-auto max-w-5xl space-y-6">
          <Card>
            <CardBody className="space-y-8 py-6">
              <Step n={1} title="Renter places the deposit" done={status !== "draft"}>
                {status === "draft" ? (
                  <WaitingForHold booking={booking} />
                ) : (
                  <HoldPanel booking={booking} />
                )}
              </Step>

              {status !== "draft" ? (
                <Step n={2} title="Add the check-in and check-out photos" done={Boolean(photos.check_in && photos.check_out)}>
                  <div className="grid gap-4 sm:grid-cols-2">
                    {SLOTS.map(({ slot, label }) => {
                      const photo = photos[slot];
                      return photo ? (
                        <div key={slot} className="min-w-0">
                          <PhotoFrame label={label} photo={photo} items={slot === "check_out" ? review?.items : undefined} looks={slot === "check_out" ? review?.worthALook : undefined} />
                          {canReplace ? (
                            <div className="mt-2 flex flex-wrap items-center gap-1" data-testid={`replace-${slot}`}>
                              <span className="text-xs text-zinc-500">Replace:</span>
                              <Button variant="ghost" size="sm" loading={busy === `photo:${slot}`} disabled={!!busy} onClick={() => addDemoPhoto(slot)} data-testid={`replace-demo-${slot}`}>
                                Demo photo
                              </Button>
                              <label className="inline-flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-lg px-3 text-sm font-medium text-zinc-700 hover:bg-zinc-100 focus-within:ring-2 focus-within:ring-brand-300">
                                <Upload className="size-4" /> Upload a different photo
                                <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" disabled={!!busy} onChange={(e) => uploadPhoto(slot, e)} data-testid={`replace-upload-${slot}`} />
                              </label>
                            </div>
                          ) : null}
                        </div>
                      ) : (
                        <div key={slot} className="flex flex-col gap-2 rounded-lg border border-dashed border-zinc-300 p-4">
                          <p className="text-sm font-medium text-zinc-800">{label}</p>
                          <Button variant="secondary" size="sm" icon={<ImagePlus className="size-4" />} loading={busy === `photo:${slot}`} disabled={!!busy} onClick={() => addDemoPhoto(slot)} data-testid={`demo-photo-${slot}`}>
                            Use demo photo
                          </Button>
                          {slot === "check_out" ? (
                            <>
                              <Button variant="ghost" size="sm" disabled={!!busy} onClick={() => addDemoPhoto(slot, { clean: true })} data-testid="demo-photo-clean">
                                Use demo photo, no damage
                              </Button>
                              <Button variant="ghost" size="sm" disabled={!!busy} onClick={() => addDemoPhoto(slot, { faint: true })} data-testid="demo-photo-faint">
                                Use demo photo, faint mark
                              </Button>
                              <Button variant="ghost" size="sm" disabled={!!busy} onClick={() => addDemoPhoto(slot, { two: true })} data-testid="demo-photo-two">
                                Use demo photo, two marks
                              </Button>
                            </>
                          ) : null}
                          <label className="inline-flex h-8 cursor-pointer items-center justify-center gap-2 rounded-lg px-3 text-sm font-medium text-zinc-700 hover:bg-zinc-100 focus-within:ring-2 focus-within:ring-brand-300">
                            <Upload className="size-4" /> Upload photo
                            <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" disabled={!!busy} onChange={(e) => uploadPhoto(slot, e)} data-testid={`upload-photo-${slot}`} />
                          </label>
                        </div>
                      );
                    })}
                    {RENTER_SLOTS.map(({ slot, label }) => {
                      const photo = booking.renterPhotos?.[slot];
                      return photo ? (
                        <div key={`renter-${slot}`} data-testid={`renter-photo-${slot}`}>
                          <PhotoFrame label={label} photo={photo} on="renter_check_out" items={slot === "check_out" ? review?.items : undefined} looks={slot === "check_out" ? review?.worthALook : undefined} />
                        </div>
                      ) : null;
                    })}
                  </div>
                  {canReplace && review ? <p className="mt-3 text-xs text-zinc-500" data-testid="replace-note">Replacing a photo clears the comparison and the proposal, and you compare again. The renter hasn&rsquo;t answered yet, so nothing is lost.</p> : null}
                  {status === "held" && booking.renterToken ? (
                    <p className="mt-3 text-xs text-zinc-500" data-testid="renter-photo-invite">
                      The renter can add their own check-in or check-out photo on{" "}
                      <Link href={`/renter/${booking.renterToken}`} target="_blank" className="underline underline-offset-2 hover:text-zinc-800">their page</Link> until you compare. The comparison weighs them with yours.
                    </p>
                  ) : null}
                </Step>
              ) : null}

              {photos.check_in && photos.check_out ? (
                <Step n={3} title="AI compares the photos" done={!!review}>
                  {review ? (
                    <div className="space-y-3" data-testid="review">
                      {compareRun?.finishedAt && !compareRun.error ? <WaitStory run={compareRun} events={events} bookingId={booking.id} /> : null}
                      {!review.items.length && review.worthALook?.length ? (
                        <p className="text-sm text-zinc-700">Nothing the AI would charge for, but it flagged something worth a look.</p>
                      ) : (
                        <DamageItems lines={review.items.map((item) => ({ description: item.description, amountCents: item.chargeCents, price: item.price, box: item.box, photo: item.photo }))} />
                      )}
                      <p className="text-sm leading-relaxed text-zinc-700">{review.reasoning}</p>
                      {review.renterPhotos?.length ? <p className="text-sm text-zinc-700" data-testid="review-renter-photos">The comparison weighed the renter&rsquo;s own {review.renterPhotos.map((slot) => (slot === "check_in" ? "check-in" : "check-out")).join(" and ")} photo{review.renterPhotos.length > 1 ? "s" : ""} too.</p> : null}
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={review.mocked ? "warning" : "brand"} data-testid="review-engine">{review.mocked ? (booking.sample ? "Sample result" : "Simulated AI result") : `${review.model} · compare images`}</Badge>
                        {review.mocked ? null : <Badge data-testid="review-cost">Cost ${review.costUsd.toFixed(3)}</Badge>}
                        <Badge>Confidence: {review.confidence}</Badge>
                      </div>
                      {review.cappedToHold ? <Notice tone="muted">The items add up to more than the hold, so a charge stops at {formatCents(authorizedCents)}.</Notice> : null}
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {reviewError && compareRun?.error && busy !== "review" ? <WaitStory run={compareRun} events={events} bookingId={booking.id} /> : null}
                      {reviewError ? <Notice tone="error"><span data-testid="review-error">{reviewError}</span></Notice> : null}
                      <Button icon={<ScanSearch className="size-4" />} loading={busy === "review"} disabled={!!busy} onClick={compare} data-testid="run-review">
                        {reviewError ? "Try again" : "Compare photos"}
                      </Button>
                      {busy === "review" && compareRun ? (
                        <div data-testid="review-wait">
                          <WaitStory run={compareRun} events={events} bookingId={booking.id} />
                          <p className="mt-2 text-xs text-zinc-500">Claude usually takes about 20 seconds to compare two photos.</p>
                        </div>
                      ) : null}
                    </div>
                  )}
                </Step>
              ) : null}

              {review ? (
                <Step n={4} title="The agent proposes, you decide" done={status === "captured"}>
                  <div className="space-y-3">
                    {settlement?.error ? <Notice tone="error">{settlement.error}</Notice> : null}

                    {status === "reviewed" ? (
                      <>
                        {booking.agentError ? <Notice tone="error">{booking.agentError}</Notice> : <Notice tone="muted">The settlement agent is reading the review.</Notice>}
                        <Button icon={<Bot className="size-4" />} loading={busy === "propose"} disabled={!!busy} onClick={() => run("propose", "The agent could not finish", () => kitFetch<BookingView>(`${url}/propose`, { method: "POST" }))} data-testid="ask-agent">
                          Ask the agent again
                        </Button>
                      </>
                    ) : null}

                    {deciding && proposal ? <HostDecision key={proposal.runId} booking={booking} busy={busy} act={run} /> : null}

                    {status === "awaiting_approval" && approval ? <Notice tone="muted">Waiting for your approval below. Nothing has moved on the hold.</Notice> : null}

                    {status === "awaiting_approval" && !approval ? <Notice tone="muted">Working with PayPal.</Notice> : null}
                    {status === "captured" && !settlement?.error ? <Notice tone="muted">Charge taken. Releasing the rest of the hold.</Notice> : null}
                    {status === "captured" && settlement?.error ? (
                      <Button onClick={() => run("release", "Could not release the hold", () => kitFetch<BookingView>(`${url}/release`, { method: "POST" }))} loading={busy === "release"} data-testid="retry-release">
                        Release the rest of the hold
                      </Button>
                    ) : null}
                  </div>
                </Step>
              ) : null}
            </CardBody>
          </Card>
          {status === "awaiting_approval" && approval ? (
            <div ref={decision} className="scroll-mt-6">
              <ApprovalHero booking={booking} onDecided={() => void refresh().catch(() => undefined)} />
            </div>
          ) : null}
          <DisputePanel booking={booking} busy={busy} act={run} onDecided={() => void refresh().catch(() => undefined)} />
          {timeline}
        </div>
      )}
    </>
  );
}
