/**
 * When a JPEG says it was taken: EXIF DateTimeOriginal (with OffsetTimeOriginal when the camera
 * wrote one, as phones do), else the file's DateTime. Reads only the APP1 Exif block, with no
 * dependency. A file with no date (a PNG, a screenshot, a stripped upload) gives undefined.
 * Shared by server and tests, so no Node imports.
 */

const DATE_TIME_ORIGINAL = 0x9003;
const OFFSET_TIME_ORIGINAL = 0x9011;
const DATE_TIME = 0x0132;
const EXIF_IFD = 0x8769;

/** "2026:03:03 14:05:09" plus an optional "+01:00", as an ISO time. Without an offset it is read as UTC. */
export function exifDateToIso(value: string, offset?: string): string | undefined {
  const m = value.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!m || m[1] === "0000") return undefined;
  const zone = offset && /^[+-]\d{2}:\d{2}$/.test(offset.trim()) ? offset.trim() : "Z";
  const date = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${zone}`);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function ascii(view: DataView, at: number, count: number): string {
  let out = "";
  for (let i = 0; i < count && at + i < view.byteLength; i++) {
    const c = view.getUint8(at + i);
    if (c === 0) break;
    out += String.fromCharCode(c);
  }
  return out;
}

/** The ASCII tags of one IFD, plus the Exif sub-IFD offset if it has one. */
function readIfd(view: DataView, tiff: number, at: number, little: boolean): { strings: Map<number, string>; exif?: number } {
  const strings = new Map<number, string>();
  let exif: number | undefined;
  if (tiff + at + 2 > view.byteLength) return { strings };
  const count = view.getUint16(tiff + at, little);
  for (let i = 0; i < count; i++) {
    const entry = tiff + at + 2 + i * 12;
    if (entry + 12 > view.byteLength) break;
    const tag = view.getUint16(entry, little);
    const type = view.getUint16(entry + 2, little);
    const n = view.getUint32(entry + 4, little);
    if (tag === EXIF_IFD) exif = view.getUint32(entry + 8, little);
    else if (type === 2 && (tag === DATE_TIME_ORIGINAL || tag === OFFSET_TIME_ORIGINAL || tag === DATE_TIME)) {
      // Up to four bytes sit in the entry itself; longer strings are at an offset from the TIFF header.
      strings.set(tag, ascii(view, n <= 4 ? entry + 8 : tiff + view.getUint32(entry + 8, little), n));
    }
  }
  return { strings, exif };
}

/** When the photo says it was taken, as an ISO time, or undefined. */
export function photoTakenAt(bytes: Uint8Array): string | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return undefined; // not a JPEG
  let at = 2;
  while (at + 4 <= view.byteLength) {
    if (view.getUint8(at) !== 0xff) return undefined;
    const marker = view.getUint8(at + 1);
    if (marker === 0xda || marker === 0xd9) return undefined; // image data starts: no EXIF before it
    const size = view.getUint16(at + 2);
    if (marker === 0xe1 && ascii(view, at + 4, 4) === "Exif") {
      const tiff = at + 10;
      if (tiff + 8 > view.byteLength) return undefined;
      const order = view.getUint16(tiff);
      if (order !== 0x4949 && order !== 0x4d4d) return undefined;
      const little = order === 0x4949;
      const ifd0 = readIfd(view, tiff, view.getUint32(tiff + 4, little), little);
      const sub = ifd0.exif !== undefined ? readIfd(view, tiff, ifd0.exif, little).strings : new Map<number, string>();
      const original = sub.get(DATE_TIME_ORIGINAL);
      if (original) return exifDateToIso(original, sub.get(OFFSET_TIME_ORIGINAL));
      const plain = ifd0.strings.get(DATE_TIME);
      return plain ? exifDateToIso(plain) : undefined;
    }
    at += 2 + size;
  }
  return undefined;
}

/**
 * A copy of a JPEG with an EXIF block saying when it was taken. For tests and fixtures: it is how
 * a phone photo carries its date.
 */
export function withExifDate(jpeg: Uint8Array, iso: string, offset = "+00:00"): Uint8Array {
  const d = new Date(iso);
  const local = new Date(d.getTime() + offsetMinutes(offset) * 60_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${local.getUTCFullYear()}:${pad(local.getUTCMonth() + 1)}:${pad(local.getUTCDate())} ${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}:${pad(local.getUTCSeconds())}\0`;
  const off = `${offset}\0`;
  // TIFF (big-endian): IFD0 with one entry (the Exif IFD pointer), then the Exif IFD with two strings.
  const ifd0At = 8;
  const exifAt = ifd0At + 2 + 12 + 4;
  const dataAt = exifAt + 2 + 2 * 12 + 4;
  const tiff = new Uint8Array(dataAt + stamp.length + off.length);
  const v = new DataView(tiff.buffer);
  v.setUint16(0, 0x4d4d);
  v.setUint16(2, 42);
  v.setUint32(4, ifd0At);
  v.setUint16(ifd0At, 1);
  v.setUint16(ifd0At + 2, EXIF_IFD);
  v.setUint16(ifd0At + 4, 4);
  v.setUint32(ifd0At + 6, 1);
  v.setUint32(ifd0At + 10, exifAt);
  v.setUint16(exifAt, 2);
  const entry = (i: number, tag: number, text: string, at: number) => {
    const e = exifAt + 2 + i * 12;
    v.setUint16(e, tag);
    v.setUint16(e + 2, 2);
    v.setUint32(e + 4, text.length);
    v.setUint32(e + 8, at);
    for (let k = 0; k < text.length; k++) tiff[at + k] = text.charCodeAt(k);
  };
  entry(0, DATE_TIME_ORIGINAL, stamp, dataAt);
  entry(1, OFFSET_TIME_ORIGINAL, off, dataAt + stamp.length);
  const app1 = new Uint8Array(4 + 6 + tiff.length);
  const a = new DataView(app1.buffer);
  a.setUint16(0, 0xffe1);
  a.setUint16(2, 2 + 6 + tiff.length);
  app1.set([0x45, 0x78, 0x69, 0x66, 0, 0], 4);
  app1.set(tiff, 10);
  const out = new Uint8Array(jpeg.length + app1.length);
  out.set(jpeg.subarray(0, 2), 0);
  out.set(app1, 2);
  out.set(jpeg.subarray(2), 2 + app1.length);
  return out;
}

function offsetMinutes(offset: string): number {
  const m = offset.match(/^([+-])(\d{2}):(\d{2})$/);
  return m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0;
}

/** The JPEG without its EXIF block: the same picture, so a dated copy matches its original. */
export function withoutExif(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return bytes;
  const parts: Uint8Array[] = [bytes.subarray(0, 2)];
  let at = 2;
  while (at + 4 <= bytes.length && bytes[at] === 0xff) {
    const marker = bytes[at + 1];
    if (marker === 0xda || marker === 0xd9) break;
    const end = at + 2 + ((bytes[at + 2] << 8) | bytes[at + 3]);
    const isExif = marker === 0xe1 && String.fromCharCode(...bytes.subarray(at + 4, at + 8)) === "Exif";
    if (!isExif) parts.push(bytes.subarray(at, end));
    at = end;
  }
  parts.push(bytes.subarray(at));
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
