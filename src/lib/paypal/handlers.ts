/**
 * APP-OWNED: register your webhook handlers here. Loaded once by the webhook pipeline.
 * Every verified event is already recorded in the ledger and shown on the timeline; add
 * handlers for side effects (fulfil an order, email a receipt, update your own records).
 *
 *   onWebhook("PAYMENT.CAPTURE.COMPLETED", async (event) => {
 *     const capture = event.resource;            // typed as Capture
 *     await markOrderPaid(capture.supplementary_data?.related_ids.order_id);
 *   });
 */
import type { Dispute } from "./types";
import { onWebhook } from "./webhooks";

/**
 * A renter disputed one of a booking's charges: file it under that booking and read it back from
 * PayPal (get_dispute), so the host sees it with the evidence pack ready to send. Updates and the
 * outcome are read back the same way. Loaded lazily: the deposit code imports the PayPal client.
 */
async function onDispute(resource: Dispute) {
  const { recordDispute } = await import("@/lib/deposit/dispute");
  await recordDispute(resource);
}

onWebhook("CUSTOMER.DISPUTE.CREATED", (event) => onDispute(event.resource as Dispute));
onWebhook("CUSTOMER.DISPUTE.UPDATED", (event) => onDispute(event.resource as Dispute));
onWebhook("CUSTOMER.DISPUTE.RESOLVED", (event) => onDispute(event.resource as Dispute));
