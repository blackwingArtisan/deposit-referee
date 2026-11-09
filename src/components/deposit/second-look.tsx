"use client";

import { ArrowRight, Eye, Send } from "lucide-react";
import { useKit } from "@/components/kit/kit-provider";
import { Badge, Button } from "@/components/ui";
import { formatExactCents } from "@/lib/deposit/rules";
import { isDropped, verdictLabel } from "@/lib/deposit/second-look-rules";
import { splitOf } from "@/lib/deposit/split-rules";
import type { BookingPhoto, BookingView, ChargeLine, SecondLookLine } from "@/lib/deposit/types";
import { PriceSource } from "./damage-items";
import { PhotoFrame } from "./photo-frame";

/** The short label on a grey box. The card says the rest. */
export const droppedTag = (line: Pick<SecondLookLine, "verdict" | "toCents">) => (isDropped(line) ? (line.verdict === "already_there" ? "Already there" : "Not charged") : undefined);

const tone = (line: SecondLookLine) => (isDropped(line) ? "neutral" : line.toCents < line.fromCents ? "info" : "warning");

/** One contested line, before and after: the host's box (grey once dropped), the renter's photo, the verdict and the amounts. */
export function SecondLookLineRow({ line, charge, number, checkOut, evidence }: { line: SecondLookLine; charge?: ChargeLine; number: number; checkOut?: BookingPhoto; evidence?: BookingPhoto }) {
  return (
    <li className="space-y-3" data-testid="second-look-line" data-verdict={line.verdict}>
      <div className={`grid gap-3 ${evidence ? "grid-cols-2" : "grid-cols-1 sm:max-w-sm"}`}>
        {checkOut && charge?.box ? <PhotoFrame label="Host's check-out" photo={checkOut} items={[{ description: line.description, box: charge.box, photo: charge.photo, number, dropped: droppedTag(line) }]} on={charge.photo ?? "check_out"} /> : null}
        {evidence ? <PhotoFrame label="Renter's photo" photo={evidence} /> : null}
      </div>
      <div className="text-sm text-zinc-800">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{number}. {line.description.split(/(?<=\.)\s/)[0]}</span>
          <Badge tone={tone(line)} className="whitespace-normal" data-testid="second-look-verdict">{verdictLabel(line)}</Badge>
        </div>
        <p className="mt-1 text-zinc-700" data-testid="second-look-reasoning">{line.reasoning}</p>
        {line.price ? <PriceSource price={line.price} className="mt-0.5" /> : null}
        <p className="mt-1 flex items-center gap-1.5 font-semibold tabular-nums" data-testid="second-look-amount">
          <span className={line.toCents < line.fromCents ? "text-zinc-400 line-through" : ""}>{formatExactCents(line.fromCents)}</span>
          <ArrowRight className="size-3.5 text-zinc-400" aria-hidden />
          <span className={isDropped(line) ? "text-emerald-700" : "text-zinc-900"}>{formatExactCents(line.toCents)}</span>
        </p>
      </div>
    </li>
  );
}

/**
 * Claude's second look at what the renter contested, on the host's page: each line re-read with
 * the renter's photo and note, the box greyed where the charge dropped, the total before and after,
 * and the agent's counter with one button to send it.
 */
export function SecondLookCard({ booking, busy, act }: { booking: BookingView; busy: string | null; act: (name: string, failTitle: string, action: () => Promise<BookingView>) => Promise<void> }) {
  const { kitFetch } = useKit();
  const look = booking.secondLook;
  if (!look) return null;
  const response = booking.renterState?.response;
  const lines = booking.proposal?.lines ?? [];
  const acceptedCents = booking.partCapture?.capturedCents ?? splitOf(booking)?.acceptedCents ?? 0;
  const fromCents = look.lines.reduce((sum, l) => sum + l.fromCents, 0);
  const toCents = look.lines.reduce((sum, l) => sum + l.toCents, 0);
  const allLines = [...(booking.partCapture?.lines ?? splitOf(booking)?.accepted ?? []), ...lines];
  const numberOf = (id: string) => Math.max(1, allLines.findIndex((l) => l.id === id) + 1);
  const partPending = !!splitOf(booking) && !booking.partCapture?.captureId;
  const badge = look.mocked ? "Simulated AI result" : `${look.model ?? "Claude"} · second look`;

  return (
    <div className="space-y-4 rounded-lg border border-brand-200 bg-brand-50/40 px-4 py-4" data-testid="second-look" data-status={look.status}>
      <div className="flex flex-wrap items-center gap-2">
        <Eye className="size-4 text-brand" aria-hidden />
        <h4 className="text-sm font-semibold text-zinc-900">Claude&rsquo;s second look</h4>
        {look.status !== "running" && look.status !== "failed" ? <Badge tone={look.mocked ? "warning" : "brand"} data-testid="second-look-engine">{badge}</Badge> : null}
      </div>

      {look.status === "running" ? (
        <p className="text-sm text-zinc-700" data-testid="second-look-running">
          Claude is looking again at what the renter contested, with their note{Object.keys(response?.evidence ?? {}).length ? " and their photo" : ""}. It can only lower a line, never raise one.
        </p>
      ) : look.status === "failed" ? (
        <p className="text-sm text-red-800" data-testid="second-look-error">{look.error}</p>
      ) : (
        <>
          <ul className="space-y-5">
            {look.lines.map((line) => (
              <SecondLookLineRow key={line.lineId} line={line} charge={lines.find((l) => l.id === line.lineId)} number={numberOf(line.lineId)} checkOut={booking.photos.check_out} evidence={response?.evidence?.[line.lineId]?.photo} />
            ))}
          </ul>
          <p className="flex flex-wrap items-center gap-2 rounded-md bg-white px-3 py-2 text-base font-semibold tabular-nums text-zinc-900" data-testid="second-look-total">
            <span>Total charge</span>
            <span className={toCents < fromCents ? "text-zinc-400 line-through" : ""}>{formatExactCents(acceptedCents + fromCents)}</span>
            <ArrowRight className="size-4 text-zinc-400" aria-hidden />
            <span>{formatExactCents(acceptedCents + toCents)}</span>
          </p>
          {look.counter ? (
            <div className="text-sm" data-testid="counter">
              <p className="text-zinc-800"><span className="font-medium">The agent&rsquo;s counter:</span> <span data-testid="counter-rationale">{look.counter.rationale}</span></p>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <Badge tone={look.counter.simulated ? "warning" : "brand"}>{look.counter.engine}</Badge>
                <span className="text-xs text-zinc-500">Amounts by code from the second look. The agent can&rsquo;t move money.</span>
              </div>
            </div>
          ) : null}
          {look.status === "ready" ? (
            <div className="space-y-1">
              <Button icon={<Send className="size-4" />} loading={busy === "counter"} disabled={!!busy || partPending || !look.counter || booking.status !== "contested"} onClick={() => act("counter", "Could not send the counter", () => kitFetch<BookingView>(`/api/bookings/${booking.id}/counter`, { method: "POST" }))} data-testid="send-counter">
                Send the counter to the renter: {formatExactCents(toCents)}
              </Button>
              {partPending ? <p className="text-xs text-zinc-600" data-testid="send-counter-why">Approve the items the renter accepted first.</p> : null}
            </div>
          ) : look.status === "sent" ? (
            <p className="text-sm text-zinc-700" data-testid="counter-sent">Sent to the renter. If they accept, the charge comes back to you for approval. Nothing has moved.</p>
          ) : (
            <p className="text-sm text-zinc-700" data-testid="counter-accepted">The renter accepted the counter.</p>
          )}
        </>
      )}
    </div>
  );
}
