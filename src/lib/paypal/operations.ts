/**
 * One row per PayPalApi method: the REST call it makes. Used by the sandbox client to build
 * requests and by the instrumentation layer to show "POST /v2/checkout/orders/{id}/capture"
 * on the timeline in both modes.
 */
export interface OperationSpec {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  /** `{id}` is replaced by the first string argument. */
  path: string;
  label: string;
  /** Honors PayPal-Request-Id (safe to retry with the same id). */
  idempotent?: boolean;
  /** Moves or requests money; shown with an amount badge. */
  money?: boolean;
}

export const OPERATIONS = {
  "orders.create": { method: "POST", path: "/v2/checkout/orders", label: "Create order", idempotent: true, money: true },
  "orders.get": { method: "GET", path: "/v2/checkout/orders/{id}", label: "Get order" },
  "orders.capture": { method: "POST", path: "/v2/checkout/orders/{id}/capture", label: "Capture order", idempotent: true, money: true },
  "orders.authorize": { method: "POST", path: "/v2/checkout/orders/{id}/authorize", label: "Authorize order", idempotent: true, money: true },

  "payments.getAuthorization": { method: "GET", path: "/v2/payments/authorizations/{id}", label: "Get authorization" },
  "payments.captureAuthorization": { method: "POST", path: "/v2/payments/authorizations/{id}/capture", label: "Capture authorization", idempotent: true, money: true },
  "payments.voidAuthorization": { method: "POST", path: "/v2/payments/authorizations/{id}/void", label: "Void authorization", idempotent: true, money: true },
  "payments.reauthorize": { method: "POST", path: "/v2/payments/authorizations/{id}/reauthorize", label: "Reauthorize", idempotent: true, money: true },
  "payments.getCapture": { method: "GET", path: "/v2/payments/captures/{id}", label: "Get capture" },
  "payments.refundCapture": { method: "POST", path: "/v2/payments/captures/{id}/refund", label: "Refund capture", idempotent: true, money: true },
  "payments.getRefund": { method: "GET", path: "/v2/payments/refunds/{id}", label: "Get refund" },

  "payouts.create": { method: "POST", path: "/v1/payments/payouts", label: "Create payout batch", idempotent: true, money: true },
  "payouts.get": { method: "GET", path: "/v1/payments/payouts/{id}", label: "Get payout batch" },

  "invoicing.generateNextNumber": { method: "POST", path: "/v2/invoicing/generate-next-invoice-number", label: "Next invoice number" },
  "invoicing.create": { method: "POST", path: "/v2/invoicing/invoices", label: "Create draft invoice", money: true },
  "invoicing.send": { method: "POST", path: "/v2/invoicing/invoices/{id}/send", label: "Send invoice", money: true },
  "invoicing.remind": { method: "POST", path: "/v2/invoicing/invoices/{id}/remind", label: "Send reminder" },
  "invoicing.cancel": { method: "POST", path: "/v2/invoicing/invoices/{id}/cancel", label: "Cancel invoice" },
  "invoicing.get": { method: "GET", path: "/v2/invoicing/invoices/{id}", label: "Get invoice" },
  "invoicing.list": { method: "GET", path: "/v2/invoicing/invoices", label: "List invoices" },
  "invoicing.recordPayment": { method: "POST", path: "/v2/invoicing/invoices/{id}/payments", label: "Record payment", money: true },

  "disputes.list": { method: "GET", path: "/v1/customer/disputes", label: "List disputes" },
  "disputes.get": { method: "GET", path: "/v1/customer/disputes/{id}", label: "Get dispute" },
  "disputes.provideEvidence": { method: "POST", path: "/v1/customer/disputes/{id}/provide-evidence", label: "Provide evidence" },
  "disputes.sendMessage": { method: "POST", path: "/v1/customer/disputes/{id}/send-message", label: "Send message" },
  "disputes.acceptClaim": { method: "POST", path: "/v1/customer/disputes/{id}/accept-claim", label: "Accept claim", money: true },

  "transactions.search": { method: "GET", path: "/v1/reporting/transactions", label: "Search transactions" },

  "webhooks.verify": { method: "POST", path: "/v1/notifications/verify-webhook-signature", label: "Verify webhook" },

  "vault.createSetupToken": { method: "POST", path: "/v3/vault/setup-tokens", label: "Create setup token", idempotent: true },
  "vault.getSetupToken": { method: "GET", path: "/v3/vault/setup-tokens/{id}", label: "Get setup token" },
  "vault.createPaymentToken": { method: "POST", path: "/v3/vault/payment-tokens", label: "Save payment method", idempotent: true },
  "vault.getPaymentToken": { method: "GET", path: "/v3/vault/payment-tokens/{id}", label: "Get payment token" },
  "vault.listPaymentTokens": { method: "GET", path: "/v3/vault/payment-tokens", label: "List payment tokens" },
  "vault.deletePaymentToken": { method: "DELETE", path: "/v3/vault/payment-tokens/{id}", label: "Delete payment token" },
} as const satisfies Record<string, OperationSpec>;

export type OperationKey = keyof typeof OPERATIONS;

export function operationPath(key: OperationKey, id?: string): string {
  const spec: OperationSpec = OPERATIONS[key];
  return id ? spec.path.replace("{id}", encodeURIComponent(id)) : spec.path;
}
