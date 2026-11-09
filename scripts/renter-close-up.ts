/**
 * Makes the demo renter's check-in close-up (public/demo-photos/renter-check-in-stain.jpg) from
 * the host's two-marks check-out photo: npx tsx scripts/renter-close-up.ts
 *
 * It is a demo photo, not a renter's: a portrait crop of the same synthetic room, slightly turned
 * and re-exposed as a second phone would be. The crop keeps landmarks a model can match against
 * the host's photos (the stump, the rug's tip, the baseboard and the floorboard seams) and leaves
 * the gouge out, since the renter's story is that only the stain was there on arrival. The EXIF
 * date is written here, before any take, so the card reads "taken Nov 6, before check-in".
 */
import fs from "node:fs";
import sharp from "sharp";
import { withExifDate } from "../src/lib/deposit/exif";

const SOURCE = "public/demo-photos/cabin-check-out-two.jpg";
const OUT = "public/demo-photos/renter-check-in-stain.jpg";
/** Arrival afternoon, Central time, as a phone writes it. */
const TAKEN_AT = "2026-11-06T22:14:00.000Z";
const OFFSET = "-06:00";

async function main() {
  // Right of the gouge (it ends near x=815), from the stump and rug tip down past the stain.
  const crop = await sharp(SOURCE).extract({ left: 860, top: 120, width: 660, height: 880 }).toBuffer();
  // A second phone: turned 2 degrees, a little warmer and brighter; the turn's corners are cropped off.
  const turned = await sharp(crop).rotate(2, { background: "#000" }).toBuffer({ resolveWithObject: true });
  const inset = 36;
  const jpeg = await sharp(turned.data)
    .extract({ left: inset, top: inset, width: turned.info.width - 2 * inset, height: turned.info.height - 2 * inset })
    .resize(900, 1200, { fit: "cover" })
    .modulate({ brightness: 1.05, saturation: 1.04 })
    .linear(1.03, -2)
    .jpeg({ quality: 86, mozjpeg: true })
    .toBuffer();
  fs.writeFileSync(OUT, withExifDate(new Uint8Array(jpeg), TAKEN_AT, OFFSET));
  console.log(`${OUT}: 900x1200, taken ${TAKEN_AT} (${OFFSET})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
