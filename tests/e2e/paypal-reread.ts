/** Reads the PayPal sandbox directly, so the checks don't depend on the app under test. */
import { loadEnvFiles } from "../../src/lib/env-core";

const API = "https://api-m.sandbox.paypal.com";

interface Amount {
  currency_code: string;
  value: string;
}

export interface PayPalObjects {
  order: { id: string; status: string; intent: string; purchase_units: { payments: { captures: { id: string; amount: Amount }[] } }[] };
  authorization: { id: string; status: string; amount: Amount };
  capture?: { id: string; status: string; amount: Amount; final_capture: boolean };
}

async function token(): Promise<string> {
  loadEnvFiles();
  const basic = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString("base64");
  const res = await fetch(`${API}/v1/oauth2/token`, { method: "POST", headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" }, body: "grant_type=client_credentials" });
  if (!res.ok) throw new Error(`PayPal token request failed: ${res.status}`);
  return ((await res.json()) as { access_token: string }).access_token;
}

async function read<T>(path: string, bearer: string): Promise<T> {
  const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${bearer}` } });
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
  return (await res.json()) as T;
}

export async function readPayPalObjects(orderId: string, authorizationId: string, captureId?: string): Promise<PayPalObjects> {
  const bearer = await token();
  return {
    order: await read(`/v2/checkout/orders/${orderId}`, bearer),
    authorization: await read(`/v2/payments/authorizations/${authorizationId}`, bearer),
    capture: captureId ? await read(`/v2/payments/captures/${captureId}`, bearer) : undefined,
  };
}

/** Tries a further capture. On a voided hold PayPal must refuse it. */
export async function tryCapture(authorizationId: string, value: string): Promise<{ status: number; issue?: string }> {
  const res = await fetch(`${API}/v2/payments/authorizations/${authorizationId}/capture`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ amount: { currency_code: "USD", value }, final_capture: false }),
  });
  const body = (await res.json().catch(() => ({}))) as { details?: { issue?: string }[] };
  return { status: res.status, issue: body.details?.[0]?.issue };
}
