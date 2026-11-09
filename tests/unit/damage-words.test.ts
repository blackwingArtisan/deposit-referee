import { describe, expect, it } from "vitest";
import { damageNamed, damageNotShown } from "../../demo/damage-words";

describe("demo captions name damage only as the findings do", () => {
  const findings = "Long thin scratch or gouge in the plank floor. Dark stain on the floor planks, right of centre. scratch stain";

  it("passes a caption that names what the findings name", () => {
    expect(damageNotShown("Two new marks: a scratch or gouge and a stain.", findings)).toEqual([]);
    expect(damageNotShown("$150 for the scratch or gouge, $100 for the stain.", findings)).toEqual([]);
    expect(damageNotShown("Claude compares the two photos and boxes only what's new.", "")).toEqual([]);
  });

  it("fails a caption that names damage the findings don't", () => {
    expect(damageNotShown("a gouge in the floor and a stain on the rug", findings)).toEqual(['"rug"']);
    expect(damageNotShown("They contest the stain.", "")).toEqual(['"stain"']);
    expect(damageNotShown("a burn on the couch", findings)).toEqual(['"burn"', '"couch"']);
  });

  it("names a line from its price-table row", () => {
    expect(damageNamed({ price: { type: "stain" } })).toBe("stain");
    expect(damageNamed({ price: { type: "scratch" } })).toBe("scratch or gouge");
    expect(damageNamed({})).toBe("mark");
  });
});
