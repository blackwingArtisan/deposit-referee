import { formatExactCents } from "@/lib/deposit/rules";
import type { DamageReview } from "@/lib/deposit/types";

/** The AI's itemized findings. The numbers match the red boxes on the photo. */
export function DamageItems({ review }: { review: DamageReview }) {
  if (!review.items.length) return <p className="text-sm text-zinc-700">No new damage found.</p>;
  return (
    <ol className="space-y-2.5" data-testid="damage-items">
      {review.items.map((item, i) => (
        <li key={i} className="flex gap-3 text-sm">
          <span className="flex size-5 shrink-0 items-center justify-center bg-red-600 text-xs font-semibold text-white" aria-hidden>{i + 1}</span>
          <span className="min-w-0 flex-1 text-zinc-700">{item.description}</span>
          <span className="shrink-0 font-medium tabular-nums text-zinc-900">{formatExactCents(item.chargeCents)}</span>
        </li>
      ))}
    </ol>
  );
}
