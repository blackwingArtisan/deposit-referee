"use client";

import { useState } from "react";
import Link from "next/link";
import { Bot, CircleAlert, ExternalLink, MessageSquareWarning, Plus, ShieldCheck } from "lucide-react";
import { useKit } from "@/components/kit/kit-provider";
import { useToast } from "@/components/toast";
import { Badge, Button, Field, Input, MoneyInput } from "@/components/ui";
import { centsToDollars, formatExactCents, itemizedCents, localTime, parseLineAmount, releasedCents, renterClearance } from "@/lib/deposit/rules";
import type { BookingView, ChargeLine } from "@/lib/deposit/types";

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
        <p className="flex items-center gap-2 font-semibold"><MessageSquareWarning className="size-4" /> The renter contested {formatExactCents(response.amountCents)}</p>
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

/** The agent has stopped. Everything from here is the host's call, and no money moves until they approve. */
export function HostDecision({ booking, busy, act }: { booking: BookingView; busy: string | null; act: (name: string, failTitle: string, action: () => Promise<BookingView>) => Promise<void> }) {
  const { kitFetch } = useKit();
  const { toast } = useToast();
  const [edits, setEdits] = useState<Record<string, string>>({});
  const { proposal, hold, authorizedCents = booking.depositCents } = booking;
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

  const saveLines = (add?: { description: string; amountCents: number }) => kitFetch<BookingView>(`${url}/lines`, { json: { lines: parsed.map((p) => ({ id: p.line.id, amountCents: p.cents ?? p.line.amountCents })), add } });
  const sendCharge = async () => {
    if (dirty) await saveLines();
    return kitFetch<BookingView>(`${url}/settle`, { json: { chargeCents: totalCents } });
  };
  const sendRelease = () => kitFetch<BookingView>(`${url}/settle`, { json: { release: true } });
  const limitTest = async () => {
    const after = await kitFetch<BookingView>(`${url}/limit-test`, { method: "POST" });
    toast({ title: "Every attempt was refused", description: "No money moved. See the timeline.", variant: "success", durationMs: 5000 });
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

      <div className="rounded-lg border border-zinc-200 px-4 py-3">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h4 className="text-sm font-semibold text-zinc-900">Itemized charge</h4>
          <p className="text-xs text-zinc-500">The AI&rsquo;s figures are proposals, not repair quotes. Change them to your real cost.</p>
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
        <div className="mt-3 border-t border-zinc-100 pt-3">
          <AddLine disabled={blocked} onAdd={(description, amountCents) => act("add-line", "Could not add the line", () => saveLines({ description, amountCents }))} />
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
            Release the whole deposit instead
          </Button>
        ) : null}
      </div>
      {raised && contested ? <p className="flex items-center gap-1.5 text-sm text-red-700"><CircleAlert className="size-4" /> The renter contested this charge, so it can only go down now.</p> : null}

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-brand-50/70 px-3 py-2 text-xs text-zinc-700">
        <p className="flex items-center gap-1.5"><ShieldCheck className="size-4 shrink-0 text-brand" aria-hidden /> Code limit: no capture above the itemized lines ({formatExactCents(savedCents)}) or the hold ({formatExactCents(authorizedCents)}), whatever the AI asks.</p>
        <Button variant="ghost" size="sm" disabled={!!busy} loading={busy === "limit-test"} onClick={() => act("limit-test", "The limit test could not run", limitTest)} data-testid="limit-test">
          Test the limit
        </Button>
      </div>
    </div>
  );
}
