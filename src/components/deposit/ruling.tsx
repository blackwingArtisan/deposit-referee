"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { formatCents } from "@/lib/deposit/rules";
import type { BookingView } from "@/lib/deposit/types";
import { DamageItems } from "./damage-items";
import { PhotoFrame } from "./photo-frame";

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

/** The result screen. Every number here was re-read from PayPal after the money moved. */
export function Ruling({ booking, calls }: { booking: BookingView; calls?: ReactNode }) {
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
  const wholeRelease = settlement?.kind === "release";
  const lines = proposal?.lines.filter((line) => line.amountCents > 0) ?? [];

  return (
    <section data-testid="ruling" className="rounded-2xl border border-zinc-200/80 bg-white p-5 sm:p-8">
      <h2 ref={headlineRef} data-testid="ruling-headline" className="text-4xl font-semibold tracking-tight tabular-nums sm:text-6xl">
        <span className="text-red-700">{formatCents(captured)} captured</span>
        <span className="text-zinc-400">, </span>
        <span className="text-emerald-700">{formatCents(released)} released</span>
      </h2>
      <p className="mt-3 text-[15px] text-zinc-600">
        From {booking.renter}&rsquo;s {formatCents(authorizedCents)} deposit on {booking.item}.{" "}
        {wholeRelease ? `Nothing was charged. PayPal confirms the hold is ${settlement?.authorizationStatus?.toLowerCase()}.` : `PayPal confirms the charge is ${settlement?.captureStatus?.toLowerCase()} and the hold is ${settlement?.authorizationStatus?.toLowerCase()}.`}
      </p>

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
      </div>

      {review ? (
        <div className="mt-6 grid gap-6 border-t border-zinc-100 pt-5 lg:grid-cols-2">
          <div>
            <h3 className="mb-2 text-sm font-semibold text-zinc-900">{wholeRelease ? "What the AI found" : "What was charged"}</h3>
            <DamageItems lines={wholeRelease ? [] : lines} />
          </div>
          <div>
            <h3 className="mb-2 text-sm font-semibold text-zinc-900">Why</h3>
            <p className="text-sm leading-relaxed text-zinc-700">{proposal?.rationale ?? review.reasoning}</p>
            {proposal?.hostReason ? <p className="mt-2 text-sm text-zinc-800" data-testid="ruling-host-reason"><span className="font-medium">Host&rsquo;s change:</span> {proposal.hostReason}</p> : null}
          </div>
        </div>
      ) : null}

      <dl className="mt-6 grid gap-x-6 border-t border-zinc-100 pt-4 sm:grid-cols-3">
        <Reference label="PayPal order" value={booking.orderId} />
        <Reference label="PayPal authorization" value={booking.authorizationId} />
        {wholeRelease ? null : <Reference label="PayPal capture" value={settlement?.captureId} />}
      </dl>
    </section>
  );
}
