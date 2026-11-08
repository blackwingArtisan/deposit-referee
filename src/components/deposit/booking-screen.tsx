"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { useParams } from "next/navigation";
import { Bot, ChevronDown, CircleAlert, Clock, ImagePlus, Landmark, Lock, ScanSearch, Upload } from "lucide-react";
import { ApprovalPrompt } from "@/components/agent/approval-prompt";
import { ToolCallTimeline } from "@/components/agent/tool-call-timeline";
import { useKit } from "@/components/kit/kit-provider";
import { useTimeline } from "@/components/kit/use-timeline";
import { CheckoutButton } from "@/components/paypal/checkout-button";
import { PageHeader } from "@/components/shell/app-shell";
import { useToast } from "@/components/toast";
import { Badge, Button, Card, CardBody, EmptyState, SkeletonCard } from "@/components/ui";
import { formatCents, formatExactCents, HOLD_LIMIT_DAYS, HONOR_DAYS } from "@/lib/deposit/rules";
import { bookingSteps, combineEvents } from "@/lib/deposit/timeline";
import type { BookingStatus, BookingView, PhotoSlot } from "@/lib/deposit/types";
import { mergeEvents, type TimelineEvent, type TimelineStep } from "@/lib/events/types";
import type { Money } from "@/lib/money";
import { DamageItems } from "./damage-items";
import { HostDecision } from "./host-decision";
import { PhotoFrame } from "./photo-frame";
import { Ruling } from "./ruling";

const STATUS_LABEL: Record<BookingStatus, { label: string; tone: "neutral" | "info" | "warning" | "brand" | "success" }> = {
  draft: { label: "Waiting for deposit", tone: "neutral" },
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

const readAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("That file could not be read."));
    reader.readAsDataURL(file);
  });

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
function PayPalCalls({ steps }: { steps: TimelineStep[] }) {
  const [open, setOpen] = useState(false);
  const calls = steps.filter((s) => s.paypal);
  const last = calls.at(-1);
  return (
    <Card data-testid="paypal-calls">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center gap-3 px-5 py-3 text-left" data-testid="paypal-calls-toggle">
        <Landmark className="size-4 shrink-0 text-brand" aria-hidden />
        <span className="text-sm font-semibold text-zinc-900">PayPal calls ({calls.length})</span>
        {last ? <span className="hidden min-w-0 truncate text-sm text-zinc-500 sm:inline">Last: {last.title}</span> : null}
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
  const [booking, setBooking] = useState<BookingView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);

  const load = useCallback(() => kitFetch<BookingView>(`/api/bookings/${id}`), [id, kitFetch]);
  const refresh = useCallback(() => load().then(setBooking), [load]);

  useEffect(() => {
    load()
      .then(setBooking)
      .catch((e: Error) => setLoadError(e.message));
  }, [load]);

  // The money moves in the background once the host approves, so follow it until it stops.
  // While the host decides, the renter can answer from their own page at any moment.
  const moving = booking?.status === "awaiting_approval" || (booking?.status === "captured" && !booking.settlement?.error);
  const renterPending = booking?.status === "proposed";
  useEffect(() => {
    if (!moving && !renterPending) return;
    const timer = setInterval(() => void refresh().catch(() => undefined), moving ? 700 : 2000);
    return () => clearInterval(timer);
  }, [moving, renterPending, refresh]);

  // The booking keeps its own PayPal calls, so a reload or another tab shows every one of them.
  const savedKey = booking ? `${booking.status}:${booking.settlement?.captureId ?? ""}:${booking.settlement?.settledAt ?? ""}` : null;
  useEffect(() => {
    if (!savedKey) return;
    kitFetch<{ events: TimelineEvent[] }>(`/api/bookings/${id}/activity`)
      .then((r) => setSaved(r.events))
      .catch(() => undefined);
  }, [id, kitFetch, savedKey]);

  // On a phone the approval card and the result appear far from the button that asked for them.
  const decision = useRef<HTMLDivElement>(null);
  const approvalId = booking?.approval?.id;
  useEffect(() => {
    if (approvalId) decision.current?.scrollIntoView({ behavior: "smooth", block: "center" });
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
    try {
      setBooking(await kitFetch<BookingView>(`/api/bookings/${id}/review`, { method: "POST" }));
    } catch (e) {
      setReviewError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (loadError) return <EmptyState title="Booking not found" description={loadError} />;
  if (!booking) return <SkeletonCard />;

  const url = `/api/bookings/${booking.id}`;
  const { status, review, proposal, settlement, photos, authorizedCents = booking.depositCents } = booking;
  const deciding = status === "proposed" || status === "contested";

  const addDemoPhoto = (slot: PhotoSlot, kind?: { clean?: boolean; faint?: boolean }) => run(`photo:${slot}`, "Could not add the photo", () => kitFetch<BookingView>(`${url}/photos`, { json: { slot, ...kind } }));

  async function uploadPhoto(slot: PhotoSlot, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) await run(`photo:${slot}`, "Could not add the photo", async () => kitFetch<BookingView>(`${url}/photos`, { json: { slot, dataUrl: await readAsDataUrl(file) } }));
  }

  const approval = booking.approval;
  const timeline = <PayPalCalls steps={timelineSteps} />;

  return (
    <>
      <PageHeader
        eyebrow={`Rented by ${booking.renter}`}
        title={booking.item}
        description={`${formatCents(booking.depositCents)} damage deposit`}
        actions={<Badge tone={STATUS_LABEL[status].tone} dot>{STATUS_LABEL[status].label}</Badge>}
      />

      {booking.sample ? (
        <div className="mb-6" data-testid="sample-note">
          <Notice tone="muted">This is a sample booking. Its hold and any charge are {kit?.paypal.mode === "sandbox" ? "real objects on the PayPal sandbox" : "on mock PayPal"}. Its photo findings were written for the sample, not made by Claude on this booking. It was loaded with the demo data, so it has few PayPal calls.</Notice>
        </div>
      ) : null}

      {status === "settled" ? (
        <div className="space-y-6">
          <Ruling booking={booking} />
          {timeline}
        </div>
      ) : (
        <div className="mx-auto max-w-5xl space-y-6">
          <Card>
            <CardBody className="space-y-8 py-6">
              <Step n={1} title="Renter places the deposit" done={status !== "draft"}>
                {status === "draft" ? (
                  <>
                    <p className="mb-3 text-sm text-zinc-600">The renter approves a {formatCents(booking.depositCents)} hold with PayPal. The money is held, not taken.</p>
                    <CheckoutButton
                      createOrder={() => kitFetch<{ orderId: string }>(`${url}/deposit`, { method: "POST" })}
                      onApprove={({ orderId }) => run("hold", "PayPal did not place the hold", () => kitFetch<BookingView>(`${url}/deposit/authorize`, { json: { orderId } }))}
                      amountLabel={formatExactCents(booking.depositCents)}
                      onError={(e) => fail("Checkout failed", e)}
                      onCancel={() => toast({ title: "PayPal was closed before the hold was approved", description: "Nothing is held and nothing was charged. Press the button again when the renter is ready.", durationMs: 7000 })}
                      disabled={busy === "hold"}
                    />
                  </>
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
                        <PhotoFrame key={slot} label={label} photo={photo} items={slot === "check_out" ? review?.items : undefined} looks={slot === "check_out" ? review?.worthALook : undefined} />
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
                            </>
                          ) : null}
                          <label className="inline-flex h-8 cursor-pointer items-center justify-center gap-2 rounded-lg px-3 text-sm font-medium text-zinc-700 hover:bg-zinc-100 focus-within:ring-2 focus-within:ring-brand-300">
                            <Upload className="size-4" /> Upload photo
                            <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" disabled={!!busy} onChange={(e) => uploadPhoto(slot, e)} data-testid={`upload-photo-${slot}`} />
                          </label>
                        </div>
                      );
                    })}
                  </div>
                </Step>
              ) : null}

              {photos.check_in && photos.check_out ? (
                <Step n={3} title="AI compares the photos" done={!!review}>
                  {review ? (
                    <div className="space-y-3" data-testid="review">
                      {!review.items.length && review.worthALook?.length ? (
                        <p className="text-sm text-zinc-700">Nothing the AI would charge for, but it flagged something worth a look.</p>
                      ) : (
                        <DamageItems lines={review.items.map((item) => ({ description: item.description, amountCents: item.chargeCents }))} />
                      )}
                      <p className="text-sm leading-relaxed text-zinc-700">{review.reasoning}</p>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={review.mocked ? "warning" : "brand"} data-testid="review-engine">{review.mocked ? (booking.sample ? "Sample result" : "Simulated AI result") : `${review.model} · compare images`}</Badge>
                        {review.mocked ? null : <Badge data-testid="review-cost">Cost ${review.costUsd.toFixed(3)}</Badge>}
                        <Badge>Confidence: {review.confidence}</Badge>
                      </div>
                      {review.cappedToHold ? <Notice tone="muted">The items add up to more than the hold, so a charge stops at {formatCents(authorizedCents)}.</Notice> : null}
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {reviewError ? <Notice tone="error">{reviewError}</Notice> : null}
                      <Button icon={<ScanSearch className="size-4" />} loading={busy === "review"} disabled={!!busy} onClick={compare} data-testid="run-review">
                        Compare photos
                      </Button>
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

                    {status === "awaiting_approval" && approval ? (
                      <div ref={decision}>
                        <ApprovalPrompt
                          approvalId={approval.id}
                          summary={approval.summary}
                          reason="This is the Guard's approval step. No money moves until you approve."
                          amount={approval.amountValue ? ({ currency_code: "USD", value: approval.amountValue } satisfies Money) : undefined}
                          onDecided={() => void refresh().catch(() => undefined)}
                        />
                      </div>
                    ) : null}

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
          {timeline}
        </div>
      )}
    </>
  );
}
