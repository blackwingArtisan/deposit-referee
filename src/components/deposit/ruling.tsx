"use client";

import { Why } from "./why";
import { useEffect, useRef, type ReactNode } from "react";
import { moneyLine, moneySteps } from "@/lib/deposit/money-strip";
import { formatCents, formatExactCents } from "@/lib/deposit/rules";
import { FileDown, Users } from "lucide-react";
import { isUnchanged, verdictLabel } from "@/lib/deposit/second-look-rules";
import type { RulingView } from "@/lib/deposit/types";
import { DamageItems } from "./damage-items";
import { PhotoFrame, RENTER_SLOTS } from "./photo-frame";

function Reference({ label, value }: { label: string; value?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5 sm:block">
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd className="font-mono text-sm text-zinc-800">{value ?? "Not available"}</dd>
    </div>
  );
}

/** Scrolls the headline back into view only when it's off screen, so a reload at the top doesn't jump. */
function showHeadline(headline: HTMLElement | null) {
  if (!headline) return;
  const { top, bottom } = headline.getBoundingClientRect();
  if (top < 0 || bottom > window.innerHeight) headline.scrollIntoView({ block: "start" });
}

/**
 * The result screen, the same for host and renter. Every number here was re-read from PayPal after
 * the money moved. `viewer` only changes who "the other side" is in the shared line; `pack` links
 * the evidence PDF.
 */
export function Ruling({ booking, calls, viewer = "host", pack }: { booking: RulingView; calls?: ReactNode; viewer?: "host" | "renter"; pack?: string }) {
  const headlineRef = useRef<HTMLHeadingElement>(null);
  // The host approves far down the page. When the result appears, bring its headline into view.
  useEffect(() => showHeadline(headlineRef.current), []);
  // Opening the PayPal calls makes the list grow, which can push the headline off the top. For a
  // moment after the toggle is clicked, put it back in view whenever the list changes size.
  const callsRef = useRef<HTMLDivElement>(null);
  const keepUntil = useRef(0);
  useEffect(() => {
    const calls = callsRef.current;
    if (!calls) return;
    const observer = new ResizeObserver(() => {
      if (Date.now() < keepUntil.current) showHeadline(headlineRef.current);
    });
    observer.observe(calls);
    return () => observer.disconnect();
  }, []);
  const { settlement, review, proposal, photos, authorizedCents } = booking;
  const captured = settlement?.capturedCents;
  const released = settlement?.releasedCents;
  if (captured === undefined || released === undefined || authorizedCents === undefined) return null;
  const capturedShare = (captured / authorizedCents) * 100;
  const money = moneySteps(booking);
  // A split: the accepted items were charged first, on their own, from the same hold.
  const part = booking.partCapture?.captureId ? booking.partCapture : undefined;
  const wholeRelease = settlement?.kind === "release" && !part;
  const lines = [...(part?.lines ?? []), ...(settlement?.kind === "release" ? [] : (proposal?.lines.filter((line) => line.amountCents > 0) ?? []))];

  return (
    <section data-testid="ruling" className="rounded-2xl border border-zinc-200/80 bg-white p-5 sm:p-8">
      <h2 ref={headlineRef} data-testid="ruling-headline" className="text-4xl font-semibold tracking-tight tabular-nums sm:text-6xl">
        <span className="text-red-700">{formatCents(captured)} captured</span>
        <span className="text-zinc-400">, </span>
        <span className="text-emerald-700">{formatCents(released)} released</span>
      </h2>
      <p className="mt-3 text-[15px] text-zinc-600">
        From {booking.renter}&rsquo;s {formatCents(authorizedCents)} deposit on {booking.item}.{" "}
        {wholeRelease ? `Nothing was charged. PayPal confirms the hold is ${settlement?.authorizationStatus?.toLowerCase()}.` : part && settlement?.kind === "release" ? `${formatCents(part.capturedCents ?? 0)} was charged for the items the renter accepted, read back from PayPal, and the rest of the hold went back. The hold is ${settlement?.authorizationStatus?.toLowerCase()}.` : part ? `Two charges from one hold, both read back from PayPal: ${formatCents(part.capturedCents ?? 0)} for the items the renter accepted, then ${formatCents(captured - (part.capturedCents ?? 0))} for the contested part. The hold is ${settlement?.authorizationStatus?.toLowerCase()}.` : `PayPal confirms the charge is ${settlement?.captureStatus?.toLowerCase()} and the hold is ${settlement?.authorizationStatus?.toLowerCase()}.`}
      </p>

      {money ? (
        <p className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-base font-semibold tabular-nums sm:text-lg" data-testid="money-strip" aria-label={moneyLine(money)}>
          {money.map((s, i) => (
            <span key={i} className="inline-flex items-center gap-2">
              {i ? <span className="text-zinc-400" aria-hidden>→</span> : null}
              <span data-testid="money-step" data-kind={s.kind} className={s.kind === "captured" ? "text-red-700" : s.kind === "released" ? "text-emerald-700" : "text-zinc-900"}>
                {s.label}
              </span>
            </span>
          ))}
          <span className="text-sm font-normal text-zinc-500">· each amount as PayPal returned it</span>
        </p>
      ) : null}

      <div className="mt-5 flex h-3 overflow-hidden rounded-full" role="img" aria-label={`${formatCents(captured)} of ${formatCents(authorizedCents)} captured`}>
        <div className="bg-red-600" style={{ width: `${capturedShare}%` }} />
        <div className="flex-1 bg-emerald-500" />
      </div>

      {/* Right under the result, so opening the calls keeps the result in view. */}
      {calls ? (
        <div ref={callsRef} className="mt-5" onClickCapture={(e) => {
            // Only the show/hide toggle; a click on one call's details leaves the page where it is.
            if ((e.target as HTMLElement).closest('[data-testid="paypal-calls-toggle"]')) keepUntil.current = Date.now() + 2_000;
          }}>
          {calls}
        </div>
      ) : null}

      <div className="mt-7 grid gap-5 md:grid-cols-2">
        {photos.check_in ? <PhotoFrame label="Check-in" photo={photos.check_in} /> : null}
        {photos.check_out ? <PhotoFrame label="Check-out" photo={photos.check_out} items={lines.length ? lines : review?.items} /> : null}
        {RENTER_SLOTS.map(({ slot, label }) => {
          const photo = booking.renterPhotos?.[slot];
          return photo ? <PhotoFrame key={slot} label={label} photo={photo} on="renter_check_out" items={slot === "check_out" ? (lines.length ? lines : review?.items) : undefined} /> : null;
        })}
      </div>

      {review ? (
        <div className="mt-6 grid gap-6 border-t border-zinc-100 pt-5 lg:grid-cols-2">
          <div>
            <h3 className="mb-2 text-sm font-semibold text-zinc-900">{wholeRelease ? "What the AI found" : "What was charged"}</h3>
            <DamageItems lines={wholeRelease ? [] : lines} />
          </div>
          <div>
            {proposal?.hostReason ? <p className="mb-2 text-sm text-zinc-800" data-testid="ruling-host-reason"><span className="font-medium">Host&rsquo;s change:</span> {proposal.hostReason}</p> : null}
            <Why testId="ruling-why">
              <p className="leading-relaxed" data-testid="ruling-rationale">{proposal?.rationale ?? review.reasoning}</p>
            </Why>
          </div>
        </div>
      ) : null}

      {booking.secondLook?.status === "accepted" || (booking.secondLook?.status === "ready" && isUnchanged(booking.secondLook.lines)) ? (
        <div className="mt-6 border-t border-zinc-100 pt-5" data-testid="ruling-second-look">
          <h3 className="mb-2 text-sm font-semibold text-zinc-900">{booking.secondLook.status === "accepted" ? <>Claude&rsquo;s second look, accepted by the renter</> : <>Claude&rsquo;s second look changed nothing</>}</h3>
          <ul className="space-y-1 text-sm text-zinc-700">
            {booking.secondLook.lines.map((line) => (
              <li key={line.lineId}>
                {line.description.split(/(?<=\.)\s/)[0]} <span className="text-zinc-500">· {verdictLabel(line)} ·</span> <span className="tabular-nums">{formatExactCents(line.fromCents)} → {formatExactCents(line.toCents)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <dl className="mt-6 grid gap-x-6 border-t border-zinc-100 pt-4 sm:grid-cols-3">
        <Reference label="PayPal order" value={booking.orderId} />
        <Reference label="PayPal authorization" value={booking.authorizationId} />
        {part ? <Reference label="PayPal capture, accepted items" value={part.captureId} /> : null}
        {wholeRelease || (part && settlement?.kind === "release") ? null : <Reference label={part ? "PayPal capture, contested items" : "PayPal capture"} value={settlement?.captureId} />}
        {settlement?.authorizationStatus ? <Reference label="The rest of the hold" value={settlement.authorizationStatus} /> : null}
      </dl>

      <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-zinc-100 pt-4 text-sm">
        <p className="inline-flex items-center gap-1.5 text-zinc-600" data-testid="ruling-shared">
          <Users className="size-4 text-zinc-400" aria-hidden />
          {viewer === "host" ? `${booking.renter} sees this same page on their link.` : "The host sees this same page."}
        </p>
        {pack && captured > 0 ? (
          <a href={pack} download className="inline-flex items-center gap-1.5 font-medium text-brand-700 hover:underline" data-testid="ruling-pack">
            <FileDown className="size-4" aria-hidden /> Download the evidence pack (PDF)
          </a>
        ) : null}
      </div>
    </section>
  );
}
