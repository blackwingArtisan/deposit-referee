"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  Ban,
  Bot,
  BrainCircuit,
  Check,
  ChevronDown,
  CircleDot,
  Clock,
  Landmark,
  Loader2,
  MessageSquareText,
  ShieldCheck,
  Sparkles,
  Webhook,
  Wrench,
  X,
} from "lucide-react";
import type { TimelineStatus, TimelineStep } from "@/lib/events/types";
import { MoneyBadge } from "../money-badge";
import { cn } from "../ui/cn";
import { EmptyState } from "../ui/empty-state";
import { ApprovalPrompt } from "./approval-prompt";

const KIND_ICON = {
  run: Bot,
  "agent.message": MessageSquareText,
  "agent.thinking": BrainCircuit,
  tool: Wrench,
  paypal: Landmark,
  approval: ShieldCheck,
  guard: ShieldCheck,
  webhook: Webhook,
  ai: Sparkles,
  info: CircleDot,
} as const;

const STATUS: Record<TimelineStatus, { label: string; className: string; icon: ReactNode }> = {
  pending: { label: "Pending", className: "bg-zinc-100 text-zinc-600", icon: <Clock className="size-3.5" /> },
  running: { label: "Running", className: "bg-sky-50 text-sky-700", icon: <Loader2 className="size-3.5 animate-spin" /> },
  awaiting_approval: { label: "Awaiting approval", className: "bg-amber-100 text-amber-800", icon: <Clock className="size-3.5" /> },
  succeeded: { label: "Done", className: "bg-emerald-50 text-emerald-700", icon: <Check className="size-3.5" /> },
  failed: { label: "Failed", className: "bg-red-50 text-red-700", icon: <X className="size-3.5" /> },
  denied: { label: "Blocked", className: "bg-red-50 text-red-700", icon: <Ban className="size-3.5" /> },
  skipped: { label: "Skipped", className: "bg-zinc-100 text-zinc-500", icon: <Clock className="size-3.5" /> },
  info: { label: "", className: "", icon: null },
};

const RAIL: Record<TimelineStatus, string> = {
  pending: "bg-zinc-100 text-zinc-500 ring-zinc-200",
  running: "bg-sky-50 text-sky-600 ring-sky-200",
  awaiting_approval: "bg-amber-50 text-amber-600 ring-amber-300",
  succeeded: "bg-emerald-50 text-emerald-600 ring-emerald-200",
  failed: "bg-red-50 text-red-600 ring-red-200",
  denied: "bg-red-50 text-red-600 ring-red-200",
  skipped: "bg-zinc-50 text-zinc-400 ring-zinc-200",
  info: "bg-brand-50 text-brand-600 ring-brand-200",
};

function isQuiet(step: TimelineStep) {
  return Boolean((step.data as { quiet?: boolean } | undefined)?.quiet) && step.status !== "failed" && step.status !== "awaiting_approval";
}

function time(ts: string) {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function Meta({ step }: { step: TimelineStep }) {
  const p = step.paypal;
  const parts: ReactNode[] = [];
  if (p) {
    parts.push(
      <span key="m" className="min-w-0 break-all font-mono">
        {p.method} {p.path}
      </span>,
    );
    if (p.httpStatus) parts.push(<span key="s">HTTP {p.httpStatus}</span>);
    if (p.durationMs !== undefined) parts.push(<span key="d">{p.durationMs} ms</span>);
    if (p.debugId) parts.push(<span key="dbg" className="min-w-0 break-all font-mono">debug_id {p.debugId}</span>);
    parts.push(
      <span key="mode" className={cn("rounded px-1.5 font-medium", p.mode === "sandbox" ? "bg-brand-50 text-brand-700" : "bg-zinc-100 text-zinc-600")}>
        {p.mode === "sandbox" ? "PayPal sandbox" : "mock PayPal"}
      </span>,
    );
  } else if (step.subtitle) {
    parts.push(<span key="sub">{step.subtitle}</span>);
  }
  if (!parts.length) return null;
  return <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-zinc-500">{parts}</div>;
}

function Details({ step }: { step: TimelineStep }) {
  const [open, setOpen] = useState(false);
  const payload = step.tool ? { input: step.tool.input, output: step.tool.output } : (step.data as { request?: unknown; response?: unknown } | undefined);
  if (!payload || (payload as { request?: unknown; input?: unknown }).request === undefined && (payload as { input?: unknown }).input === undefined && (payload as { response?: unknown }).response === undefined) return null;
  return (
    <div className="mt-2">
      <button onClick={() => setOpen((o) => !o)} className="inline-flex items-center gap-1 text-xs font-medium text-zinc-500 hover:text-zinc-800">
        <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
        {open ? "Hide details" : "Details"}
      </button>
      {open ? (
        <pre className="scrollbar-thin mt-2 max-h-64 overflow-auto rounded-lg bg-zinc-950 p-3 text-[11px] leading-relaxed text-zinc-100">{JSON.stringify(payload, null, 2)}</pre>
      ) : null}
    </div>
  );
}

function CompactRow({ step }: { step: TimelineStep }) {
  const Icon = KIND_ICON[step.kind] ?? CircleDot;
  return (
    <li className="relative flex animate-fade-in items-center gap-3 py-1 pl-1 text-xs text-zinc-500" data-paypal-call={step.paypal ? "" : undefined}>
      <span className="z-10 flex size-6 shrink-0 items-center justify-center rounded-full bg-white ring-1 ring-zinc-200">
        {step.status === "running" ? <Loader2 className="size-3 animate-spin" /> : <Icon className="size-3" />}
      </span>
      <span className="truncate">
        <span className="font-medium text-zinc-600">{step.title}</span>
        {step.paypal ? <span className="ml-2 font-mono">{step.paypal.method} {step.paypal.path}</span> : step.detail ? <span className="ml-2">{step.detail.slice(0, 140)}</span> : null}
      </span>
      <span className="ml-auto shrink-0 tabular-nums text-zinc-400">{time(step.updatedAt)}</span>
    </li>
  );
}

function StepCard({ step, onApprovalDecided }: { step: TimelineStep; onApprovalDecided?: () => void }) {
  const Icon = KIND_ICON[step.kind] ?? CircleDot;
  const status = STATUS[step.status];
  const isMessage = step.kind === "agent.message";
  const awaiting = step.status === "awaiting_approval" && step.approval?.state === "pending";

  return (
    <li className="relative flex animate-slide-up gap-3 pb-4" data-testid="timeline-step" data-kind={step.kind} data-status={step.status} data-paypal-call={step.paypal ? "" : undefined}>
      <span className={cn("z-10 flex size-9 shrink-0 items-center justify-center rounded-full ring-1", RAIL[step.status])}>
        <Icon className="size-4" />
      </span>
      <div
        className={cn(
          "min-w-0 flex-1 rounded-xl border px-4 py-3",
          isMessage ? "border-brand-100 bg-brand-50/60" : "border-zinc-200 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04)]",
          awaiting && "border-amber-300",
          (step.status === "failed" || step.status === "denied") && "border-red-200",
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className={cn("font-semibold text-zinc-900", isMessage ? "text-sm text-brand-800" : "text-[15px]")}>{step.title}</p>
              {status.label ? (
                <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium", status.className)}>
                  {status.icon}
                  {status.label}
                </span>
              ) : null}
              {step.approval && step.approval.state !== "pending" ? (
                <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium", step.approval.state === "approved" ? "bg-emerald-50 text-emerald-700" : "bg-zinc-100 text-zinc-600")}>
                  <ShieldCheck className="size-3.5" />
                  {step.approval.state === "approved" ? `Approved${step.approval.decidedBy ? ` by ${step.approval.decidedBy}` : ""}` : step.approval.state === "expired" ? "Approval expired" : "Declined"}
                </span>
              ) : null}
            </div>
            {!isMessage ? <Meta step={step} /> : null}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            {step.amount ? <MoneyBadge amount={step.amount} direction={step.direction ?? "neutral"} /> : null}
            <span className="text-[11px] tabular-nums text-zinc-400">{time(step.updatedAt)}</span>
          </div>
        </div>
        {step.detail ? <p className={cn("mt-1.5 whitespace-pre-wrap break-words text-sm", isMessage ? "text-zinc-800" : "text-zinc-600")}>{step.detail}</p> : null}
        {step.error && step.status !== "denied" ? (
          <div className="mt-2 flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <span className="break-words">
              <span className="font-semibold">{step.error.issue ?? step.error.name}</span>: {step.error.message}
              {step.error.debugId ? <span className="ml-1 font-mono text-xs">(debug_id {step.error.debugId})</span> : null}
            </span>
          </div>
        ) : null}
        {awaiting && step.approval ? <ApprovalPrompt className="mt-3" approvalId={step.approval.id} summary={step.title} reason={step.approval.reason} amount={step.amount} onDecided={onApprovalDecided} /> : null}
        {!isMessage ? <Details step={step} /> : null}
      </div>
    </li>
  );
}

/**
 * Live cards for every agent step, tool call, approval, PayPal call and webhook.
 *   const { steps } = useTimeline();  <ToolCallTimeline steps={steps} />
 */
export function ToolCallTimeline({
  steps,
  showQuiet = true,
  autoScroll = true,
  emptyTitle = "Nothing yet",
  emptyDescription = "Agent steps, PayPal calls and webhooks will appear here as they happen.",
  className,
}: {
  steps: TimelineStep[];
  showQuiet?: boolean;
  autoScroll?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const visible = steps.filter((s) => showQuiet || !isQuiet(s));
  const last = visible.at(-1);
  useEffect(() => {
    const el = ref.current;
    if (!autoScroll || !el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [visible.length, last?.updatedAt, autoScroll]);

  if (!visible.length) return <EmptyState title={emptyTitle} description={emptyDescription} icon={<Bot className="size-5" />} className={className} />;
  return (
    <div ref={ref} className={cn("scrollbar-thin overflow-y-auto pr-1", className)} data-testid="tool-call-timeline">
      <ol className="relative before:absolute before:bottom-4 before:left-[17px] before:top-2 before:w-px before:bg-zinc-200">
        {visible.map((s) => (isQuiet(s) ? <CompactRow key={s.stepId} step={s} /> : <StepCard key={s.stepId} step={s} />))}
      </ol>
    </div>
  );
}
