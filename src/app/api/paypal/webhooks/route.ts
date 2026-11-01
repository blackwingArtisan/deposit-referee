import { connection } from "next/server";
import { errorResponse } from "@/lib/http";
import { handleWebhookRequest } from "@/lib/paypal/webhook-handler";

/**
 * PayPal webhook endpoint. Register https://<your-app>/api/paypal/webhooks in the sandbox
 * app, then set PAYPAL_WEBHOOK_ID. Signature is verified before anything runs.
 */
export async function POST(req: Request) {
  await connection();
  try {
    return await handleWebhookRequest(req);
  } catch (e) {
    return errorResponse(e);
  }
}
