"use client";

import { useEffect, useState } from "react";
import { Check, CircleAlert, Loader2 } from "lucide-react";
import type { TimelineEvent } from "@/lib/events/types";
import { cn } from "@/components/ui";

type StepState = "done" | "active" | "waiting" | "failed";

export interface CompareRun {
  startedAt: number;
  /** When the response came back. */
  finishedAt?: number;
  error?: string;
}

/** Latest status per step, for this booking's events since the compare started. */
function latest(events: TimelineEvent[], bookingId: string, since: number) {
  const steps = new Map<string, TimelineEvent>();
  for (const e of events) if (e.bookingId === bookingId && Date.parse(e.ts) >= since - 1_000) steps.set(e.stepId, e);
  return [...steps.values()];
}

/**
 * What happens between "Compare photos" and the proposal, as a live list: never a bare spinner.
 * Steps move on as the server's own events arrive, and the response settles them all.
 */
export function WaitStory({ run, events, bookingId }: { run: CompareRun; events: TimelineEvent[]; bookingId: string }) {
  const [now, setNow] = useState(() => Date.now());
  const finished = run.finishedAt !== undefined;
  useEffect(() => {
    if (finished) return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [finished]);

  const end = run.finishedAt ?? now;
  const seen = latest(events, bookingId, run.startedAt);
  const ai = seen.filter((e) => e.kind === "ai");
  const aiDoneAt = ai.length && ai.every((e) => e.status !== "running") ? Math.max(...ai.map((e) => Date.parse(e.ts))) : undefined;
  const agent = seen.find((e) => e.kind === "run");
  const compared = finished || aiDoneAt !== undefined || !!agent;
  const comparedAt = Math.min(end, aiDoneAt ?? (agent ? Date.parse(agent.ts) : end));
  const seconds = (to: number) => Math.max(0, Math.floor((to - run.startedAt) / 1000));
  const failed = !!run.error;

  const steps: { key: string; label: string; state: StepState; note?: string }[] = [
    { key: "hold", label: "Hold confirmed on PayPal", state: "done" },
    { key: "photos", label: "Check-in and check-out photos in", state: "done" },
    {
      key: "compare",
      label: compared ? "Claude compared the photos" : "Claude is comparing the photos",
      state: compared ? "done" : failed ? "failed" : "active",
      note: `${seconds(compared ? comparedAt : end)} s`,
    },
    {
      key: "price",
      label: "Each finding priced from the price table",
      state: compared && (finished || !!agent) ? "done" : compared && failed ? "failed" : compared ? "active" : "waiting",
      note: "amounts set by code, not the AI",
    },
    {
      key: "proposal",
      label: finished && !failed ? "Proposal ready" : "Agent writing the proposal",
      state: finished && !failed ? "done" : failed && compared ? "failed" : agent ? "active" : "waiting",
      note: finished && !failed ? `in ${seconds(end)} s` : undefined,
    },
  ];

  return (
    <div className="rounded-lg border border-zinc-200 bg-zinc-50/60 px-4 py-3" data-testid="wait-story">
      <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
        {failed ? "Stopped" : finished ? "Done" : "Working"} · <span className="tabular-nums" data-testid="wait-elapsed">{seconds(end)} s</span>
      </p>
      <ol className="mt-2 space-y-1.5">
        {steps.map((step) => (
          <li key={step.key} className="flex items-center gap-2.5 text-sm" data-testid={`wait-step-${step.key}`} data-state={step.state}>
            <span
              className={cn(
                "flex size-5 shrink-0 items-center justify-center rounded-full",
                step.state === "done" && "bg-emerald-100 text-emerald-700",
                step.state === "active" && "bg-brand-50 text-brand",
                step.state === "waiting" && "border border-zinc-300 bg-white",
                step.state === "failed" && "bg-red-100 text-red-700",
              )}
              aria-hidden
            >
              {step.state === "done" ? <Check className="size-3.5" /> : step.state === "active" ? <Loader2 className="size-3.5 animate-spin" /> : step.state === "failed" ? <CircleAlert className="size-3.5" /> : null}
            </span>
            <span className={cn("min-w-0", step.state === "waiting" ? "text-zinc-400" : "text-zinc-800", step.state === "active" && "font-medium")}>
              {step.label}
              {step.note && step.state !== "waiting" ? <span className="ml-1.5 tabular-nums text-zinc-500" data-testid={`wait-note-${step.key}`}>· {step.note}</span> : null}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
