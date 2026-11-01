/**
 * Realistic-looking PayPal ids (formats taken from PayPal's own API doc examples):
 *   order/authorization/capture/refund  17 chars [0-9A-Z]   e.g. 5O190127TN364715T
 *   payer / merchant / payout batch     13 chars [0-9A-Z]   e.g. QYR5Z8XDVJNXQ
 *   webhook event   WH-<17>-<17>
 *   invoice         INV2-XXXX-XXXX-XXXX-XXXX
 *   dispute         PP-D-12345
 *   vault payment token  7 chars [0-9a-z]   e.g. jwgvx42
 */
import { randomBytes, randomInt } from "node:crypto";

const DIGITS = "0123456789";
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const ALNUM_UPPER = DIGITS + UPPER;
const ALNUM_LOWER = "0123456789abcdefghijklmnopqrstuvwxyz";

function pick(chars: string) {
  return chars[randomInt(chars.length)];
}

/** PayPal transaction-style id: mostly digits with a few letters. */
function txnId(length = 17) {
  let out = "";
  for (let i = 0; i < length; i++) out += randomInt(10) < 7 ? pick(DIGITS) : pick(UPPER);
  return out;
}

function alnum(length: number, chars = ALNUM_UPPER) {
  let out = "";
  for (let i = 0; i < length; i++) out += pick(chars);
  return out;
}

export const mockIds = {
  order: () => txnId(),
  authorization: () => txnId(),
  capture: () => txnId(),
  refund: () => txnId(),
  setupToken: () => txnId(),
  buyerTransaction: () => txnId(),
  payoutTransaction: () => txnId(),
  payer: () => alnum(13),
  merchant: () => alnum(13),
  payoutBatch: () => alnum(13),
  payoutItem: () => alnum(13),
  webhookEvent: () => `WH-${txnId()}-${txnId()}`,
  invoice: () => `INV2-${alnum(4)}-${alnum(4)}-${alnum(4)}-${alnum(4)}`,
  invoiceExternalPayment: () => `EXTR-${txnId()}`,
  dispute: () => `PP-D-${randomInt(10000, 99999)}`,
  paymentToken: () => alnum(7, ALNUM_LOWER),
  customer: () => alnum(10, ALNUM_LOWER + "ABCDEFGHIJKLMNOPQRSTUVWXYZ"),
  debugId: () => randomBytes(7).toString("hex").slice(0, 13),
};
