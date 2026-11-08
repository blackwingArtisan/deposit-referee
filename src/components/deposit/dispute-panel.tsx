"use client";

import { useEffect, useRef } from "react";
import { FileDown, RefreshCw, Scale, Send } from "lucide-react";
import { ApprovalPrompt } from "@/components/agent/approval-prompt";
import { useKit } from "@/components/kit/kit-provider";
import { Badge, Button, Card, CardBody, CardHeader } from "@/components/ui";
import { formatExactCents, localTime } from "@/lib/deposit/rules";
import type { BookingDispute, BookingView } from "@/lib/deposit/types";

const REASON: Record<string, string> = {
  MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED: "Not as described",
  MERCHANDISE_OR_SERVICE_NOT_RECEIVED: "Not received",
  UNAUTHORISED: "Payment not authorized",
  INCORRECT_AMOUNT: "Wrong amount",
  DUPLICATE_TRANSACTION: "Charged twice",
  CREDIT_NOT_PROCESSED: "Refund not received",
};

function statusWords(d: BookingDispute): { label: string; tone: "warning" | "info" | "success" | "neutral" } {
  if (d.status === "WAITING_FOR_SELLER_RESPONSE") return { label: "PayPal is waiting for your evidence", tone: "warning" };
  if (d.status === "UNDER_REVIEW") return { label: "PayPal is reviewing", tone: "info" };
  if (d.status === "RESOLVED") {
    if (d.outcome === "RESOLVED_SELLER_FAVOUR") return { label: "Resolved: you keep the charge", tone: "success" };
    if (d.outcome === "RESOLVED_BUYER_FAVOUR") return { label: "Resolved: PayPal refunded the renter", tone: "neutral" };
    return { label: "Resolved", tone: "neutral" };
  }
  return { label: d.status.replace(/_/g, " ").toLowerCase(), tone: "neutral" };
}

/** Shown once something is charged: the evidence pack to download and, if the renter disputes, the case. */
export function DisputePanel({ booking, busy, act, onDecided }: { booking: BookingView; busy: string | null; act: (name: string, failTitle: string, action: () => Promise<BookingView>) => Promise<void>; onDecided: () => void }) {
  const { kitFetch } = useKit();
  // The approval card opens where the host can't see it on a long page, so bring it into view.
  const gate = useRef<HTMLDivElement>(null);
  const approvalId = booking.disputeApproval?.id;
  useEffect(() => {
    if (approvalId) gate.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [approvalId]);
  const charged = !!(booking.settlement?.captureId || booking.partCapture?.captureId);
  if (!charged) return null;
  const d = booking.dispute;
  const evidence = d?.evidence;
  const waiting = !!evidence && !evidence.submittedAt && !evidence.error;
  const download = (
    <a href={`/api/bookings/${booking.id}/evidence`} download className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 hover:underline" data-testid="evidence-download">
      <FileDown className="size-4" /> Download the evidence pack (PDF)
    </a>
  );

  if (!d) {
    return (
      <Card data-testid="evidence-panel">
        <CardBody className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-zinc-600">The photos with each finding boxed, the price-table rows, the renter&rsquo;s answer and the PayPal ids, in one file. If the renter disputes the charge with PayPal, this is what the app sends.</p>
          {download}
        </CardBody>
      </Card>
    );
  }

  const status = statusWords(d);
  return (
    <Card data-testid="dispute-panel">
      <CardHeader
        title={
          <span className="inline-flex items-center gap-2">
            <Scale className="size-4 text-amber-600" /> The renter opened a PayPal dispute
          </span>
        }
        description={`${REASON[d.reason] ?? d.reason.replace(/_/g, " ").toLowerCase()}, ${formatExactCents(d.amountCents)} of the charge`}
        action={<Badge tone={status.tone} dot>{status.label}</Badge>}
      />
      <CardBody className="space-y-3">
        <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          <div>
            <dt className="inline text-zinc-500">PayPal case </dt>
            <dd className="inline font-mono text-zinc-900" data-testid="dispute-id">{d.disputeId}</dd>
          </div>
          <div>
            <dt className="inline text-zinc-500">On capture </dt>
            <dd className="inline font-mono text-zinc-900">{d.captureId}</dd>
          </div>
          {d.responseDueAt ? (
            <div>
              <dt className="inline text-zinc-500">Answer PayPal by </dt>
              <dd className="inline text-zinc-900">{localTime(d.responseDueAt)}</dd>
            </div>
          ) : null}
          <div>
            <dt className="inline text-zinc-500">Read from PayPal </dt>
            <dd className="inline text-zinc-900" data-testid="dispute-read-at">{localTime(d.readAt)}</dd>
          </div>
        </dl>
        {d.buyerMessage ? <blockquote className="border-l-2 border-zinc-200 pl-3 text-sm text-zinc-700" data-testid="dispute-message">&ldquo;{d.buyerMessage}&rdquo;</blockquote> : null}

        {evidence?.submittedAt ? (
          <p className="text-sm text-emerald-800" data-testid="evidence-sent">
            Sent {evidence.fileName} to PayPal on {localTime(evidence.submittedAt)}.
          </p>
        ) : null}
        {evidence?.error ? (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800" data-testid="evidence-error">
            {evidence.error}
          </p>
        ) : null}

        {booking.disputeApproval ? (
          <div ref={gate}>
            <ApprovalPrompt approvalId={booking.disputeApproval.id} summary={booking.disputeApproval.summary} reason="Your approval step. Nothing goes to PayPal until you approve." onDecided={onDecided} />
          </div>
        ) : waiting ? (
          <p className="text-sm text-zinc-600">Checking the case with PayPal.</p>
        ) : null}

        <div className="flex flex-wrap items-center gap-3 pt-1">
          {d.status === "WAITING_FOR_SELLER_RESPONSE" && !evidence?.submittedAt && !waiting ? (
            <Button icon={<Send className="size-4" />} loading={busy === "evidence"} disabled={!!busy} onClick={() => act("evidence", "Could not send the evidence", () => kitFetch<BookingView>(`/api/bookings/${booking.id}/dispute/evidence`, { method: "POST" }))} data-testid="send-evidence">
              Send the evidence pack to PayPal
            </Button>
          ) : null}
          <Button variant="secondary" size="sm" icon={<RefreshCw className="size-4" />} loading={busy === "dispute"} disabled={!!busy} onClick={() => act("dispute", "Could not read the dispute", () => kitFetch<BookingView>(`/api/bookings/${booking.id}/dispute`, { method: "POST" }))} data-testid="refresh-dispute">
            Read it again from PayPal
          </Button>
          {download}
        </div>
      </CardBody>
    </Card>
  );
}
