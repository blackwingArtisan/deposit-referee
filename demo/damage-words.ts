/**
 * Captions name damage only as the AI's findings on screen do: a caption that says "stain on the
 * rug" over a finding about a wood floor fails the demo. Shared by the demo and its unit test.
 */
import { TYPE_LABEL, type DamageType } from "../src/lib/deposit/prices";

/** Words that name a kind of damage or the thing damaged. */
export const DAMAGE_WORDS = ["gouge", "scratch", "dent", "chip", "crack", "stain", "burn", "tear", "rip", "hole", "scuff", "marker", "crayon", "rug", "carpet", "floor", "plank", "board", "wall", "couch", "sofa", "door", "window", "counter", "tile", "wood"];

/** A short name for a charge line: its price-table type ("scratch or gouge" → "scratch or gouge"). */
export function damageNamed(line: { price?: { type: string } }): string {
  const label = line.price ? TYPE_LABEL[line.price.type as DamageType] : undefined;
  return label ? label.toLowerCase() : "mark";
}

/** The damage words in `caption` that `findings` doesn't contain. */
export function damageNotShown(caption: string, findings: string): string[] {
  const said = caption.toLowerCase();
  const shown = findings.toLowerCase();
  return DAMAGE_WORDS.filter((word) => new RegExp(`\\b${word}s?\\b`).test(said) && !new RegExp(`\\b${word}`).test(shown)).map((w) => `"${w}"`);
}
