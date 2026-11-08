/**
 * The published price table. The AI names the kind of damage and its size; the amount comes from
 * this table, never from the model, so the same scratch always costs the same. These are this
 * app's starting figures for a typical repair, not quotes: the host can change any line and says
 * why. Shared by server and browser, so no Node imports.
 */

export const DAMAGE_TYPES = ["scratch", "dent", "chip", "crack", "stain", "burn", "tear", "hole", "marking", "broken"] as const;
export type DamageType = (typeof DAMAGE_TYPES)[number];

export const DAMAGE_SIZES = ["small", "medium", "large"] as const;
export type DamageSize = (typeof DAMAGE_SIZES)[number];

export const TYPE_LABEL: Record<DamageType, string> = {
  scratch: "Scratch or gouge",
  dent: "Dent",
  chip: "Chip",
  crack: "Crack",
  stain: "Stain",
  burn: "Burn",
  tear: "Tear or rip",
  hole: "Hole",
  marking: "Marker, crayon or scuff",
  broken: "Broken or missing part",
};

export const SIZE_LABEL: Record<DamageSize, string> = {
  small: "Small (coin-sized)",
  medium: "Medium (up to a hand's length)",
  large: "Large (longer than a hand, or a whole board or panel)",
};

/** Cents by type and size. Kept round so a renter can check a line at a glance. */
export const PRICE_TABLE: Record<DamageType, Record<DamageSize, number>> = {
  scratch: { small: 4_000, medium: 9_000, large: 15_000 },
  dent: { small: 5_000, medium: 10_000, large: 17_500 },
  chip: { small: 4_000, medium: 8_000, large: 15_000 },
  crack: { small: 7_500, medium: 15_000, large: 25_000 },
  stain: { small: 5_000, medium: 10_000, large: 17_500 },
  burn: { small: 7_500, medium: 15_000, large: 25_000 },
  tear: { small: 5_000, medium: 10_000, large: 17_500 },
  hole: { small: 10_000, medium: 17_500, large: 30_000 },
  marking: { small: 3_000, medium: 6_000, large: 10_000 },
  broken: { small: 10_000, medium: 20_000, large: 35_000 },
};

export interface PriceRow {
  type: DamageType;
  size: DamageSize;
}

export function priceOf(row: PriceRow): number {
  return PRICE_TABLE[row.type][row.size];
}

/** "Scratch or gouge, large". */
export function rowLabel(row: PriceRow): string {
  return `${TYPE_LABEL[row.type]}, ${row.size}`;
}
