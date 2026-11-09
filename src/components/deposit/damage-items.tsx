import { Table2 } from "lucide-react";
import { DAMAGE_SIZES, DAMAGE_TYPES, PRICE_TABLE, rowLabel, SIZE_LABEL, TYPE_LABEL, type PriceRow } from "@/lib/deposit/prices";
import { formatCents, formatExactCents } from "@/lib/deposit/rules";
import type { DamageBox, FindingPhoto } from "@/lib/deposit/types";
import { splitDescription } from "./line-card";
import { findingPhotoLabel } from "./photo-frame";
import { Why } from "./why";

/** Where a line's amount came from, as a chip, so either side can check it against the table. */
export function PriceSource({ price, className = "" }: { price?: PriceRow; className?: string }) {
  if (!price) return null;
  return (
    <span className={`flex w-fit items-center gap-1.5 rounded-full bg-zinc-100 px-2.5 py-0.5 text-sm text-zinc-700 ${className}`} data-testid="price-row" title="From the fixed price table, not the AI">
      <Table2 className="size-3.5 shrink-0 text-zinc-500" aria-hidden />
      <span>
        <span className="sr-only">Price table: </span>
        {rowLabel(price)}, <span className="font-semibold tabular-nums text-zinc-900">{formatCents(PRICE_TABLE[price.type][price.size])}</span>
      </span>
    </span>
  );
}

/** The itemized lines. The numbers match the red boxes on the photo. */
/**
 * The priced lines. `compact` (the host's page) keeps one line per item, the first sentence and its
 * price row; the rest of the description and which photo it was seen in fold behind "Why?".
 */
export function DamageItems({ lines, compact = false }: { lines: { description: string; amountCents: number; note?: string; price?: PriceRow; box?: DamageBox | null; photo?: FindingPhoto }[]; compact?: boolean }) {
  if (!lines.length) return <p className="text-sm text-zinc-700">No new damage found.</p>;
  return (
    <ol className="space-y-2.5" data-testid="damage-items">
      {lines.map((line, i) => (
        <li key={i} className="flex gap-3 text-sm">
          <span className="flex size-5 shrink-0 items-center justify-center bg-red-600 text-xs font-semibold text-white" aria-hidden>{i + 1}</span>
          <div className="min-w-0 flex-1 text-zinc-700">
            {compact ? <CompactLine line={line} /> : (
              <>
                {line.description}
                <PriceSource price={line.price} className="mt-0.5" />
                {line.box ? <span className="mt-0.5 block text-xs text-zinc-500" data-testid="finding-photo">Seen in {findingPhotoLabel(line.photo)}</span> : null}
                {line.note ? <span className="mt-0.5 block text-xs text-zinc-500">{line.note}</span> : null}
              </>
            )}
          </div>
          <span className="shrink-0 font-medium tabular-nums text-zinc-900">{formatExactCents(line.amountCents)}</span>
        </li>
      ))}
    </ol>
  );
}

function CompactLine({ line }: { line: { description: string; note?: string; price?: PriceRow; box?: DamageBox | null; photo?: FindingPhoto } }) {
  const { title, rest } = splitDescription(line.description);
  return (
    <>
      <span className="block truncate font-medium text-zinc-900" data-testid="damage-item-title">{title}</span>
      <PriceSource price={line.price} className="mt-0.5" />
      {rest || line.box || line.note ? (
        <Why testId="damage-item-why" className="mt-0.5">
          {rest ? <p>{rest}</p> : null}
          {line.box ? <p className="text-xs text-zinc-500" data-testid="finding-photo">Seen in {findingPhotoLabel(line.photo)}</p> : null}
          {line.note ? <p className="text-xs text-zinc-500">{line.note}</p> : null}
        </Why>
      ) : null}
    </>
  );
}

/** The whole published table. The AI names the kind and size; this decides the amount. */
export function PriceTable({ highlight = [] }: { highlight?: PriceRow[] }) {
  const lit = (type: string, size: string) => highlight.some((row) => row.type === type && row.size === size);
  return (
    <details className="text-sm" data-testid="price-table">
      <summary className="cursor-pointer text-zinc-600 hover:text-zinc-900">Price table</summary>
      <p className="mt-2 text-sm text-zinc-600">The AI only names the kind of damage and its size. The amount comes from this table, so the same scratch always costs the same. These are starting figures for a typical repair, not quotes; the host can change a line and tells the renter why.</p>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[22rem] text-left text-sm">
          <thead>
            <tr className="text-zinc-500">
              <th className="py-1 pr-2 font-medium">Damage</th>
              {DAMAGE_SIZES.map((size) => (
                <th key={size} className="px-2 py-1 text-right font-medium" title={SIZE_LABEL[size]}>{size[0].toUpperCase() + size.slice(1)}</th>
              ))}
            </tr>
          </thead>
          <tbody className="tabular-nums text-zinc-800">
            {DAMAGE_TYPES.map((type) => (
              <tr key={type} className="border-t border-zinc-100">
                <td className="py-1 pr-2">{TYPE_LABEL[type]}</td>
                {DAMAGE_SIZES.map((size) => (
                  <td key={size} className={`px-2 py-1 text-right ${lit(type, size) ? "bg-red-50 font-semibold text-red-800" : ""}`}>{formatCents(PRICE_TABLE[type][size])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-1 text-sm text-zinc-600">Small: coin-sized. Medium: up to a hand&rsquo;s length. Large: longer than a hand, or a whole board or panel.</p>
    </details>
  );
}
