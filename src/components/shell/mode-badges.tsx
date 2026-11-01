"use client";

import { FlaskConical, Landmark, Sparkles } from "lucide-react";
import { useKit } from "../kit/kit-provider";
import { cn } from "../ui/cn";

/** Shows PayPal mode (mock/sandbox), AI mode/model and today's AI spend against the cap. */
export function ModeBadges({ className, vertical }: { className?: string; vertical?: boolean }) {
  const { status } = useKit();
  if (!status) return null;
  const { paypal, ai } = status;
  const pct = ai.budget.capUsd ? Math.min(100, (ai.budget.spentUsd / ai.budget.capUsd) * 100) : 0;
  return (
    <div className={cn("flex gap-2 text-xs", vertical ? "flex-col" : "flex-wrap items-center", className)} data-testid="mode-badges">
      <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium ring-1 ring-inset", paypal.mode === "sandbox" ? "bg-brand-50 text-brand-700 ring-brand-200" : "bg-zinc-100 text-zinc-700 ring-zinc-200")}>
        {paypal.mode === "sandbox" ? <Landmark className="size-3.5" /> : <FlaskConical className="size-3.5" />}
        {paypal.mode === "sandbox" ? "PayPal sandbox" : "PayPal mock"}
      </span>
      <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium ring-1 ring-inset", ai.mode === "live" ? "bg-violet-50 text-violet-700 ring-violet-200" : "bg-zinc-100 text-zinc-700 ring-zinc-200")}>
        <Sparkles className="size-3.5" />
        {ai.mode === "live" ? ai.models.default : "AI mock"}
      </span>
      {ai.mode === "live" ? (
        <span className="inline-flex items-center gap-2 rounded-full bg-white px-2.5 py-1 text-zinc-600 ring-1 ring-inset ring-zinc-200" title="Today's AI spend vs. AI_DAILY_CAP_USD">
          <span className="h-1.5 w-12 overflow-hidden rounded-full bg-zinc-200">
            <span className="block h-full rounded-full bg-violet-500" style={{ width: `${pct}%` }} />
          </span>
          ${ai.budget.spentUsd < 0.01 ? ai.budget.spentUsd.toFixed(4) : ai.budget.spentUsd.toFixed(2)} / ${ai.budget.capUsd.toFixed(2)}
        </span>
      ) : null}
    </div>
  );
}
