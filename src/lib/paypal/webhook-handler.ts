/**
 * Incoming webhook pipeline (used by POST /api/paypal/webhooks and by the mock's deliveries):
 *   verify signature -> parse -> de-duplicate -> ledger + timeline -> your onWebhook handlers
 *
 * Register handlers in src/lib/paypal/handlers.ts.
 */
import { timeline, withContext } from "../events/bus";
import { singleton } from "../singleton";
import { getEnv } from "../env";
import { getPayPal } from "./index";
import { ingestPayPalResource } from "./ledger";
import { dispatchWebhook, invoiceFromEvent, parseWebhookEvent, type AnyWebhookEvent } from "./webhooks";
import "./handlers";

const seen = singleton("paypal:webhook-seen", () => new Map<string, number>());

function amountOf(event: AnyWebhookEvent) {
  const r = event.resource as Record<string, unknown>;
  const m = (r.amount ?? r.dispute_amount ?? invoiceFromEvent(event)?.amount) as { currency_code?: string; value?: string } | undefined;
  return m?.currency_code && m.value ? { currency_code: m.currency_code, value: m.value } : undefined;
}

export async function processWebhookEvent(event: AnyWebhookEvent, opts: { replay?: boolean } = {}) {
  // PayPal retries a delivery up to 25 times over 3 days; handle each event id once.
  if (!opts.replay && seen.has(event.id)) return { duplicate: true, handled: 0, errors: [] as string[] };
  seen.set(event.id, Date.now());
  if (seen.size > 5000) seen.delete(seen.keys().next().value!);

  ingestPayPalResource(event.resource);
  return withContext({ channel: "global", actor: "webhook" }, async () => {
    const result = await dispatchWebhook(event);
    timeline.emit({
      kind: "webhook",
      status: result.errors.length ? "failed" : "succeeded",
      title: event.event_type,
      subtitle: opts.replay ? `Replayed webhook · ${event.id}` : `Webhook · ${event.id}`,
      detail: event.summary,
      amount: amountOf(event),
      error: result.errors.length ? { name: "WebhookHandlerError", message: result.errors.join("; ") } : undefined,
      data: { event, handlers: result.handled },
    });
    return { duplicate: false, ...result };
  });
}

export async function handleWebhookRequest(req: Request): Promise<Response> {
  const raw = await req.text();
  const verification = await getPayPal().webhooks.verify(req.headers, raw);
  if (!verification.verified) {
    timeline.emit({
      kind: "webhook",
      status: "failed",
      channel: "global",
      title: "Webhook rejected",
      detail: verification.reason ?? verification.status,
    });
    const status = verification.status === "NOT_CONFIGURED" ? 503 : 400;
    return Response.json({ error: "WEBHOOK_VERIFICATION_FAILED", ...verification }, { status });
  }
  let event: AnyWebhookEvent;
  try {
    event = parseWebhookEvent(raw);
  } catch {
    return Response.json({ error: "INVALID_WEBHOOK_PAYLOAD" }, { status: 400 });
  }
  const replay = getEnv().paypalMode === "mock" && req.headers.get("x-kit-replay") === "1";
  const result = await processWebhookEvent(event, { replay });
  // Always 2xx once verified, or PayPal keeps retrying; handler errors show on the timeline.
  return Response.json({ received: true, ...result });
}
