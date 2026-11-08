/**
 * The evidence pack: one PDF the host can download for their records, and the file the app sends
 * PayPal if the renter disputes a charge. It holds what was charged and why (each line with its
 * price-table row and the photo it was seen in), the renter's own answer, the photos with the
 * findings boxed, and every PayPal id, as the app last read them back. Server only.
 */
import { HttpError } from "@/lib/http";
import type { EvidenceFile } from "@/lib/paypal/types";
import { PAGE, PdfDoc, jpegSize, type PdfImage } from "./pdf";
import { readPhoto } from "./photos";
import { priceOf, rowLabel } from "./prices";
import { formatExactCents, localTime } from "./rules";
import type { Booking, BookingPhoto, ChargeLine, PhotoSlot } from "./types";

/** The charges taken on this booking, oldest first, as read back from PayPal. */
export function bookingCaptures(booking: Booking): { captureId: string; cents: number; label: string; lines: ChargeLine[] }[] {
  const out: { captureId: string; cents: number; label: string; lines: ChargeLine[] }[] = [];
  const part = booking.partCapture;
  if (part?.captureId) out.push({ captureId: part.captureId, cents: part.capturedCents ?? part.requestedCents, label: "Items the renter accepted", lines: part.lines });
  const s = booking.settlement;
  // Once settled, the settlement's capturedCents is the booking's total, which includes the accepted part.
  const earlier = part?.captureId && s?.settledAt ? (part.capturedCents ?? part.requestedCents) : 0;
  if (s?.captureId) out.push({ captureId: s.captureId, cents: (s.capturedCents ?? s.requestedCents) - earlier, label: part?.captureId ? "Contested items, settled by the host" : "Damage charge", lines: booking.proposal?.lines ?? [] });
  return out;
}

export const evidenceFileName = (booking: Booking) => `deposit-evidence-${booking.id}.pdf`;

function photoLabel(slot: PhotoSlot, renter: boolean) {
  return `${slot === "check_in" ? "Check-in" : "Check-out"} photo, ${renter ? "added by the renter" : "added by the host"}`;
}

function photoSource(photo: BookingPhoto): string {
  const s = photo.source;
  if (s.kind === "demo") return `Example photo: ${s.title}, by ${s.author} (${s.licence}).`;
  return `Uploaded ${localTime(s.addedAt)}.`;
}

function jpeg(photo: BookingPhoto): PdfImage | null {
  if (photo.mediaType !== "image/jpeg") return null;
  try {
    const data = readPhoto(photo);
    const size = jpegSize(data);
    return size ? { data, ...size } : null;
  } catch {
    return null;
  }
}

/** Photos in the order a reader needs them: before, then after, host's then renter's. */
function photoList(booking: Booking) {
  const list: { photo: BookingPhoto; label: string; on?: "check_out" | "renter_check_out" }[] = [];
  for (const slot of ["check_in", "check_out"] as const) {
    const host = booking.photos[slot];
    if (host) list.push({ photo: host, label: photoLabel(slot, false), on: slot === "check_out" ? "check_out" : undefined });
    const renter = booking.renterPhotos?.[slot];
    if (renter) list.push({ photo: renter, label: photoLabel(slot, true), on: slot === "check_out" ? "renter_check_out" : undefined });
  }
  return list;
}

const allLines = (booking: Booking) => bookingCaptures(booking).flatMap((c) => c.lines);

function seenIn(line: ChargeLine) {
  return line.photo === "renter_check_out" ? "the renter's own check-out photo" : "the host's check-out photo";
}

/** A short account for PayPal's notes field. */
export function evidenceNotes(booking: Booking): string {
  const charges = bookingCaptures(booking);
  const total = charges.reduce((sum, c) => sum + c.cents, 0);
  const lines = allLines(booking);
  const answer = booking.renterState?.response;
  const parts = [
    `Damage deposit for "${booking.item}". The renter placed a ${formatExactCents(booking.authorizedCents ?? booking.depositCents)} hold (authorization ${booking.authorizationId}); ${formatExactCents(total)} was charged for damage found by comparing the check-in and check-out photos, and the rest of the hold was released.`,
    `Items: ${lines.map((l) => `${l.description} ${formatExactCents(l.amountCents)}${l.price ? ` (price table: ${rowLabel(l.price)})` : ""}`).join("; ")}.`,
    answer ? `Before any charge the renter saw the photos and the itemized amount, and ${answer.decision === "accepted" ? "accepted it" : `contested it${answer.note ? `: "${answer.note}"` : ""}`} (${localTime(answer.at)}).` : "The renter was shown the photos and the itemized amount before any charge.",
    `The attached PDF has the photos with each finding boxed, the price-table row for every item and the PayPal ids (captures ${charges.map((c) => c.captureId).join(", ")}).`,
  ];
  return parts.join(" ").slice(0, 2000);
}

/** The PDF itself. Refused when nothing has been charged, since there is nothing to show PayPal. */
export function evidencePdf(booking: Booking): Buffer {
  const charges = bookingCaptures(booking);
  if (!charges.length) throw new HttpError(409, "Nothing has been charged on this booking, so there is no evidence pack yet.", "conflict");
  const total = charges.reduce((sum, c) => sum + c.cents, 0);
  const held = booking.authorizedCents ?? booking.depositCents;
  const doc = new PdfDoc();

  doc.para("Damage deposit evidence", { size: 18, bold: true, after: 2 });
  doc.para(booking.item, { size: 12, after: 2 });
  doc.para(`Rented by ${booking.renter}. Prepared ${localTime(new Date().toISOString())} by Deposit Referee. Amounts and ids are as read back from PayPal.`, { size: 9, gray: 0.35, after: 8 });

  doc.para("Summary", { size: 12, bold: true });
  doc.para(`A ${formatExactCents(held)} hold was placed on the renter's PayPal account. ${formatExactCents(total)} was charged for the damage itemized below; the remaining ${formatExactCents(held - total)} was ${booking.status === "settled" ? "released to the renter" : "left on the hold"}.`);
  const answer = booking.renterState?.response;
  if (answer) {
    const accepted = answer.acceptedLineIds?.length ? ` They accepted ${answer.acceptedLineIds.length} item(s) and contested the rest.` : "";
    doc.para(`The renter saw the photos and the itemized charge before any money moved, and ${answer.decision === "accepted" ? "accepted it" : "contested it"} on ${localTime(answer.at)}.${accepted}`);
    if (answer.note) doc.para(`The renter wrote: "${answer.note}"`, { indent: 12, gray: 0.25 });
  }
  if (booking.proposal?.hostReason) doc.para(`The host changed the suggested amount and gave this reason: "${booking.proposal.hostReason}"`);
  doc.rule();

  doc.para("What was charged", { size: 12, bold: true });
  let n = 0;
  for (const charge of charges) {
    doc.para(`${charge.label}: ${formatExactCents(charge.cents)} (PayPal capture ${charge.captureId})`, { bold: true, size: 10 });
    for (const line of charge.lines) {
      n += 1;
      doc.para(`${n}. ${formatExactCents(line.amountCents)}: ${line.description}`, { indent: 12, after: 1 });
      if (line.price) doc.para(`Price table: ${rowLabel(line.price)}, ${formatExactCents(priceOf(line.price))}${line.amountCents !== priceOf(line.price) ? ` (charged ${formatExactCents(line.amountCents)})` : ""}`, { indent: 24, size: 9, gray: 0.3, after: 1 });
      if (line.box) doc.para(`Seen in ${seenIn(line)}, box ${n} on the photos page.`, { indent: 24, size: 9, gray: 0.3, after: 1 });
      if (line.note) doc.para(line.note, { indent: 24, size: 9, gray: 0.3, after: 3 });
    }
    const itemized = charge.lines.reduce((sum, line) => sum + line.amountCents, 0);
    if (charge.lines.length && itemized !== charge.cents) doc.para(`The host charged ${formatExactCents(charge.cents)} of the ${formatExactCents(itemized)} itemized here.`, { indent: 12, size: 9, after: 4 });
  }
  doc.rule();

  doc.para("PayPal records", { size: 12, bold: true });
  const ids: [string, string | undefined][] = [
    ["Order (intent AUTHORIZE)", booking.orderId],
    ["Authorization", booking.authorizationId],
    ["Refreshed authorization", booking.refreshedAuthorizationId],
    ...charges.map((c, i): [string, string] => [`Capture ${i + 1}`, `${c.captureId}, ${formatExactCents(c.cents)}`]),
    ["Dispute", booking.dispute ? `${booking.dispute.disputeId}, ${booking.dispute.reason.replace(/_/g, " ").toLowerCase()}, ${formatExactCents(booking.dispute.amountCents)}` : undefined],
  ];
  for (const [k, v] of ids) if (v) doc.para(`${k}: ${v}`, { size: 9, after: 1 });
  if (booking.settlement?.settledAt) doc.para(`Settled ${localTime(booking.settlement.settledAt)}; authorization ${booking.settlement.authorizationStatus ?? "closed"}.`, { size: 9 });

  // Photos, two to a page, with the findings boxed and numbered as in the list above.
  const numbered = allLines(booking).map((line, i) => ({ line, n: i + 1 }));
  const photos = photoList(booking);
  const maxW = PAGE.width - PAGE.margin * 2;
  const maxH = 280;
  doc.newPage();
  doc.para("Photos", { size: 12, bold: true });
  for (const { photo, label, on } of photos) {
    const img = jpeg(photo);
    const w = img ? Math.min(maxW, (maxH * img.width) / img.height) : maxW;
    const h = img ? (w * img.height) / img.width : 0;
    doc.room(h + 44);
    doc.para(label, { bold: true, after: 1 });
    doc.para(photoSource(photo), { size: 8, gray: 0.4, after: 3 });
    if (!img) {
      doc.para(`This photo is a ${photo.mediaType.replace("image/", "").toUpperCase()} upload, so it is not shown here. The host keeps the original.`, { size: 9, gray: 0.3, after: 8 });
      continue;
    }
    const x = PAGE.margin;
    const y = doc.y;
    doc.image(img, x, y, w, h);
    for (const { line, n: k } of numbered) {
      if (!line.box || !on || (line.photo ?? "check_out") !== on) continue;
      const b = line.box;
      doc.rect(x + b.x * w, y + b.y * h, b.w * w, b.h * h);
      doc.text(x + b.x * w + 2, y + b.y * h - 3, String(k), { size: 11, bold: true, gray: 0 });
    }
    doc.y = y + h + 14;
  }

  return doc.toBuffer({ title: `Damage deposit evidence: ${booking.item}` });
}

export function evidenceFile(booking: Booking): EvidenceFile {
  return { name: evidenceFileName(booking), contentType: "application/pdf", data: new Uint8Array(evidencePdf(booking)) };
}
