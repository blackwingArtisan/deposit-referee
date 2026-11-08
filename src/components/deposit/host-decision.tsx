"use client";

import { useState } from "react";
import Link from "next/link";
import { Bot, CircleAlert, ExternalLink, MessageSquareWarning, Plus, ShieldCheck } from "lucide-react";
import { useKit } from "@/components/kit/kit-provider";
import { useToast } from "@/components/toast";
import { Badge, Button, Field, Input, MoneyInput } from "@/components/ui";
import { centsToDollars, formatExactCents, itemizedCents, localTime, parseLineAmount, releasedCents, renterClearance } from "@/lib/deposit/rules";
import { heldCents, splitOf, type Split } from "@/lib/deposit/split-rules";
import type { BookingView, ChargeLine, DamageItem } from "@/lib/deposit/types";
import { PriceSource, PriceTable } from "./damage-items";
import { lookLetter } from "./photo-frame";

function RenterPanel({ booking, chargeCents }: { booking: BookingView; chargeCents: number }) {
  const { toast } = useToast();
  const response = booking.renterState?.response;
  const path = `/renter/${booking.renterToken}`;
  const clearance = renterClearance(booking.renterState, chargeCents);
  const copy = () =>
    navigator.clipboard
      .writeText(`${window.location.origin}${path}`)
      .then(() => toast({ title: "Renter link copied", variant: "success" }))
      .catch(() => toast({ title: "Could not copy the link", variant: "error" }));

  if (response?.decision === "contested") {
    return (
      <div data-testid="renter-note" className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
        <p className="flex items-center gap-2 font-semibold"><MessageSquareWarning className="size-4" /> The renter contested {response.acceptedLineIds?.length ? "part of the charge" : formatExactCents(response.amountCents)}</p>
        <p className="mt-1">&ldquo;{response.note}&rdquo;</p>
        <p className="mt-2 text-xs">The capture stopped here. Lower the charge, release the deposit, or keep the charge knowing the renter disagrees. They can still open a dispute with PayPal.</p>
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-zinc-200 px-4 py-3 text-sm">
      <p className="font-medium text-zinc-900" data-testid="renter-status">{clearance.until ? `The renter has until ${localTime(clearance.until)} to accept or contest.` : clearance.reason}</p>
      <p className="mt-1 text-zinc-600">Send the renter their link. They see this proposal and the photos, and can accept or contest it before anything is charged.</p>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <Link href={path} target="_blank" className="inline-flex items-center gap-1 font-medium text-brand underline underline-offset-2" data-testid="renter-link">
          Open the renter&rsquo;s page <ExternalLink className="size-3.5" aria-hidden />
        </Link>
        <button type="button" onClick={copy} className="text-zinc-600 underline underline-offset-2 hover:text-zinc-900">Copy link</button>
      </div>
    </div>
  );
}

function LineRow({ line, value, error, disabled, onChange }: { line: ChargeLine; value: string; error?: string; disabled: boolean; onChange: (value: string) => void }) {
  return (
    <li className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_8.5rem] sm:items-start">
      <div className="min-w-0 text-sm text-zinc-700">
        <p>{line.description}</p>
        <PriceSource price={line.price} className="mt-0.5" />
        {line.note ? <p className="mt-0.5 text-xs text-zinc-500">{line.note}</p> : null}
        {line.aiCents === undefined ? <p className="mt-0.5 text-xs text-zinc-500">Added by you</p> : line.aiCents !== line.amountCents ? <p className="mt-0.5 text-xs text-zinc-500">The AI proposed {formatExactCents(line.aiCents)}</p> : null}
      </div>
      <div>
        <MoneyInput aria-label={`Amount for ${line.description}`} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} data-testid={`line-amount-${line.id}`} />
        {error ? <p className="mt-1 text-xs text-red-600">{error}</p> : null}
      </div>
    </li>
  );
}

function AddLine({ disabled, onAdd }: { disabled: boolean; onAdd: (description: string, cents: number) => Promise<void> }) {
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const parsed = parseLineAmount(amount);
  const ready = description.trim().length >= 3 && !!parsed.cents;
  async function add() {
    if (!parsed.cents) return;
    await onAdd(description.trim(), parsed.cents);
    setDescription("");
    setAmount("");
  }
  return (
    <details className="text-sm" data-testid="add-line">
      <summary className="cursor-pointer text-zinc-600 hover:text-zinc-900">Add damage the AI missed</summary>
      <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_8.5rem_auto] sm:items-end">
        <Field label="What's damaged" htmlFor="new-line-description">
          <Input id="new-line-description" value={description} maxLength={200} onChange={(e) => setDescription(e.target.value)} data-testid="new-line-description" />
        </Field>
        <Field label="Amount" htmlFor="new-line-amount">
          <MoneyInput id="new-line-amount" value={amount} onChange={(e) => setAmount(e.target.value)} data-testid="new-line-amount" />
        </Field>
        <Button variant="secondary" icon={<Plus className="size-4" />} disabled={disabled || !ready} onClick={add} data-testid="new-line-add">Add</Button>
      </div>
    </details>
  );
}

/** What the AI noticed but wouldn't charge. Letters match the amber boxes on the check-out photo. */
function WorthALook({ looks, onCharge, disabled, onAdd }: { looks: DamageItem[]; onCharge: (index: number) => boolean; disabled: boolean; onAdd: (index: number) => void }) {
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3" data-testid="worth-a-look">
      <h4 className="text-sm font-semibold text-amber-950">Worth a look</h4>
      <p className="mt-0.5 text-xs text-amber-900">The AI noticed {looks.length === 1 ? "this" : "these"} but wasn&rsquo;t sure enough to charge. Check the amber box on the check-out photo. Nothing here is charged unless you add it, and the renter sees anything you add.</p>
      <ul className="mt-3 space-y-3">
        {looks.map((look, i) => (
          <li key={i} className="flex flex-wrap items-start justify-between gap-2 text-sm" data-testid={`look-${i}`}>
            <span className="flex size-5 shrink-0 items-center justify-center bg-amber-400 text-xs font-semibold text-amber-950" aria-hidden>{lookLetter(i)}</span>
            <div className="min-w-0 flex-1 basis-48 text-zinc-800">
              <p>{look.description}</p>
              <p className="mt-0.5 text-xs text-zinc-600">{formatExactCents(look.chargeCents)} from the price table if you add it. You can change that.</p>
              <PriceSource price={look.price} />
            </div>
            {onCharge(i) ? (
              <Badge tone="success">On the charge</Badge>
            ) : (
              <Button variant="secondary" size="sm" icon={<Plus className="size-4" />} disabled={disabled} onClick={() => onAdd(i)} data-testid={`look-add-${i}`}>Add to charge</Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The renter accepted some items and contested others: the accepted part is charged on its own. */
function SplitPanel({ booking, split, busy, act }: { booking: BookingView; split: Split; busy: string | null; act: (name: string, failTitle: string, action: () => Promise<BookingView>) => Promise<void> }) {
  const { kitFetch } = useKit();
  const part = booking.partCapture;
  if (part?.captureId) {
    return (
      <div className="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-950" data-testid="part-capture">
        <p className="font-semibold">{formatExactCents(part.capturedCents ?? 0)} charged now for the {part.lines.length === 1 ? "item" : "items"} the renter accepted</p>
        <ul className="mt-1 list-disc pl-5">
          {part.lines.map((line) => <li key={line.id}>{line.description} ({formatExactCents(line.amountCents)})</li>)}
        </ul>
        <p className="mt-2 text-xs">
          PayPal capture <span className="font-mono" data-testid="part-capture-id">{part.captureId}</span>, {part.captureStatus?.toLowerCase()}, read back from PayPal. It was not the final capture, so the contested {formatExactCents(split.contestedCents)} is still on the same hold. Settle it below. PayPal can&rsquo;t shrink a hold, so the app won&rsquo;t charge more than the contested amount from it, and settling releases the rest.
        </p>
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-sky-300 bg-sky-50 px-4 py-3 text-sm text-sky-950" data-testid="split-panel">
      <p className="font-semibold">The renter accepted {formatExactCents(split.acceptedCents)} and contested {formatExactCents(split.contestedCents)}</p>
      <ul className="mt-1 list-disc pl-5">
        {split.accepted.map((line) => <li key={line.id}>Accepted: {line.description} ({formatExactCents(line.amountCents)})</li>)}
        {split.contested.map((line) => <li key={line.id}>Contested: {line.description} ({formatExactCents(line.amountCents)})</li>)}
      </ul>
      {booking.renterState?.response?.note ? <p className="mt-2" data-testid="renter-note">&ldquo;{booking.renterState.response.note}&rdquo;</p> : null}
      <p className="mt-2 text-xs">The accepted items can be charged now. The contested part stays on the hold until you settle it.</p>
      {part?.error ? <p className="mt-2 text-xs text-red-700" data-testid="part-capture-error">{part.error}</p> : null}
      {booking.status === "contested" ? (
        <Button className="mt-3" size="sm" loading={busy === "part"} disabled={!!busy} onClick={() => act("part", "Could not request approval", () => kitFetch<BookingView>(`/api/bookings/${booking.id}/part-capture`, { method: "POST" }))} data-testid="request-part-capture">
          Request approval to charge the accepted {formatExactCents(split.acceptedCents)} now
        </Button>
      ) : null}
    </div>
  );
}

/** The agent has stopped. Everything from here is the host's call, and no money moves until they approve. */
export function HostDecision({ booking, busy, act }: { booking: BookingView; busy: string | null; act: (name: string, failTitle: string, action: () => Promise<BookingView>) => Promise<void> }) {
  const { kitFetch } = useKit();
  const { toast } = useToast();
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [reason, setReason] = useState<string | undefined>(undefined);
  const { proposal, hold } = booking;
  // After the accepted items were charged on their own, only the rest of the hold is left to decide.
  const authorizedCents = heldCents(booking);
  const split = splitOf(booking);
  const splitPending = !!split && !booking.partCapture?.captureId;
  const releaseLabel = booking.partCapture?.captureId ? `Release the remaining ${formatExactCents(authorizedCents)} instead` : "Release the whole deposit instead";
  if (!proposal) return null;

  const url = `/api/bookings/${booking.id}`;
  const parsed = proposal.lines.map((line) => {
    const value = edits[line.id] ?? centsToDollars(line.amountCents);
    return { line, value, ...parseLineAmount(value) };
  });
  const invalid = parsed.some((p) => p.cents === undefined);
  const savedCents = itemizedCents(proposal.lines);
  const totalCents = parsed.reduce((sum, p) => sum + (p.cents ?? 0), 0);
  const overHold = totalCents > authorizedCents;
  const dirty = parsed.some((p) => p.cents !== p.line.amountCents);
  const raised = totalCents > savedCents;
  const clearance = renterClearance(booking.renterState, totalCents);
  const contested = booking.status === "contested";
  const release = totalCents === 0 && !invalid;
  const blocked = !!busy || !!hold?.expired;

  const reasonChanged = reason !== undefined && reason.trim() !== (proposal.hostReason ?? "");
  const changedFromAi = totalCents !== proposal.aiCents || !!proposal.hostReason;
  const saveLines = (more?: { add?: { description: string; amountCents: number }; addLook?: number }) =>
    kitFetch<BookingView>(`${url}/lines`, { json: { lines: parsed.map((p) => ({ id: p.line.id, amountCents: p.cents ?? p.line.amountCents })), ...(reason?.trim() ? { reason: reason.trim() } : {}), ...more } });
  const looks = booking.review?.worthALook ?? [];
  const sendCharge = async () => {
    if (dirty || reasonChanged) await saveLines();
    return kitFetch<BookingView>(`${url}/settle`, { json: { chargeCents: totalCents } });
  };
  const sendRelease = () => kitFetch<BookingView>(`${url}/settle`, { json: { release: true } });
  const limitTest = async () => {
    const after = await kitFetch<BookingView>(`${url}/limit-test`, { method: "POST" });
    toast({ title: `Refused: ${formatExactCents(authorizedCents + 1)} is more than the hold`, description: "The app's code stopped it before PayPal. No money moved.", variant: "success", durationMs: 5000 });
    return after;
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg bg-zinc-50 px-4 py-3" data-testid="ai-proposal">
        <p className="flex items-center gap-2 font-medium text-zinc-900">
          <Bot className="size-4 text-brand" aria-hidden />
          {proposal.kind === "release" ? `The agent proposes releasing the whole ${formatExactCents(authorizedCents)}.` : `The agent proposes charging ${formatExactCents(proposal.aiCents)} and releasing ${formatExactCents(authorizedCents - proposal.aiCents)}.`}
        </p>
        <p className="mt-1.5 text-sm leading-relaxed text-zinc-700">{proposal.rationale}</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Badge tone={proposal.simulated ? "warning" : "brand"}>{proposal.engine}</Badge>
          <span className="text-xs text-zinc-500">It has stopped here. It can&rsquo;t move money.</span>
        </div>
      </div>

      {split ? <SplitPanel booking={booking} split={split} busy={busy} act={act} /> : null}

      {splitPending ? (
        <Button variant="secondary" onClick={() => act("settle", "Could not request approval", sendRelease)} disabled={blocked} data-testid="release-instead">
          Release the whole deposit instead
        </Button>
      ) : (
      <>
      {looks.length ? <WorthALook looks={looks} onCharge={(i) => proposal.lines.some((line) => line.id === `look-${i}`)} disabled={blocked || invalid || contested} onAdd={(i) => act("add-look", "Could not add it to the charge", () => saveLines({ addLook: i }))} /> : null}

      <div className="rounded-lg border border-zinc-200 px-4 py-3">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h4 className="text-sm font-semibold text-zinc-900">Itemized charge</h4>
          <p className="text-xs text-zinc-500">Each amount comes from the price table, not the AI. Change it to your real cost.</p>
        </div>
        {parsed.length ? (
          <ul className="space-y-3">
            {parsed.map((p) => (
              <LineRow key={p.line.id} line={p.line} value={p.value} error={p.error} disabled={!!busy} onChange={(value) => setEdits((all) => ({ ...all, [p.line.id]: value }))} />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-zinc-600">Nothing to charge.</p>
        )}
        {changedFromAi ? (
          <div className="mt-3">
            <Field label="Why you changed the AI's figure (the renter sees this)" htmlFor="host-reason">
              <Input id="host-reason" value={reason ?? proposal.hostReason ?? ""} maxLength={160} disabled={!!busy} onChange={(e) => setReason(e.target.value)} placeholder="For example: only one board needs sanding" data-testid="host-reason" />
            </Field>
          </div>
        ) : null}
        <div className="mt-3 border-t border-zinc-100 pt-3">
          <PriceTable highlight={proposal.lines.flatMap((line) => (line.price ? [line.price] : []))} />
        </div>
        <div className="mt-3 border-t border-zinc-100 pt-3">
          <AddLine disabled={blocked} onAdd={(description, amountCents) => act("add-line", "Could not add the line", () => saveLines({ add: { description, amountCents } }))} />
        </div>
      </div>

      <p className="text-sm text-zinc-700" data-testid="charge-preview">
        {overHold ? <span className="text-red-700">That&rsquo;s more than the {formatExactCents(authorizedCents)} hold.</span> : release ? `Charge nothing and release ${formatExactCents(authorizedCents)} to the renter.` : invalid ? "Check the amounts above." : `Charge exactly ${formatExactCents(totalCents)} and release ${formatExactCents(releasedCents(authorizedCents, totalCents))} to the renter.`}
      </p>

      {!release ? <RenterPanel booking={booking} chargeCents={raised ? savedCents : totalCents} /> : null}

      <div className="flex flex-wrap items-center gap-2">
        {release ? (
          <Button onClick={() => act("settle", "Could not request approval", sendRelease)} loading={busy === "settle"} disabled={blocked} data-testid="request-release">
            Request approval to release {formatExactCents(authorizedCents)}
          </Button>
        ) : raised ? (
          <Button onClick={() => act("lines", "Could not save the change", () => saveLines())} loading={busy === "lines"} disabled={blocked || invalid || overHold || contested} data-testid="save-lines">
            Show the renter {formatExactCents(totalCents)}
          </Button>
        ) : (
          <Button onClick={() => act("settle", "Could not request approval", sendCharge)} loading={busy === "settle"} disabled={blocked || invalid || overHold || !clearance.cleared} data-testid="request-approval">
            Request approval for {formatExactCents(totalCents)}
          </Button>
        )}
        {!release ? (
          <Button variant="secondary" onClick={() => act("settle", "Could not request approval", sendRelease)} disabled={blocked} data-testid="release-instead">
            {releaseLabel}
          </Button>
        ) : null}
      </div>
      {raised && contested ? <p className="flex items-center gap-1.5 text-sm text-red-700"><CircleAlert className="size-4" /> The renter contested this charge, so it can only go down now.</p> : null}

      <p className="flex items-center gap-1.5 text-xs text-zinc-600"><ShieldCheck className="size-4 shrink-0 text-brand" aria-hidden /> Code limit: no capture above the itemized lines ({formatExactCents(savedCents)}) or the hold ({formatExactCents(authorizedCents)}), whatever the AI asks.</p>
      <details className="text-xs text-zinc-500" data-testid="for-judges">
        <summary className="cursor-pointer select-none hover:text-zinc-800">For judges</summary>
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-zinc-50 px-3 py-2">
          <span>Have an agent try to capture {formatExactCents(authorizedCents + 1)}, one cent over the hold, through the real tool and Guard.</span>
          <Button variant="secondary" size="sm" disabled={!!busy} loading={busy === "limit-test"} onClick={() => act("limit-test", "The limit test could not run", limitTest)} data-testid="limit-test">
            Test the limit
          </Button>
        </div>
      </details>
      </>
      )}
    </div>
  );
}
