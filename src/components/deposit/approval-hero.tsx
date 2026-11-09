"use client";

import { useState } from "react";
import { Check, MessageSquareWarning, ShieldAlert, ShieldCheck, X } from "lucide-react";
import { useKit } from "@/components/kit/kit-provider";
import { useToast } from "@/components/toast";
import { Badge, Button, Card, CardBody } from "@/components/ui";
import { approvalAction, approvalPlan } from "@/lib/deposit/approval-plan";
import { formatExactCents, localTime } from "@/lib/deposit/rules";
import { heldCents } from "@/lib/deposit/split-rules";
import type { BookingView, ChargeLine } from "@/lib/deposit/types";
import { PriceSource } from "./damage-items";

function RenterAnswer({ booking, kind }: { booking: BookingView; kind: "part" | "charge" | "release" | "unknown" }) {
  const state = booking.renterState;
  const response = state?.response;
  let text: string;
  let quote: string | undefined;
  const counterAccepted = booking.secondLook?.status === "accepted";
  if (counterAccepted && kind !== "part") text = kind === "release" ? "The renter accepted the counter from Claude’s second look: nothing more is charged." : "The renter accepted the counter from Claude’s second look.";
  else if (kind === "release") text = "Nothing is charged, so the renter doesn’t need to answer first.";
  else if (kind === "part") text = `The renter accepted these items and contested the rest.`;
  else if (response?.decision === "accepted") text = `The renter accepted the ${formatExactCents(response.amountCents)} charge.`;
  else if (response?.decision === "contested") {
    text = `The renter contested ${response.acceptedLineIds?.length ? "part of the charge" : formatExactCents(response.amountCents)}. You’re going ahead knowing they disagree.`;
    quote = response.note;
  } else text = state ? `The renter didn’t answer by ${localTime(state.deadline)}.` : "The renter hasn’t answered.";
  const contested = kind === "charge" && response?.decision === "contested" && !counterAccepted;
  return (
    <div data-testid="approval-renter-answer" className={contested ? "rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950" : "rounded-lg border border-zinc-200 px-4 py-3 text-sm text-zinc-800"}>
      <p className="flex items-center gap-2 font-medium">
        {contested ? <MessageSquareWarning className="size-4 shrink-0" aria-hidden /> : null}
        {text}
      </p>
      {quote ? <p className="mt-1">&ldquo;{quote}&rdquo;</p> : null}
    </div>
  );
}

function lineAnswer(booking: BookingView, line: ChargeLine, kind: "part" | "charge" | "release" | "unknown"): string | null {
  if (kind === "part" || booking.secondLook?.status === "accepted") return "Renter accepts";
  const response = booking.renterState?.response;
  if (!response) return null;
  if (response.decision === "accepted") return "Renter accepts";
  if (!response.acceptedLineIds?.length) return "Renter contests";
  return response.acceptedLineIds.includes(line.id) ? "Renter accepts" : "Renter contests";
}

/**
 * The approval gate, as the main card on the page: every line with its price row, the renter's
 * answer, what moves on the hold, and the Guard's own reason for stopping. No money moves until
 * the host clicks Approve.
 */
export function ApprovalHero({ booking, onDecided }: { booking: BookingView; onDecided: () => void }) {
  const { kitFetch } = useKit();
  const { toast } = useToast();
  const [busy, setBusy] = useState<"approved" | "denied" | null>(null);
  const approval = booking.approval!;
  const plan = approvalPlan(booking);

  async function decide(decision: "approved" | "denied") {
    setBusy(decision);
    try {
      await kitFetch(`/api/agent/approvals/${approval.id}`, { json: { decision } });
      toast({ title: decision === "approved" ? "Approved" : "Declined", description: approval.summary, variant: decision === "approved" ? "success" : "warning" });
      onDecided();
    } catch (e) {
      toast({ title: "Could not record decision", description: (e as Error).message, variant: "error" });
      setBusy(null);
    }
  }

  const title = plan.kind === "release" ? "Approve the release" : plan.kind === "part" ? "Approve the accepted items" : plan.kind === "charge" ? "Approve the charge" : "Approve this step";
  const action = approvalAction(plan);
  const money =
    plan.kind === "unknown"
      ? "No amount named: check the summary above"
      : plan.kind === "part"
        ? `Capture ${formatExactCents(plan.captureCents)} · keep ${formatExactCents(plan.keepCents)} on hold`
        : `Capture ${formatExactCents(plan.captureCents)} · release ${formatExactCents(plan.releaseCents)}`;

  return (
    <Card className="border-amber-300 ring-2 ring-amber-200" data-testid="approval-prompt">
      <CardBody className="space-y-5 py-6">
        <div className="flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700">
            <ShieldAlert className="size-5" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Approval needed · nothing has moved yet</p>
            <h2 className="mt-0.5 text-xl font-semibold text-zinc-900" data-testid="approval-title">{title}</h2>
            <p className="mt-1 text-sm text-zinc-700" data-testid="approval-summary">{approval.summary}</p>
          </div>
        </div>

        {plan.lines.length ? (
          <ol className="divide-y divide-zinc-100 rounded-lg border border-zinc-200" data-testid="approval-lines">
            {plan.lines.map((line, i) => {
              const answer = lineAnswer(booking, line, plan.kind);
              return (
                <li key={line.id} className="flex gap-3 px-4 py-3 text-sm" data-testid="approval-line">
                  <span className="flex size-5 shrink-0 items-center justify-center bg-red-600 text-xs font-semibold text-white" aria-hidden>{i + 1}</span>
                  <span className="min-w-0 flex-1 text-zinc-800">
                    {line.description}
                    {line.price ? <PriceSource price={line.price} className="mt-0.5" /> : <span className="mt-0.5 block text-xs text-zinc-500" data-testid="price-row">Added by you, not from the price table</span>}
                    {answer ? <span className="mt-1.5 block"><Badge tone={answer === "Renter accepts" ? "success" : "warning"} data-testid="approval-line-answer">{answer}</Badge></span> : null}
                  </span>
                  <span className="shrink-0 font-medium tabular-nums text-zinc-900">{formatExactCents(line.amountCents)}</span>
                </li>
              );
            })}
          </ol>
        ) : null}

        <RenterAnswer booking={booking} kind={plan.kind} />

        <div className="rounded-lg bg-zinc-900 px-4 py-4 text-white">
          <p className="text-2xl font-semibold tabular-nums" data-testid="approval-money">{money}</p>
          <p className="mt-1 text-sm text-zinc-300">On the {formatExactCents(heldCents(booking))} PayPal hold. The amounts are added up by code from the lines above.</p>
        </div>

        <p className="flex items-start gap-2 text-sm text-zinc-700">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
          <span>
            <span className="font-medium text-zinc-900">Why the Guard stopped here: </span>
            <span data-testid="approval-guard-reason">{approval.reason}</span>
          </span>
        </p>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" icon={<X className="size-4" />} loading={busy === "denied"} disabled={!!busy} onClick={() => decide("denied")} data-testid="decline-button">
            Decline
          </Button>
          <Button variant="success" icon={<Check className="size-4" />} loading={busy === "approved"} disabled={!!busy} onClick={() => decide("approved")} data-testid="approve-button">
            {action ? `Approve: ${action}` : "Approve"}
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
