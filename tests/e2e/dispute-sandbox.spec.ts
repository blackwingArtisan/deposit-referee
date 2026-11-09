/**
 * The two steps only a PayPal buyer can do, on the real sandbox (npm run test:e2e:sandbox):
 *   1. place the $300 hold with the PayPal wallet button (log in as the sandbox buyer), and
 *   2. dispute the charge from the buyer's PayPal account, then the host files the evidence pack.
 * Both need the sandbox buyer's login in ../../.env.shared and skip with a plain message without it.
 * Tracing, screenshots and video stay off here: these pages carry the buyer's password. If PayPal
 * shows a CAPTCHA or other bot check, the run stops and says so (sandbox-buyer.ts).
 */
import { expect, test } from "@playwright/test";
import { kitStatus, renterAccepts, toPhotos, toProposal } from "./booking-flow";
import { disputeCreatedEvent, escalateDispute, readDispute, readPayPalObjects } from "./paypal-reread";
import { buyerMissing, fileDisputeAsBuyer, payHoldWithWallet, sandboxBuyer } from "./sandbox-buyer";
import type { BookingView } from "../../src/lib/deposit/types";

test.use({ trace: "off", screenshot: "off", video: "off" });

test.beforeEach(async ({ request }) => {
  const { sandbox } = await kitStatus(request);
  test.skip(!sandbox, "Only a real PayPal sandbox has a buyer to log in as; the mock dispute path is in deposit-flow.spec.ts");
  const missing = buyerMissing();
  test.skip(!!missing, missing ?? "");
});

test("wallet: the sandbox buyer places the $300 hold with the PayPal button", async ({ page, request }) => {
  const buyer = sandboxBuyer();
  const flow = await toPhotos(page, request, { item: "Lakeside cabin, wallet hold", payWith: (renter) => payHoldWithWallet(renter, buyer) });
  const { orderId, authorizationId } = await flow.booking();
  const { order, authorization } = await readPayPalObjects(orderId!, authorizationId!);
  expect(order.intent).toBe("AUTHORIZE");
  expect(authorization.status).toBe("CREATED");
  expect(authorization.amount.value).toBe("300.00");
  expect(order.purchase_units[0].custom_id, "PayPal's order names its booking").toBe(flow.id);
  console.log(`PayPal re-read (wallet): booking ${flow.id}; order ${order.id} ${order.status}; custom_id ${order.purchase_units[0].custom_id}; authorization ${authorization.id} ${authorization.status} ${authorization.amount.value}`);
});

test("dispute run: the buyer disputes the charge in PayPal, the app finds it and the host sends the evidence pack", async ({ page, request, browser }) => {
  test.setTimeout(1_800_000); // two PayPal reviews: the new inquiry, then the claim
  const buyer = sandboxBuyer();
  const flow = await toProposal(page, request, { item: "Lakeside cabin, dispute run", payWith: (renter) => payHoldWithWallet(renter, buyer) });
  const renter = await renterAccepts(page, await flow.booking());
  await renter.context().close();
  await expect(page.getByTestId("request-approval")).toBeEnabled({ timeout: 10_000 });
  await page.getByTestId("request-approval").click();
  await page.getByTestId("approve-button").click({ timeout: 30_000 });
  await expect(page.getByTestId("ruling-headline")).toHaveText("$150 captured, $150 released", { timeout: 60_000 });
  const captureId = (await flow.booking()).settlement!.captureId!;

  // The buyer, in their own PayPal account, in a browser with nothing of the host's.
  const buyerContext = await browser.newContext();
  const filed = await fileDisputeAsBuyer(await buyerContext.newPage(), buyer, captureId, "The scratch on the table was there when I arrived; I didn't cause it. The host took $150 of my deposit for it, and I'm asking PayPal to review that charge.");
  await buyerContext.close();
  test.skip(filed === "not offered yet", `PayPal's Resolution Center didn't offer capture ${captureId} for a dispute yet. Rerun later; nothing else failed.`);

  // PayPal's webhook can't reach a laptop, so the host asks PayPal (list_disputes, then get_dispute)
  // until the case shows and PayPal is asking the seller for evidence. A new sandbox case sits
  // UNDER_REVIEW for a few minutes first.
  let booking: BookingView | undefined;
  for (let i = 0; i < 48 && booking?.dispute?.status !== "WAITING_FOR_SELLER_RESPONSE"; i++) {
    if (i) await page.waitForTimeout(10_000);
    const res = await page.request.post(`/api/bookings/${flow.id}/dispute/check`);
    // PayPal refusing the disputes API (a 403 NOT_AUTHORIZED when the app lacks the feature) is reported as is.
    if (!res.ok()) throw new Error(`The dispute check failed: ${res.status()} ${await res.text()}`);
    booking = (await res.json()) as BookingView;
  }
  expect(booking?.dispute, "PayPal listed no dispute on the capture within 8 minutes of the buyer filing it").toBeTruthy();
  const dispute = booking!.dispute!;
  expect(dispute.captureId).toBe(captureId);

  await page.reload();
  const panel = page.getByTestId("dispute-panel");
  await expect(page.getByTestId("dispute-id")).toHaveText(dispute.disputeId);
  test.skip(dispute.status !== "WAITING_FOR_SELLER_RESPONSE", `PayPal shows dispute ${dispute.disputeId} as ${dispute.status}, so it isn't asking for evidence.`);

  // The pack waits at the Guard's gate; PayPal gets it only after the host approves.
  await panel.getByTestId("send-evidence").click();
  const prompt = panel.getByTestId("approval-prompt");
  await expect(prompt).toContainText(`Send PayPal the evidence pack for case ${dispute.disputeId}`, { timeout: 30_000 });
  await prompt.getByTestId("approve-button").click();
  await expect(page.getByTestId("evidence-sent")).toContainText(`deposit-evidence-${flow.id}.pdf`, { timeout: 60_000 });

  // Straight from PayPal, not through the app.
  const onPayPal = await readDispute(dispute.disputeId);
  expect(onPayPal.disputed_transactions.map((t) => t.seller_transaction_id)).toContain(captureId);
  // A new case is an inquiry, so PayPal takes the pack attached to a message (send-message).
  const callOf = async (op: string) => {
    const { events } = (await (await page.request.get(`/api/bookings/${flow.id}/activity`)).json()) as { events: { paypal?: { operation: string; httpStatus?: number; debugId?: string } }[] };
    return events.flatMap((e) => (e.paypal?.operation === op && e.paypal.httpStatus ? [e.paypal] : [])).at(-1);
  };
  const pdf = `deposit-evidence-${flow.id}.pdf`;
  expect((await flow.booking()).dispute!.evidence!.sentAs).toBe("message");
  expect(onPayPal.messages?.filter((m) => m.posted_by === "SELLER").flatMap((m) => m.documents ?? []).length ?? 0).toBeGreaterThan(0);
  const message = await callOf("disputes.sendMessage");
  expect(message?.httpStatus).toBeLessThan(300);

  // The renter escalates it to a claim (the test takes that step with PayPal's escalate call). PayPal
  // reviews it, then asks the host for evidence, and the pack goes again, as formal evidence.
  const escalated = await escalateDispute(dispute.disputeId, "Escalated by the sandbox test, as the renter would from their PayPal account.");
  expect(escalated.status, `PayPal refused to escalate the inquiry: ${escalated.issue ?? "no issue code"} (debug_id ${escalated.debugId})`).toBeLessThan(300);
  let claim: BookingView | undefined;
  for (let i = 0; i < 48 && !(claim?.dispute?.status === "WAITING_FOR_SELLER_RESPONSE" && claim.dispute.stage !== "INQUIRY"); i++) {
    await page.waitForTimeout(10_000);
    const res = await page.request.post(`/api/bookings/${flow.id}/dispute/check`);
    if (!res.ok()) throw new Error(`The dispute check failed: ${res.status()} ${await res.text()}`);
    claim = (await res.json()) as BookingView;
  }
  expect(claim?.dispute?.stage, "PayPal didn't turn the escalated inquiry into a claim asking for evidence within 8 minutes").not.toBe("INQUIRY");
  await page.reload();
  await expect(panel.getByTestId("send-evidence")).toHaveText("Send the evidence pack again, as evidence");
  await panel.getByTestId("send-evidence").click();
  await expect(panel.getByTestId("approval-prompt")).toContainText(`Send PayPal the evidence pack for case ${dispute.disputeId}: `, { timeout: 30_000 });
  await panel.getByTestId("approval-prompt").getByTestId("approve-button").click();
  await expect(page.getByTestId("evidence-sent")).toContainText(`Sent ${pdf} to PayPal as evidence`, { timeout: 60_000 });
  const final = await readDispute(dispute.disputeId);
  expect(final.evidences?.length ?? 0).toBeGreaterThan(0);
  const provide = await callOf("disputes.provideEvidence");
  expect(provide?.httpStatus).toBeLessThan(300);

  const event = await disputeCreatedEvent(dispute.disputeId).catch(() => undefined);
  console.log(
    `PayPal re-read (dispute run): booking ${flow.id} (DEMO_DISPUTE_BOOKING=${flow.id}; a visitor sees it at /bookings/${flow.id}); wallet authorization ${(await flow.booking()).authorizationId}; capture ${captureId}; dispute ${final.dispute_id} ${final.status} ${final.dispute_life_cycle_stage} ${final.reason} ${final.dispute_amount.value}; evidences ${final.evidences?.length ?? 0}; CUSTOMER.DISPUTE.CREATED event ${event?.id ?? "not in PayPal's recent list"}; send-message debug_id ${message?.debugId ?? "none"}; escalate debug_id ${escalated.debugId ?? "none"}; provide-evidence debug_id ${provide?.debugId ?? "none"}`,
  );
});
