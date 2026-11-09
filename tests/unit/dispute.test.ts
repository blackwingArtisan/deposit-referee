import { beforeEach, describe, expect, it, vi } from "vitest";
import { getApprovals } from "@/lib/agent/approvals";
import { runSettlementAgent } from "@/agents/settlement";
import { activeSettlements, evidenceKey, requireBooking, saveBooking, viewBooking } from "@/lib/deposit/bookings";
import { bookingForDispute, checkForDispute, recordDispute, refreshDispute, requestEvidenceSubmission } from "@/lib/deposit/dispute";
import { bookingCaptures, evidenceNotes, evidencePdf } from "@/lib/deposit/evidence";
import { jpegSize, wrap } from "@/lib/deposit/pdf";
import { DEMO_TWO_MARKS_CHECK_OUT } from "@/lib/deposit/photos";
import { respondAsRenter } from "@/lib/deposit/renter";
import { reviewPhotos } from "@/lib/deposit/review";
import { requestSettlement } from "@/lib/deposit/settle";
import type { Booking } from "@/lib/deposit/types";
import { timeline } from "@/lib/events/bus";
import type { TimelineEvent } from "@/lib/events/types";
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
async function renterDisputes(captureId: string, message = "The scratch was there before I arrived.", stage?: "INQUIRY" | "CHARGEBACK") {
  const dispute = await paypal().simulateDispute({ captureId, reason: "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED", buyerMessage: message, stage });
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

  it("on a claim, sending it waits at the Guard's approval gate, then PayPal has the file as evidence and shows the case under review", async () => {
    const settled = await settledBooking();
    const opened = await renterDisputes(settled.settlement!.captureId!, undefined, "CHARGEBACK");
    const { finished } = requestEvidenceSubmission(settled.id, "test");

    const approval = await waitForEvidenceApproval(settled.id);
    expect(approval.summary).toContain(`Send PayPal the evidence pack for case ${opened.dispute_id}`);
    expect(approval.summary).toContain("disputed $150.00");
    expect((await paypal().disputes.get(opened.dispute_id)).status).toBe("WAITING_FOR_SELLER_RESPONSE");

    getApprovals().decide(approval.id, "approved");
    await finished;
    const after = requireBooking(settled.id);
    expect(after.dispute).toMatchObject({ status: "UNDER_REVIEW", stage: "CHARGEBACK", evidence: { fileName: `deposit-evidence-${settled.id}.pdf`, sentAs: "evidence" } });
    expect(after.dispute!.evidence!.submittedAt).toBeTruthy();
    const onPayPal = await paypal().disputes.get(opened.dispute_id);
    expect(onPayPal.status).toBe("UNDER_REVIEW");
    expect(onPayPal.evidences![0]).toMatchObject({ evidence_type: "OTHER", documents: [{ name: `deposit-evidence-${settled.id}.pdf` }] });
    expect(onPayPal.evidences![0].notes).toContain(settled.authorizationId!);
    expect(() => requestEvidenceSubmission(settled.id, "test")).toThrow(/already sent/);
  });

  it("on an inquiry, PayPal takes no evidence yet, so the pack goes attached to a message; once the renter makes it a claim it can go again as evidence", async () => {
    const settled = await settledBooking();
    const opened = await renterDisputes(settled.settlement!.captureId!);
    expect(opened.dispute_life_cycle_stage).toBe("INQUIRY");
    await expect(paypal().disputes.provideEvidence(opened.dispute_id, { evidences: [{ evidence_type: "OTHER", notes: "x" }] })).rejects.toThrow(/ACTION_NOT_ALLOWED_IN_CURRENT_DISPUTE_STATE/);

    const first = requestEvidenceSubmission(settled.id, "test");
    const approval = await waitForEvidenceApproval(settled.id);
    expect(approval.summary).toContain(`Send PayPal the evidence pack for case ${opened.dispute_id}, attached to a message to the renter`);
    expect(approval.summary).toContain("still an inquiry");
    getApprovals().decide(approval.id, "approved");
    await first.finished;
    const asMessage = requireBooking(settled.id);
    expect(asMessage.dispute).toMatchObject({ status: "WAITING_FOR_BUYER_RESPONSE", stage: "INQUIRY", evidence: { fileName: `deposit-evidence-${settled.id}.pdf`, sentAs: "message" } });
    const onPayPal = await paypal().disputes.get(opened.dispute_id);
    const seller = onPayPal.messages!.filter((m) => m.posted_by === "SELLER");
    expect(seller).toHaveLength(1);
    expect(seller[0].content).toContain(settled.authorizationId!);
    expect(seller[0].documents).toEqual([{ name: `deposit-evidence-${settled.id}.pdf` }]);
    expect(onPayPal.evidences ?? []).toEqual([]);
    expect(() => requestEvidenceSubmission(settled.id, "test")).toThrow(/already sent/);

    // The renter escalates to a claim; PayPal asks the host for evidence, and the pack can go again.
    await paypal().simulateDisputeEscalation(opened.dispute_id);
    await paypal().flushWebhooks();
    await refreshDispute(settled.id);
    expect(requireBooking(settled.id).dispute).toMatchObject({ status: "WAITING_FOR_SELLER_RESPONSE", stage: "CHARGEBACK" });
    const again = requestEvidenceSubmission(settled.id, "test");
    getApprovals().decide((await waitForEvidenceApproval(settled.id)).id, "approved");
    await again.finished;
    expect(requireBooking(settled.id).dispute).toMatchObject({ status: "UNDER_REVIEW", evidence: { sentAs: "evidence" } });
    expect((await paypal().disputes.get(opened.dispute_id)).evidences![0]).toMatchObject({ evidence_type: "OTHER", documents: [{ name: `deposit-evidence-${settled.id}.pdf` }] });
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
    expect(requireBooking(settled.id).dispute!.status).toBe("WAITING_FOR_BUYER_RESPONSE");
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

  it("when the webhook never arrives, the host's check asks PayPal with list_disputes and files the dispute", async () => {
    const settled = await settledBooking();
    const captureId = settled.settlement!.captureId!;

    // Before any dispute: PayPal lists none, and the booking notes when it looked.
    const none = await checkForDispute(settled.id);
    expect(none.dispute).toBeUndefined();
    expect(none.disputeCheckedAt).toBeTruthy();

    // The renter disputes; the webhook is lost on the way (a laptop PayPal can't reach).
    const opened = await renterDisputes(captureId);
    saveBooking({ ...requireBooking(settled.id), dispute: undefined });

    const seen: TimelineEvent[] = [];
    const stop = timeline.subscribe((e) => {
      if (e.paypal && e.status !== "running") seen.push(e);
    });
    const found = await checkForDispute(settled.id);
    stop();
    expect(found.dispute).toMatchObject({ disputeId: opened.dispute_id, captureId, status: "WAITING_FOR_SELLER_RESPONSE", amountCents: 15_000, buyerMessage: "The scratch was there before I arrived." });
    // Both reads are the Agent Toolkit's, made by the settlement agent through the Guard.
    expect(seen.map((e) => [e.paypal!.operation, e.paypal!.via?.toolkit])).toEqual([
      ["disputes.list", "list_disputes"],
      ["disputes.get", "get_dispute"],
    ]);
    // Nothing waits at the gate: a read needs no approval, and the pack is the host's call.
    expect(viewBooking(found).disputeApproval).toBeNull();

    // Asked again, it reads the known case back rather than listing.
    expect((await checkForDispute(settled.id)).dispute!.disputeId).toBe(opened.dispute_id);
  });

  it("the check refuses a booking with nothing charged", async () => {
    const held = await heldBooking(30_000);
    await expect(checkForDispute(held.id)).rejects.toThrow(/Nothing has been charged/);
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
