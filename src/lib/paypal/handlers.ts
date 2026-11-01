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
import { onWebhook } from "./webhooks";

void onWebhook;
