/**
 * Checks that an uploaded photo really is a whole image before it is kept or sent to the AI.
 * A file can start with a PNG or JPEG signature and still be junk (the red team uploaded exactly
 * that), which the AI then rejects with a raw error. This reads the file's own structure: a PNG's
 * header, chunk checksums and pixel data; a JPEG's frame, scan and end markers; a WebP's
 * container and frame size. Server only.
 */
import zlib from "node:zlib";

export const UNREADABLE_PHOTO = "That file isn't a readable photo. Choose a JPEG, PNG or WebP photo.";

/** Large enough for any camera; refuses a header that claims more. */
const MAX_SIDE = 20_000;

const sane = (w: number, h: number) => w > 0 && h > 0 && w <= MAX_SIDE && h <= MAX_SIDE;

/** Bytes per pixel row for a PNG, from its header. */
function pngRowBytes(width: number, bitDepth: number, colorType: number): number | null {
  const channels: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
  const c = channels[colorType];
  if (!c || ![1, 2, 4, 8, 16].includes(bitDepth)) return null;
  return Math.ceil((width * c * bitDepth) / 8);
}

function pngReadable(b: Buffer): boolean {
  let at = 8;
  let header: { width: number; height: number; bitDepth: number; colorType: number; interlace: number } | null = null;
  const data: Buffer[] = [];
  let ended = false;
  while (at + 12 <= b.length) {
    const length = b.readUInt32BE(at);
    const type = b.subarray(at + 4, at + 8).toString("latin1");
    if (!/^[A-Za-z]{4}$/.test(type) || at + 12 + length > b.length) return false;
    const body = b.subarray(at + 8, at + 8 + length);
    if (zlib.crc32(b.subarray(at + 4, at + 8 + length)) !== b.readUInt32BE(at + 8 + length)) return false;
    if (!header) {
      if (type !== "IHDR" || length !== 13) return false;
      header = { width: body.readUInt32BE(0), height: body.readUInt32BE(4), bitDepth: body[8], colorType: body[9], interlace: body[12] };
      if (!sane(header.width, header.height)) return false;
    } else if (type === "IDAT") data.push(body);
    else if (type === "IEND") {
      ended = true;
      break;
    }
    at += 12 + length;
  }
  if (!header || !ended || !data.length) return false;
  let pixels: Buffer;
  try {
    pixels = zlib.inflateSync(Buffer.concat(data), { maxOutputLength: 512 * 1024 * 1024 });
  } catch {
    return false;
  }
  const row = pngRowBytes(header.width, header.bitDepth, header.colorType);
  if (row === null) return false;
  // Interlaced images store seven passes; their size is harder to predict, so only non-interlaced ones are measured.
  return header.interlace ? pixels.length > 0 : pixels.length >= header.height * (row + 1);
}

function jpegReadable(b: Buffer): boolean {
  if (b[0] !== 0xff || b[1] !== 0xd8) return false;
  let at = 2;
  let frame = false;
  while (at + 4 <= b.length) {
    if (b[at] !== 0xff) return false;
    const marker = b[at + 1];
    if (marker === 0xff) {
      at += 1; // fill byte
      continue;
    }
    if (marker === 0xd9) return false; // ended before any picture data
    const length = b.readUInt16BE(at + 2);
    if (length < 2 || at + 2 + length > b.length) return false;
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      if (length < 8 || !sane(b.readUInt16BE(at + 7), b.readUInt16BE(at + 5))) return false;
      frame = true;
    }
    if (marker === 0xda) {
      // Start of scan: picture data follows, and a whole file ends with the end-of-image marker.
      if (!frame) return false;
      const tail = b.subarray(Math.max(at + 2 + length, b.length - 64));
      return tail.includes(Buffer.from([0xff, 0xd9])) && b.length - (at + 2 + length) > 16;
    }
    at += 2 + length;
  }
  return false;
}

function webpReadable(b: Buffer): boolean {
  if (b.length < 30) return false;
  const size = b.readUInt32LE(4) + 8;
  if (size > b.length || size < 30) return false;
  const chunk = b.subarray(12, 16).toString("latin1");
  if (chunk === "VP8 ") return b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a && sane(b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff);
  if (chunk === "VP8L") {
    if (b[20] !== 0x2f) return false;
    const bits = b.readUInt32LE(21);
    return sane((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1);
  }
  if (chunk === "VP8X") return sane(b.readUIntLE(24, 3) + 1, b.readUIntLE(27, 3) + 1) && /VP8[ L]|ANIM/.test(b.subarray(30, Math.min(b.length, 4096)).toString("latin1"));
  return false;
}

/** True when the bytes are a whole JPEG, PNG or WebP image of a sensible size. */
export function isReadablePhoto(bytes: Buffer, mediaType: "image/jpeg" | "image/png" | "image/webp"): boolean {
  try {
    if (mediaType === "image/png") return pngReadable(bytes);
    if (mediaType === "image/jpeg") return jpegReadable(bytes);
    return webpReadable(bytes);
  } catch {
    return false;
  }
}
