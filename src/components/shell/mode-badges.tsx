"use client";

import { ChevronDown, FlaskConical, Landmark, Sparkles } from "lucide-react";
import { useKit } from "../kit/kit-provider";
import { cn } from "../ui/cn";

/**
 * One small chip for the setup, e.g. "Sandbox · live Claude". It opens to the details: PayPal
 * mode, the AI models, and today's AI spend against the cap. Dev detail, kept out of the way.
 */
export function ModeBadges({ className, vertical }: { className?: string; vertical?: boolean }) {
  const { status } = useKit();
  if (!status) return null;
  const { paypal, ai } = status;
  const sandbox = paypal.mode === "sandbox";
  const live = ai.mode === "live";
  const pct = ai.budget.capUsd ? Math.min(100, (ai.budget.spentUsd / ai.budget.capUsd) * 100) : 0;
  const row = "flex items-center gap-1.5";
  return (
    <details className={cn("group relative text-xs", className)} data-testid="mode-badges">
      <summary
        className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-full bg-zinc-100 px-2.5 py-1 font-medium text-zinc-600 ring-1 ring-inset ring-zinc-200 hover:text-zinc-900 [&::-webkit-details-marker]:hidden"
        data-testid="mode-chip"
      >
        {sandbox ? <Landmark className="size-3.5" aria-hidden /> : <FlaskConical className="size-3.5" aria-hidden />}
        {sandbox ? "Sandbox" : "PayPal mock"} · {live ? "live Claude" : "AI mock"}
        <ChevronDown className="size-3 transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <div
        className={cn(
          "z-40 mt-2 w-60 space-y-1.5 rounded-lg border border-zinc-200 bg-white p-3 text-zinc-600 shadow-lg",
          vertical ? "absolute bottom-full mb-2" : "absolute left-0 top-full",
        )}
        data-testid="mode-details"
      >
        <p className={row}>
          {sandbox ? <Landmark className="size-3.5" aria-hidden /> : <FlaskConical className="size-3.5" aria-hidden />}
          {sandbox ? "PayPal sandbox" : "PayPal mock"}
        </p>
        {(live ? [`Photos: ${ai.models.smart}`, `Agent: ${ai.models.default}`] : ["AI mock"]).map((label) => (
          <p key={label} className={row}>
            <Sparkles className="size-3.5" aria-hidden />
            {label}
          </p>
        ))}
        {live ? (
          <p className={row} title="Today's AI spend vs. AI_DAILY_CAP_USD">
            <span className="h-1.5 w-12 overflow-hidden rounded-full bg-zinc-200">
              <span className="block h-full rounded-full bg-violet-500" style={{ width: `${pct}%` }} />
            </span>
            ${ai.budget.spentUsd < 0.01 ? ai.budget.spentUsd.toFixed(4) : ai.budget.spentUsd.toFixed(2)} / ${ai.budget.capUsd.toFixed(2)} AI today
          </p>
        ) : null}
        <p className="text-[11px] leading-relaxed text-zinc-400">Sandbox only. No live PayPal calls are possible from this app.</p>
      </div>
    </details>
  );
}
