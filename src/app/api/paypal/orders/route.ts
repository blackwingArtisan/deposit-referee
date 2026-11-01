import { z } from "zod";
import { readJson, route, moneyValue } from "@/lib/http";
import { getPayPal } from "@/lib/paypal";
import { money } from "@/lib/money";

const Body = z.object({
  intent: z.enum(["CAPTURE", "AUTHORIZE"]).default("CAPTURE"),
  amount: z.string().regex(moneyValue),
  currency_code: z.string().length(3).default("USD"),
  description: z.string().max(127).optional(),
  invoice_id: z.string().max(127).optional(),
  /** Save the buyer's PayPal for later buyer-not-present charges (Vault, needs vault enabled on the app). */
  save_payment_method: z.boolean().optional(),
});

/**
 * Create an order for the buyer to approve. In a real app, compute the amount on the server
 * from your own catalog/cart — never trust a price sent by the browser.
 */
export const POST = route(async (req) => {
  const b = await readJson(req, Body);
  const amount = money(b.amount, b.currency_code);
  return getPayPal().orders.create({
    intent: b.intent,
    purchase_units: [{ amount, description: b.description, invoice_id: b.invoice_id }],
    ...(b.save_payment_method
      ? { payment_source: { paypal: { attributes: { vault: { store_in_vault: "ON_SUCCESS" as const, usage_type: "MERCHANT" as const } }, experience_context: { shipping_preference: "NO_SHIPPING" as const, user_action: "CONTINUE" as const } } } }
      : {}),
  });
});
