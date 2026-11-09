/**
 * How Claude's second look changes a contested line. The model only names a verdict (and, for
 * "smaller", a size); this code turns it into an amount, and the amount can only stay or fall.
 * Shared by server and browser, so no Node imports.
 */
import { DAMAGE_SIZES, priceOf, type DamageSize, type PriceRow } from "./prices";
import type { ChargeLine, SecondLookLine, SecondLookVerdict } from "./types";

export const VERDICTS = ["new", "already_there", "smaller", "unsure"] as const satisfies readonly SecondLookVerdict[];

/** One size down: large -> medium -> small. Small has nothing below it. */
function sizeBelow(size: DamageSize): DamageSize | undefined {
  const i = DAMAGE_SIZES.indexOf(size);
  return i > 0 ? DAMAGE_SIZES[i - 1] : undefined;
}

/**
 * The line's amount after the second look, and the price row it now comes from.
 * - already_there: the renter's evidence shows it before the stay, so it isn't charged.
 * - unsure: a contested line Claude can't stand behind is never charged (the faint-mark rule).
 * - smaller: the price-table row for the smaller size, only if that is lower.
 * - new: unchanged.
 * Whatever the verdict, the result is never above the line as it stands.
 */
export function counterAmount(line: Pick<ChargeLine, "amountCents" | "price">, verdict: SecondLookVerdict, newSize?: DamageSize): { cents: number; price?: PriceRow } {
  const current = Math.max(0, line.amountCents);
  if (verdict === "already_there" || verdict === "unsure") return { cents: 0 };
  if (verdict !== "smaller" || !line.price) return { cents: current, price: line.price };
  const below = sizeBelow(line.price.size);
  // The model's size counts only if it really is smaller than the line's; otherwise one size down.
  const size = newSize && DAMAGE_SIZES.indexOf(newSize) < DAMAGE_SIZES.indexOf(line.price.size) ? newSize : below;
  if (!size) return { cents: current, price: line.price };
  const row: PriceRow = { type: line.price.type, size };
  const cents = priceOf(row);
  return cents < current ? { cents, price: row } : { cents: current, price: line.price };
}

/** A dropped line: the second look took it to $0. Its box shows grey. */
export const isDropped = (line: Pick<SecondLookLine, "toCents">) => line.toCents === 0;

/** The lines the renter contested: every line, unless they accepted some. */
export function contestedLines(lines: ChargeLine[], acceptedLineIds?: string[]): ChargeLine[] {
  return acceptedLineIds?.length ? lines.filter((line) => !acceptedLineIds.includes(line.id)) : lines;
}

/** What a verdict means, in words both sides read. */
export function verdictLabel(line: Pick<SecondLookLine, "verdict" | "withPhoto" | "fromCents" | "toCents">): string {
  if (line.verdict === "already_there") return line.withPhoto ? "Already there: seen in the renter's photo" : "Already there";
  if (line.verdict === "unsure") return line.withPhoto ? "Claude can't stand behind it after the renter's photo" : "Claude can't stand behind it";
  if (line.verdict === "smaller") return line.toCents < line.fromCents ? "Smaller than first priced" : "Smaller, but no lower price row";
  return "Still new since check-in";
}
