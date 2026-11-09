/**
 * How Claude's second look changes a contested line. The model only names a verdict (and, for
 * "smaller", a size); this code turns it into an amount, and the amount can only stay or fall.
 * Shared by server and browser, so no Node imports.
 */
import { DAMAGE_SIZES, priceOf, type DamageSize, type PriceRow } from "./prices";
import type { ChargeLine, PhotoTiming, SecondLookLine, SecondLookVerdict } from "./types";

export const VERDICTS = ["new", "already_there", "smaller", "unsure"] as const satisfies readonly SecondLookVerdict[];

/** One size down: large -> medium -> small. Small has nothing below it. */
function sizeBelow(size: DamageSize): DamageSize | undefined {
  const i = DAMAGE_SIZES.indexOf(size);
  return i > 0 ? DAMAGE_SIZES[i - 1] : undefined;
}

/** When the renter's photo was taken, against the stay: from the host's check-in to check-out. */
export function photoTiming(takenAt: string | undefined, stay: { checkInAt?: string; checkOutAt?: string }): PhotoTiming {
  if (!takenAt) return "undated";
  const t = Date.parse(takenAt);
  if (stay.checkOutAt && t > Date.parse(stay.checkOutAt)) return "after_check_out";
  if (stay.checkInAt && t < Date.parse(stay.checkInAt)) return "before_check_in";
  return "during_stay";
}

/**
 * The line's amount after the second look, and the price row it now comes from.
 * - A renter's photo dated after check-out can't lower the line, whatever the verdict: it can't
 *   show the spot before the stay.
 * - already_there: the renter's evidence shows it before the stay, so it isn't charged.
 * - unsure: Claude can't tell, so the line stays as it is, flagged for the host to keep or drop.
 * - smaller: the price-table row for the smaller size, only if that is lower.
 * - new: unchanged.
 * Whatever the verdict, the result is never above the line as it stands.
 */
export function counterAmount(line: Pick<ChargeLine, "amountCents" | "price">, verdict: SecondLookVerdict, newSize?: DamageSize, timing: PhotoTiming = "undated"): { cents: number; price?: PriceRow; flagged?: true } {
  const current = Math.max(0, line.amountCents);
  if (timing === "after_check_out") return { cents: current, price: line.price };
  if (verdict === "unsure") return { cents: current, price: line.price, flagged: true };
  if (verdict === "already_there") return { cents: 0 };
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

/** A line Claude couldn't call, still waiting for the host to keep or drop it. */
export const awaitsHost = (line: Pick<SecondLookLine, "flagged" | "hostChoice">) => !!line.flagged && !line.hostChoice;

/** The host's call on a flagged line: keep it as charged, or drop it to $0. Code sets the amount. */
export function decideFlag(line: SecondLookLine, choice: "keep" | "drop"): SecondLookLine {
  if (!line.flagged) throw new Error("Only a line Claude couldn't tell is the host's to decide.");
  return { ...line, hostChoice: choice, toCents: choice === "drop" ? 0 : line.fromCents };
}

/** The second look left every contested line where it was: there is no new offer to send. Flagged lines count once the host decides them. */
export const isUnchanged = (lines: Pick<SecondLookLine, "fromCents" | "toCents" | "flagged" | "hostChoice">[]) => lines.length > 0 && !lines.some(awaitsHost) && lines.every((l) => l.toCents >= l.fromCents);

/** The renter's photo date, in words: "taken Mar 3, before check-in". */
export function photoDateLabel(line: Pick<SecondLookLine, "withPhoto" | "photoTakenAt" | "photoTiming">): string | undefined {
  if (!line.withPhoto) return undefined;
  if (!line.photoTakenAt || line.photoTiming === "undated") return "Renter's photo: no date in the file";
  const day = new Date(line.photoTakenAt).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  if (line.photoTiming === "before_check_in") return `Renter's photo: taken ${day}, before check-in`;
  if (line.photoTiming === "after_check_out") return `Renter's photo: taken ${day}, after check-out, so it can't lower this line`;
  return `Renter's photo: taken ${day}, during the stay`;
}

/** The lines the renter contested: every line, unless they accepted some. */
export function contestedLines(lines: ChargeLine[], acceptedLineIds?: string[]): ChargeLine[] {
  return acceptedLineIds?.length ? lines.filter((line) => !acceptedLineIds.includes(line.id)) : lines;
}

/** What a verdict means, in words both sides read. */
export function verdictLabel(line: Pick<SecondLookLine, "verdict" | "withPhoto" | "fromCents" | "toCents" | "hostChoice">): string {
  if (line.verdict === "already_there") return line.withPhoto ? "Already there: seen in the renter's photo" : "Already there";
  if (line.verdict === "unsure") {
    if (line.hostChoice === "drop") return "Claude couldn't tell; the host dropped it";
    if (line.hostChoice === "keep") return "Claude couldn't tell; the host kept it";
    return "Claude can't tell; the host decides";
  }
  if (line.verdict === "smaller") return line.toCents < line.fromCents ? "Smaller than first priced" : "Smaller, but no lower price row";
  return "Still new since check-in";
}
