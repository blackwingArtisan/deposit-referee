/**
 * When the host can send PayPal the evidence pack. Shared by the server and the dispute panel.
 * PayPal must be waiting on the host, and the pack not already sent in the form PayPal wants now:
 * a pack sent as a message on an inquiry can go again as evidence once the renter makes it a claim.
 */
import type { BookingDispute } from "./types";

export function canSendEvidence(d: Pick<BookingDispute, "status" | "stage" | "evidence">): boolean {
  if (d.status !== "WAITING_FOR_SELLER_RESPONSE") return false;
  if (!d.evidence?.submittedAt) return true;
  return d.evidence.sentAs === "message" && !!d.stage && d.stage !== "INQUIRY";
}
