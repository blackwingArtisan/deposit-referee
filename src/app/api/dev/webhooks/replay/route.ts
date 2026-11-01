import { z } from "zod";
import { readJson, route, HttpError } from "@/lib/http";
import { getMockPayPal } from "@/lib/paypal";
import { signMockWebhook } from "@/lib/paypal/webhooks";
import { handleWebhookRequest } from "@/lib/paypal/webhook-handler";

const Body = z.object({ eventId: z.string().optional(), eventType: z.string().optional(), last: z.number().int().min(1).max(50).optional() });

/**
 * Mock mode only: re-deliver stored mock webhook events through the real webhook handler
 * (signature verification included). Body: { eventId } | { eventType } | { last: n }.
 */
export const POST = route(
  async (req) => {
    const b = await readJson(req, Body);
    const all = getMockPayPal()!.events();
    const picked = b.eventId ? all.filter((e) => e.id === b.eventId) : b.eventType ? all.filter((e) => e.event_type === b.eventType).slice(-1) : all.slice(-(b.last ?? 1));
    if (!picked.length) throw new HttpError(404, "No matching mock webhook events", "not_found");
    const results = [];
    for (const event of picked) {
      const raw = JSON.stringify(event);
      const headers = { ...signMockWebhook(raw, crypto.randomUUID()), "x-kit-replay": "1" };
      const res = await handleWebhookRequest(new Request(new URL("/api/paypal/webhooks", req.url), { method: "POST", headers, body: raw }));
      results.push({ id: event.id, event_type: event.event_type, status: res.status, body: await res.json() });
    }
    return { replayed: results };
  },
  { mockOnly: true },
);
