import { getEnv } from "@/lib/env";
import { HttpError, route } from "@/lib/http";
import { getSandboxAccessToken, PayPalApiError, SANDBOX_API_BASE } from "@/lib/paypal";
import { SANDBOX_TEST_CARD } from "@/lib/paypal/test-card";

/**
 * Sandbox recordings only (DEMO_TEST_CARD=1, set by playwright.demo.config.ts): what the buyer
 * does in the PayPal window, with the test card instead of a login (CREATED -> APPROVED).
 */
export const POST = route<RouteContext<"/api/dev/sandbox/approve-order/[id]">>(async (_req, ctx) => {
  const env = getEnv();
  if (env.paypalMode !== "sandbox" || !env.demoTestCard) throw new HttpError(404, "Only available in sandbox demo recordings", "not_found");
  const { id } = await ctx.params;
  const res = await fetch(`${SANDBOX_API_BASE}/v2/checkout/orders/${encodeURIComponent(id)}/confirm-payment-source`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await getSandboxAccessToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ payment_source: { card: { ...SANDBOX_TEST_CARD, name: "Sandbox Buyer" } } }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw PayPalApiError.fromResponse(res.status, json, res.headers, "orders.confirmPaymentSource");
  return { id, status: (json as { status?: string }).status };
});
