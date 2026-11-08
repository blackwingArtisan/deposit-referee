import { formatExactCents } from "@/lib/deposit/rules";

/** The itemized lines. The numbers match the red boxes on the photo. */
export function DamageItems({ lines }: { lines: { description: string; amountCents: number; note?: string }[] }) {
  if (!lines.length) return <p className="text-sm text-zinc-700">No new damage found.</p>;
  return (
    <ol className="space-y-2.5" data-testid="damage-items">
      {lines.map((line, i) => (
        <li key={i} className="flex gap-3 text-sm">
          <span className="flex size-5 shrink-0 items-center justify-center bg-red-600 text-xs font-semibold text-white" aria-hidden>{i + 1}</span>
          <span className="min-w-0 flex-1 text-zinc-700">
            {line.description}
            {line.note ? <span className="mt-0.5 block text-xs text-zinc-500">{line.note}</span> : null}
          </span>
          <span className="shrink-0 font-medium tabular-nums text-zinc-900">{formatExactCents(line.amountCents)}</span>
        </li>
      ))}
    </ol>
  );
}
