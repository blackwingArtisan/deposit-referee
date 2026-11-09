/** Reads the PayPal sandbox directly, so the checks don't depend on the app under test. */
import { loadEnvFiles } from "../../src/lib/env-core";

const API = "https://api-m.sandbox.paypal.com";

interface Amount {
  currency_code: string;
  value: string;
}

export interface PayPalObjects {
  order: { id: string; status: string; intent: string; purchase_units: { custom_id?: string; payments: { captures: { id: string; amount: Amount }[] } }[] };
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

export interface PayPalDispute {
  dispute_id: string;
  status: string;
  reason: string;
  dispute_amount: Amount;
  disputed_transactions: { seller_transaction_id: string }[];
  dispute_life_cycle_stage?: string;
  evidences?: { evidence_type: string; documents?: { name: string }[] }[];
  messages?: { posted_by: string; documents?: { name: string }[] }[];
  links?: { rel: string }[];
}

export async function readDispute(disputeId: string): Promise<PayPalDispute> {
  return read(`/v1/customer/disputes/${disputeId}`, await token());
}

/**
 * Escalates an inquiry to a claim, the step a renter takes from their PayPal account when the
 * messages don't settle it. A test step only (the app never escalates); not a money move.
 */
export async function escalateDispute(disputeId: string, note: string): Promise<{ status: number; issue?: string; debugId: string | null }> {
  // PayPal offers escalate a little after the seller's message lands; wait for the link first.
  for (let i = 0; i < 30; i++) {
    const links = (await readDispute(disputeId)).links?.map((l) => l.rel) ?? [];
    if (links.includes("escalate")) break;
    await new Promise((r) => setTimeout(r, 10_000));
  }
  const res = await fetch(`${API}/v1/customer/disputes/${disputeId}/escalate`, { method: "POST", headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" }, body: JSON.stringify({ note }) });
  const body = (await res.json().catch(() => ({}))) as { details?: { issue?: string }[] };
  return { status: res.status, issue: body.details?.[0]?.issue, debugId: res.headers.get("paypal-debug-id") };
}

/** The CUSTOMER.DISPUTE.CREATED event PayPal sent for a dispute, if it is in PayPal's recent event list. */
export async function disputeCreatedEvent(disputeId: string): Promise<{ id: string; create_time: string } | undefined> {
  // PayPal's event list can trail the dispute by a minute or two, so look again for a while.
  for (let i = 0; i < 12; i++) {
    if (i) await new Promise((r) => setTimeout(r, 10_000));
    const { events } = await read<{ events: { id: string; create_time: string; resource?: { dispute_id?: string } }[] }>("/v1/notifications/webhooks-events?event_type=CUSTOMER.DISPUTE.CREATED&page_size=50", await token());
    const event = (events ?? []).find((e) => e.resource?.dispute_id === disputeId);
    if (event) return event;
  }
  return undefined;
}
