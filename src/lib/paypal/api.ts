/**
 * The PayPal interface every app codes against. Two implementations:
 *   - SandboxPayPal: real REST calls to https://api-m.sandbox.paypal.com
 *   - MockPayPal:    in-memory state machine with the same shapes, statuses and errors
 * Get the right one with getPayPal() from "@/lib/paypal".
 */
import type * as T from "./types";
import type { WebhookVerification } from "./webhooks";

export interface RequestOptions {
  /**
   * Sent as PayPal-Request-Id on writes. Same id = PayPal replays the first result instead
   * of doing the action twice. Generated automatically when omitted.
   */
  requestId?: string;
  /** Sandbox negative testing, e.g. { mock_application_codes: "INSTRUMENT_DECLINED" }. Orders/Payments only. */
  mockResponse?: { mock_application_codes: string };
}

export interface PayPalApi {
  readonly mode: "mock" | "sandbox";

  orders: {
    create(body: T.CreateOrderRequest, opts?: RequestOptions): Promise<T.Order>;
    get(orderId: string): Promise<T.Order>;
    /** intent=CAPTURE orders, after buyer approval. */
    capture(orderId: string, opts?: RequestOptions): Promise<T.Order>;
    /** intent=AUTHORIZE orders, after buyer approval. Result has purchase_units[0].payments.authorizations[0]. */
    authorize(orderId: string, opts?: RequestOptions): Promise<T.Order>;
  };

  payments: {
    getAuthorization(authorizationId: string): Promise<T.Authorization>;
    /** Partial captures: pass amount + final_capture:false, repeat; final_capture:true closes it. */
    captureAuthorization(authorizationId: string, body?: T.CaptureAuthorizationRequest, opts?: RequestOptions): Promise<T.Capture>;
    /** Voids the uncaptured remainder. Fails if fully captured. Returns the VOIDED authorization. */
    voidAuthorization(authorizationId: string, opts?: RequestOptions): Promise<T.Authorization>;
    /** Days 4–29 of an authorization only; returns a NEW authorization id. */
    reauthorize(authorizationId: string, body?: T.ReauthorizeRequest, opts?: RequestOptions): Promise<T.Authorization>;
    getCapture(captureId: string): Promise<T.Capture>;
    /** Omit amount for a full refund. Partial refunds can repeat until the capture is used up. */
    refundCapture(captureId: string, body?: T.RefundRequest, opts?: RequestOptions): Promise<T.Refund>;
    getRefund(refundId: string): Promise<T.Refund>;
  };

  payouts: {
    create(body: T.CreatePayoutRequest, opts?: RequestOptions): Promise<T.CreatePayoutResponse>;
    get(payoutBatchId: string, query?: { page?: number; page_size?: number; total_required?: boolean }): Promise<T.PayoutBatch>;
  };

  invoicing: {
    generateNextNumber(): Promise<{ invoice_number: string }>;
    /** Creates a DRAFT. Returns the full invoice. */
    create(body: T.CreateInvoiceRequest, opts?: RequestOptions): Promise<T.Invoice>;
    /** DRAFT -> SENT (or SCHEDULED if invoice_date is in the future). Returns the payer-view link. */
    send(invoiceId: string, body?: T.InvoiceNotificationRequest): Promise<T.Link>;
    remind(invoiceId: string, body?: T.InvoiceNotificationRequest): Promise<void>;
    cancel(invoiceId: string, body?: T.InvoiceNotificationRequest): Promise<void>;
    get(invoiceId: string): Promise<T.Invoice>;
    list(query?: { page?: number; page_size?: number; total_required?: boolean }): Promise<T.InvoiceList>;
    /** Record a payment received outside PayPal (cash, bank transfer...). */
    recordPayment(invoiceId: string, body: T.RecordInvoicePaymentRequest): Promise<{ payment_id: string }>;
  };

  disputes: {
    list(query?: T.ListDisputesQuery): Promise<T.DisputeList>;
    get(disputeId: string): Promise<T.Dispute>;
    /** multipart/form-data under the hood. Only while status is WAITING_FOR_SELLER_RESPONSE. */
    provideEvidence(disputeId: string, input: { evidences: T.DisputeEvidence[] }, files?: T.EvidenceFile[]): Promise<{ links: T.Link[] }>;
    /** Accepting refunds the buyer. */
    acceptClaim(disputeId: string, body?: T.AcceptClaimRequest): Promise<{ links: T.Link[] }>;
  };

  transactions: {
    /** Max 31-day window. Real sandbox data appears up to ~3 hours late. */
    search(query: T.TransactionSearchQuery): Promise<T.TransactionSearchResponse>;
  };

  webhooks: {
    /** Verifies a received webhook. Pass the raw body string exactly as received. */
    verify(headers: Headers, rawBody: string): Promise<WebhookVerification>;
  };

  vault: {
    createSetupToken(body: T.CreateSetupTokenRequest, opts?: RequestOptions): Promise<T.SetupToken>;
    getSetupToken(setupTokenId: string): Promise<T.SetupToken>;
    createPaymentToken(body: T.CreatePaymentTokenRequest, opts?: RequestOptions): Promise<T.PaymentToken>;
    getPaymentToken(paymentTokenId: string): Promise<T.PaymentToken>;
    listPaymentTokens(customerId: string): Promise<T.PaymentTokenList>;
    deletePaymentToken(paymentTokenId: string): Promise<void>;
  };
}

export type PayPalNamespace = Exclude<keyof PayPalApi, "mode">;
