import { beforeEach, describe, expect, it, vi } from "vitest";
import { getApprovals } from "@/lib/agent/approvals";
import { runSettlementAgent } from "@/agents/settlement";
import { activeSettlements, evidenceKey, requireBooking, saveBooking, viewBooking } from "@/lib/deposit/bookings";
import { bookingForDispute, recordDispute, refreshDispute, requestEvidenceSubmission } from "@/lib/deposit/dispute";
import { bookingCaptures, evidenceNotes, evidencePdf } from "@/lib/deposit/evidence";
import { jpegSize, wrap } from "@/lib/deposit/pdf";
import { DEMO_TWO_MARKS_CHECK_OUT } from "@/lib/deposit/photos";
import { respondAsRenter } from "@/lib/deposit/renter";
import { reviewPhotos } from "@/lib/deposit/review";
import { requestSettlement } from "@/lib/deposit/settle";
import type { Booking } from "@/lib/deposit/types";
import { acceptedBooking, heldBooking, paypal, waitForApproval } from "./deposit-fixtures";

beforeEach(async () => {
  await paypal().reset();
});

/** The renter accepted the $150 charge and the host approved it: settled, $150 captured, $150 released. */
async function settledBooking(): Promise<Booking> {
  const booking = await acceptedBooking(30_000);
  const { finished } = requestSettlement(booking.id, booking.proposal!.aiCents, "test");
  getApprovals().decide((await waitForApproval(booking.id)).id, "approved");
  await finished;
  return requireBooking(booking.id);
}

/** The renter disputes a charge from their PayPal account; PayPal sends the webhook. */
async function renterDisputes(captureId: string, message = "The scratch was there before I arrived.") {
  const dispute = await paypal().simulateDispute({ captureId, reason: "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED", buyerMessage: message });
  await paypal().flushWebhooks();
  return dispute;
}

async function waitForEvidenceApproval(bookingId: string) {
  await vi.waitFor(() => expect(viewBooking(requireBooking(bookingId)).disputeApproval).not.toBeNull(), { timeout: 8_000 });
  return viewBooking(requireBooking(bookingId)).disputeApproval!;
}

describe("dispute pack: a renter's PayPal dispute on a charge", () => {
  it("the CUSTOMER.DISPUTE.CREATED webhook files it under its booking, read back from PayPal", async () => {
    const settled = await settledBooking();
    expect(settled.status).toBe("settled");
    const opened = await renterDisputes(settled.settlement!.captureId!);

    const booking = requireBooking(settled.id);
    expect(booking.dispute).toMatchObject({
      disputeId: opened.dispute_id,
      captureId: settled.settlement!.captureId,
      reason: "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED",
      status: "WAITING_FOR_SELLER_RESPONSE",
      amountCents: 15_000,
      buyerMessage: "The scratch was there before I arrived.",
    });
    expect(booking.dispute!.responseDueAt).toBeTruthy();
    // The pack is not sent on its own: nothing waits at the gate until the host asks.
    expect(viewBooking(booking).disputeApproval).toBeNull();
  });

  it("leaves disputes on other payments alone", async () => {
    const settled = await settledBooking();
    expect(bookingForDispute({ disputed_transactions: [{ seller_transaction_id: "SOMEONE_ELSES" }] })).toBeUndefined();
    const other = await paypal().orders.create({ intent: "CAPTURE", purchase_units: [{ amount: { currency_code: "USD", value: "20.00" } }] });
    await paypal().simulateBuyerApproval(other.id);
    const captured = await paypal().orders.capture(other.id);
    await renterDisputes(captured.purchase_units![0].payments!.captures![0].id);
    expect(requireBooking(settled.id).dispute).toBeUndefined();
  });

  it("the evidence pack is a PDF with the photos, each line's price row and photo, the renter's answer and the PayPal ids", async () => {
    const settled = await settledBooking();
    const pdf = evidencePdf(settled);
    const text = pdf.toString("latin1");
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
    expect(text).toContain(settled.settlement!.captureId!);
    expect(text).toContain(settled.authorizationId!);
    expect(text).toContain(settled.orderId!);
    expect(text).toContain("Price table: Scratch or gouge, large, $150.00");
    expect(text).toContain("Seen in the host's check-out photo, box 1");
    expect(text).toContain("accepted it");
    // Both demo photos are in it, as JPEGs, with the finding boxed.
    expect(text.match(/\/Filter \/DCTDecode/g)?.length).toBe(2);
    expect(text).toMatch(/ re S Q/);
    // Each object is where the cross-reference table says it is.
    const xref = text.slice(text.lastIndexOf("xref\n"));
    const offsets = [...xref.matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
    offsets.forEach((offset, i) => expect(text.slice(offset, offset + 12)).toMatch(new RegExp(`^${i + 1} 0 obj`)));

    const notes = evidenceNotes(settled);
    expect(notes).toContain("$150.00 was charged");
    expect(notes.length).toBeLessThanOrEqual(2000);
  });

  it("refuses an evidence pack when nothing was charged", async () => {
    const held = await heldBooking(30_000);
    expect(() => evidencePdf(held)).toThrow(/Nothing has been charged/);
  });

  it("sending it waits at the Guard's approval gate, then PayPal has the file and shows the case under review", async () => {
    const settled = await settledBooking();
    const opened = await renterDisputes(settled.settlement!.captureId!);
    const { finished } = requestEvidenceSubmission(settled.id, "test");

    const approval = await waitForEvidenceApproval(settled.id);
    expect(approval.summary).toContain(`Send PayPal the evidence pack for case ${opened.dispute_id}`);
    expect(approval.summary).toContain("disputed $150.00");
    expect((await paypal().disputes.get(opened.dispute_id)).status).toBe("WAITING_FOR_SELLER_RESPONSE");

    getApprovals().decide(approval.id, "approved");
    await finished;
    const after = requireBooking(settled.id);
    expect(after.dispute).toMatchObject({ status: "UNDER_REVIEW", evidence: { fileName: `deposit-evidence-${settled.id}.pdf` } });
    expect(after.dispute!.evidence!.submittedAt).toBeTruthy();
    const onPayPal = await paypal().disputes.get(opened.dispute_id);
    expect(onPayPal.status).toBe("UNDER_REVIEW");
    expect(onPayPal.evidences![0]).toMatchObject({ evidence_type: "OTHER", documents: [{ name: `deposit-evidence-${settled.id}.pdf` }] });
    expect(onPayPal.evidences![0].notes).toContain(settled.authorizationId!);
    expect(() => requestEvidenceSubmission(settled.id, "test")).toThrow(/already sent/);
  });

  it("declining sends nothing, says so, and the host can send it later", async () => {
    const settled = await settledBooking();
    const opened = await renterDisputes(settled.settlement!.captureId!);
    const first = requestEvidenceSubmission(settled.id, "test");
    getApprovals().decide((await waitForEvidenceApproval(settled.id)).id, "denied");
    await first.finished;
    expect(requireBooking(settled.id).dispute!.evidence!.error).toMatch(/declined/);
    expect((await paypal().disputes.get(opened.dispute_id)).evidences ?? []).toEqual([]);

    const again = requestEvidenceSubmission(settled.id, "test");
    getApprovals().decide((await waitForEvidenceApproval(settled.id)).id, "approved");
    await again.finished;
    expect(requireBooking(settled.id).dispute!.status).toBe("UNDER_REVIEW");
  });

  it("a resolved case is read back with its outcome, and a closed case can't be sent evidence", async () => {
    const settled = await settledBooking();
    const opened = await renterDisputes(settled.settlement!.captureId!);
    await paypal().simulateDisputeResolution(opened.dispute_id, "SELLER_FAVOR");
    await paypal().flushWebhooks();
    expect(requireBooking(settled.id).dispute).toMatchObject({ status: "RESOLVED", outcome: "RESOLVED_SELLER_FAVOUR" });
    expect(() => requestEvidenceSubmission(settled.id, "test")).toThrow(/resolved/);
    expect((await refreshDispute(settled.id)).dispute!.status).toBe("RESOLVED");
  });

  it("an approval lost in a restart says so instead of waiting forever", async () => {
    const settled = await settledBooking();
    await renterDisputes(settled.settlement!.captureId!);
    const booking = requireBooking(settled.id);
    saveBooking({ ...booking, dispute: { ...booking.dispute!, evidence: { runId: "evidence_gone", requestedAt: new Date().toISOString() } } });
    expect(activeSettlements().has(evidenceKey(settled.id))).toBe(false);
    expect(viewBooking(requireBooking(settled.id)).dispute!.evidence!.error).toMatch(/lost when the server restarted/);
  });

  it("after a split, a dispute on the accepted part finds the booking, and the pack lists each capture at its own amount", async () => {
    const held = await heldBooking(30_000);
    const withTwo = saveBooking({ ...held, photos: { ...held.photos, check_out: DEMO_TWO_MARKS_CHECK_OUT } });
    saveBooking({ ...withTwo, status: "reviewed", review: await reviewPhotos(withTwo) });
    const proposed = await runSettlementAgent(held.id, "test");
    respondAsRenter(proposed.renterToken, "contested", "The stain was there when I arrived.", ["ai-0"]);
    getApprovals().decide((await waitForApproval(held.id)).id, "approved");
    await vi.waitFor(() => expect(requireBooking(held.id).partCapture?.captureId).toBeTruthy(), { timeout: 8_000 });
    const { finished } = requestSettlement(held.id, 4_000, "test");
    getApprovals().decide((await waitForApproval(held.id)).id, "approved");
    await finished;

    const settled = requireBooking(held.id);
    expect(bookingCaptures(settled).map((c) => [c.captureId, c.cents])).toEqual([
      [settled.partCapture!.captureId, 15_000],
      [settled.settlement!.captureId, 4_000],
    ]);
    const text = evidencePdf(settled).toString("latin1");
    expect(text).toContain("Items the renter accepted: $150.00");
    expect(text).toContain("Contested items, settled by the host: $40.00");
    expect(text).toContain("The host charged $40.00 of the $100.00 itemized here.");
    expect(text).toContain("The renter wrote:");

    await renterDisputes(settled.partCapture!.captureId!);
    expect(requireBooking(held.id).dispute).toMatchObject({ captureId: settled.partCapture!.captureId, amountCents: 15_000 });
  });

  it("recordDispute ignores a dispute it can't place", async () => {
    expect(await recordDispute({ dispute_id: "PP-D-1", disputed_transactions: [] } as never)).toBeUndefined();
  });
});

describe("evidence PDF helpers", () => {
  it("reads a JPEG's size and wraps text to a width", () => {
    const sof = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x03, 0x84, 0x04, 0xb0, 0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(jpegSize(sof)).toEqual({ width: 1200, height: 900, components: 3 });
    expect(jpegSize(Buffer.from("not a jpeg"))).toBeNull();
    const lines = wrap("one two three four five six seven eight nine ten", 10, 60);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join(" ")).toBe("one two three four five six seven eight nine ten");
  });
});
