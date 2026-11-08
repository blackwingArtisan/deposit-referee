/** Check-in and check-out photos: the licensed demo pair, or the host's own upload. Server only. */
import fs from "node:fs";
import path from "node:path";
import { MAX_IMAGE_BYTES, parseDataUrl } from "@/lib/ai/images";
import { HttpError } from "@/lib/http";
import { dataPath } from "@/lib/store/files";
import type { BookingPhoto, PhotoSlot } from "./types";

const SOURCE = { title: "Wooden Lounge", author: "Greg Zaal", licence: "CC0 1.0", pageUrl: "https://polyhaven.com/a/wooden_lounge" };

/** Full credits and how each file was made: PHOTO-CREDITS.md. */
export const DEMO_PHOTOS: Record<PhotoSlot, BookingPhoto> = {
  check_in: {
    src: "/demo-photos/cabin-check-in.jpg",
    mediaType: "image/jpeg",
    source: { kind: "demo", ...SOURCE, note: "Reframed from the original panorama." },
  },
  check_out: {
    src: "/demo-photos/cabin-check-out.jpg",
    mediaType: "image/jpeg",
    source: { kind: "demo", ...SOURCE, note: "Reframed from the original panorama. The floor gouge was added digitally for this demo." },
  },
};

/** The check-in photo again as the check-out: shows a booking with nothing to charge. */
export const DEMO_CLEAN_CHECK_OUT: BookingPhoto = {
  src: "/demo-photos/cabin-check-in.jpg",
  mediaType: "image/jpeg",
  source: { kind: "demo", ...SOURCE, note: "The same photo as check-in, to show a stay with no new damage." },
};

/** A faint scuff the AI should show the host but not charge. */
export const DEMO_FAINT_CHECK_OUT: BookingPhoto = {
  src: "/demo-photos/cabin-check-out-faint.jpg",
  mediaType: "image/jpeg",
  source: { kind: "demo", ...SOURCE, note: "Reframed from the original panorama. The faint floor scuff was added digitally for this demo." },
};

/** Two marks: the gouge, plus a stain on the floor, so the renter can accept one and contest the other. */
export const DEMO_TWO_MARKS_CHECK_OUT: BookingPhoto = {
  src: "/demo-photos/cabin-check-out-two.jpg",
  mediaType: "image/jpeg",
  source: { kind: "demo", ...SOURCE, note: "Reframed from the original panorama. The floor gouge and the stain were added digitally for this demo." },
};

/** The renter's own close-up at check-in, already showing the stain, for the two-marks demo. */
export const DEMO_RENTER_CHECK_IN: BookingPhoto = {
  src: "/demo-photos/renter-check-in-stain.jpg",
  mediaType: "image/jpeg",
  source: { kind: "demo", ...SOURCE, note: "A close-up made from the same panorama, standing in for the renter's own photo on arrival. The stain was added digitally for this demo." },
};

const SIGNATURES: { mediaType: BookingPhoto["mediaType"]; ext: string; matches: (b: Buffer) => boolean }[] = [
  { mediaType: "image/jpeg", ext: "jpg", matches: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mediaType: "image/png", ext: "png", matches: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mediaType: "image/webp", ext: "webp", matches: (b) => b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP" },
];

/** `key` is the slot, or renter_<slot> for the renter's own photo. */
const uploadFile = (bookingId: string, key: string, ext: string) => dataPath("photos", `${bookingId}-${key}.${ext}`);

export function saveUpload(bookingId: string, slot: PhotoSlot, dataUrl: string, by: "host" | "renter" = "host"): BookingPhoto {
  let bytes: Buffer;
  try {
    bytes = Buffer.from(parseDataUrl(dataUrl).base64, "base64");
  } catch {
    throw new HttpError(400, "Upload a JPEG, PNG or WebP photo.", "invalid_photo");
  }
  if (bytes.length > MAX_IMAGE_BYTES) throw new HttpError(413, "That photo is over 5 MB. Choose a smaller one.", "photo_too_large");
  const kind = SIGNATURES.find((s) => s.matches(bytes));
  if (!kind) throw new HttpError(400, "Upload a JPEG, PNG or WebP photo.", "invalid_photo");
  const key = by === "renter" ? `renter_${slot}` : slot;
  const file = uploadFile(bookingId, key, kind.ext);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, bytes);
  return { src: `/api/bookings/${bookingId}/photos/${key}`, mediaType: kind.mediaType, source: { kind: "upload", addedAt: new Date().toISOString(), ...(by === "renter" ? { by } : {}) } };
}

function photoFile(photo: BookingPhoto): string {
  if (photo.source.kind === "demo") return path.join(process.cwd(), "public", photo.src);
  const [, , , bookingId, , key] = photo.src.split("/");
  const ext = SIGNATURES.find((s) => s.mediaType === photo.mediaType)!.ext;
  return uploadFile(bookingId, key, ext);
}

export function readPhoto(photo: BookingPhoto): Buffer {
  return fs.readFileSync(/*turbopackIgnore: true*/ photoFile(photo));
}
