/**
 * PayPal REST shapes used by the kit. Checked against PayPal's OpenAPI schemas
 * (developer.paypal.com/api/{orders/v2,payments/v2,...}/schema.json) on 2026-10-25.
 * Only the fields apps need are typed; unknown extras pass through untouched.
 */
import type { Money } from "../money";

export type { Money };

export interface Link {
  href: string;
  rel: string;
  method?: "GET" | "POST" | "PUT" | "DELETE" | "HEAD" | "CONNECT" | "OPTIONS" | "PATCH";
}

// ───────────────────────────── Orders v2 ─────────────────────────────

export type OrderIntent = "CAPTURE" | "AUTHORIZE";
export type OrderStatus = "CREATED" | "SAVED" | "APPROVED" | "VOIDED" | "COMPLETED" | "PAYER_ACTION_REQUIRED";

export type UsagePattern =
  | "IMMEDIATE"
  | "DEFERRED"
  | "RECURRING_PREPAID"
  | "RECURRING_POSTPAID"
  | "THRESHOLD_PREPAID"
  | "THRESHOLD_POSTPAID"
  | "SUBSCRIPTION_PREPAID"
  | "SUBSCRIPTION_POSTPAID"
  | "UNSCHEDULED_PREPAID"
  | "UNSCHEDULED_POSTPAID"
  | "INSTALLMENT_PREPAID"
  | "INSTALLMENT_POSTPAID";

export interface AmountBreakdown {
  item_total?: Money;
  shipping?: Money;
  handling?: Money;
  tax_total?: Money;
  insurance?: Money;
  shipping_discount?: Money;
  discount?: Money;
}

export interface OrderItem {
  name: string;
  unit_amount: Money;
  quantity: string;
  tax?: Money;
  description?: string;
  sku?: string;
  category?: "DIGITAL_GOODS" | "PHYSICAL_GOODS" | "DONATION" | string;
  url?: string;
  image_url?: string;
}

export interface PurchaseUnitRequest {
  reference_id?: string;
  amount: Money & { breakdown?: AmountBreakdown };
  payee?: { email_address?: string; merchant_id?: string };
  description?: string;
  custom_id?: string;
  invoice_id?: string;
  soft_descriptor?: string;
  items?: OrderItem[];
  shipping?: Record<string, unknown>;
}

export interface ExperienceContext {
  brand_name?: string;
  locale?: string;
  return_url?: string;
  cancel_url?: string;
  user_action?: "CONTINUE" | "PAY_NOW";
  shipping_preference?: "GET_FROM_FILE" | "NO_SHIPPING" | "SET_PROVIDED_ADDRESS";
  landing_page?: "LOGIN" | "GUEST_CHECKOUT" | "NO_PREFERENCE";
  payment_method_preference?: "UNRESTRICTED" | "IMMEDIATE_PAYMENT_REQUIRED";
}

export interface StoredCredential {
  payment_initiator: "CUSTOMER" | "MERCHANT";
  usage?: "FIRST" | "SUBSEQUENT" | "DERIVED";
  usage_pattern?: UsagePattern;
}

export interface PayPalWalletRequest {
  /** Charge a saved PayPal payment token (Vault v3) without the buyer present. */
  vault_id?: string;
  email_address?: string;
  experience_context?: ExperienceContext;
  attributes?: {
    customer?: { id?: string; merchant_customer_id?: string };
    vault?: {
      store_in_vault?: "ON_SUCCESS";
      usage_type: "MERCHANT" | "PLATFORM";
      customer_type?: "CONSUMER" | "BUSINESS";
      description?: string;
      usage_pattern?: UsagePattern;
      permit_multiple_payment_tokens?: boolean;
    };
  };
  stored_credential?: StoredCredential;
}

/** Direct card payment. Only ever PayPal's sandbox test card: see paypal/test-card.ts. */
export interface CardRequest {
  number: string;
  expiry: string;
  security_code?: string;
  name?: string;
  billing_address?: Record<string, string>;
}

export interface CreateOrderRequest {
  intent: OrderIntent;
  purchase_units: PurchaseUnitRequest[];
  payment_source?: { paypal?: PayPalWalletRequest; card?: CardRequest };
  processing_instruction?: "ORDER_COMPLETE_ON_PAYMENT_APPROVAL";
}

export interface Payer {
  payer_id: string;
  email_address?: string;
  name?: { given_name?: string; surname?: string };
  address?: { country_code?: string };
}

export type AuthorizationStatus = "CREATED" | "CAPTURED" | "DENIED" | "PARTIALLY_CAPTURED" | "VOIDED" | "PENDING";

export interface SellerProtection {
  status: "ELIGIBLE" | "PARTIALLY_ELIGIBLE" | "NOT_ELIGIBLE";
  dispute_categories?: ("ITEM_NOT_RECEIVED" | "UNAUTHORIZED_TRANSACTION")[];
}

export interface Authorization {
  id: string;
  status: AuthorizationStatus;
  status_details?: { reason: "PENDING_REVIEW" | "DECLINED_BY_RISK_FRAUD_FILTERS" };
  amount: Money;
  invoice_id?: string;
  custom_id?: string;
  seller_protection?: SellerProtection;
  /** End of the 29-day validity window. The 3-day honor period is not exposed by the API. */
  expiration_time: string;
  create_time: string;
  update_time: string;
  links: Link[];
  supplementary_data?: { related_ids: { order_id: string } };
  payee?: { email_address?: string; merchant_id?: string };
}

export type CaptureStatus = "COMPLETED" | "DECLINED" | "PARTIALLY_REFUNDED" | "PENDING" | "REFUNDED" | "FAILED";

export interface SellerReceivableBreakdown {
  gross_amount: Money;
  paypal_fee?: Money;
  net_amount: Money;
}

export interface Capture {
  id: string;
  status: CaptureStatus;
  status_details?: { reason: string };
  amount: Money;
  final_capture: boolean;
  disbursement_mode?: "INSTANT" | "DELAYED";
  seller_protection?: SellerProtection;
  seller_receivable_breakdown?: SellerReceivableBreakdown;
  invoice_id?: string;
  custom_id?: string;
  note_to_payer?: string;
  supplementary_data?: { related_ids: { order_id?: string; authorization_id?: string } };
  links: Link[];
  create_time: string;
  update_time: string;
}

export type RefundStatus = "CANCELLED" | "FAILED" | "PENDING" | "COMPLETED";

export interface Refund {
  id: string;
  status: RefundStatus;
  status_details?: { reason: string };
  amount: Money;
  invoice_id?: string;
  custom_id?: string;
  note_to_payer?: string;
  seller_payable_breakdown?: {
    gross_amount: Money;
    paypal_fee: Money;
    net_amount: Money;
    total_refunded_amount: Money;
  };
  links: Link[];
  create_time: string;
  update_time: string;
}

export interface PurchaseUnit extends PurchaseUnitRequest {
  reference_id: string;
  payments?: { authorizations?: Authorization[]; captures?: Capture[]; refunds?: Refund[] };
}

export interface VaultAttributeResponse {
  id?: string;
  status: "VAULTED" | "APPROVED" | "CREATED";
  customer?: { id: string };
  links?: Link[];
}

export interface Order {
  id: string;
  status: OrderStatus;
  intent?: OrderIntent;
  payment_source?: {
    paypal?: {
      email_address?: string;
      account_id?: string;
      account_status?: "VERIFIED" | "UNVERIFIED";
      name?: { given_name?: string; surname?: string };
      attributes?: { vault?: VaultAttributeResponse };
    };
    card?: { name?: string; last_digits?: string; brand?: string };
  };
  purchase_units?: PurchaseUnit[];
  payer?: Payer;
  create_time?: string;
  update_time?: string;
  links: Link[];
}

// ───────────────────────────── Payments v2 ─────────────────────────────

export interface CaptureAuthorizationRequest {
  /** Omit to capture the full remaining amount. */
  amount?: Money;
  /** true = no further captures allowed on this authorization. Default false. */
  final_capture?: boolean;
  invoice_id?: string;
  note_to_payer?: string;
  soft_descriptor?: string;
}

export interface ReauthorizeRequest {
  amount?: Money;
}

export interface RefundRequest {
  /** Omit for a full refund of what is left on the capture. */
  amount?: Money;
  invoice_id?: string;
  custom_id?: string;
  note_to_payer?: string;
}

// ───────────────────────────── Payouts v1 ─────────────────────────────
// NOTE: Payouts uses `currency`, not `currency_code`.

export interface PayoutAmount {
  currency: string;
  value: string;
}

export type RecipientType = "EMAIL" | "PHONE" | "PAYPAL_ID";

export interface PayoutItemRequest {
  recipient_type?: RecipientType;
  amount: PayoutAmount;
  receiver: string;
  note?: string;
  sender_item_id?: string;
  recipient_wallet?: "PAYPAL" | "VENMO";
  purpose?: "AWARDS" | "PRIZES" | "DONATIONS" | "GOODS" | "SERVICES" | "REBATES" | "CASHBACK" | "DISCOUNTS" | "NON_GOODS_OR_SERVICES";
}

export interface CreatePayoutRequest {
  sender_batch_header: {
    sender_batch_id?: string;
    email_subject?: string;
    email_message?: string;
    recipient_type?: RecipientType;
    note?: string;
  };
  items: PayoutItemRequest[];
}

export type PayoutBatchStatus = "DENIED" | "PENDING" | "PROCESSING" | "SUCCESS" | "CANCELED";
export type PayoutItemStatus =
  | "SUCCESS"
  | "FAILED"
  | "PENDING"
  | "UNCLAIMED"
  | "RETURNED"
  | "ONHOLD"
  | "BLOCKED"
  | "REFUNDED"
  | "REVERSED";

export interface PayoutBatchHeader {
  payout_batch_id: string;
  batch_status: PayoutBatchStatus;
  time_created?: string;
  time_completed?: string;
  time_closed?: string;
  sender_batch_header: CreatePayoutRequest["sender_batch_header"];
  funding_source?: "BALANCE";
  amount?: PayoutAmount;
  fees?: PayoutAmount;
}

export interface CreatePayoutResponse {
  batch_header: Pick<PayoutBatchHeader, "payout_batch_id" | "batch_status" | "time_created" | "sender_batch_header">;
  links: Link[];
}

export interface PayoutItem {
  payout_item_id: string;
  transaction_id?: string;
  activity_id?: string;
  transaction_status: PayoutItemStatus;
  payout_item_fee?: PayoutAmount;
  payout_batch_id: string;
  payout_item: PayoutItemRequest;
  time_processed?: string;
  errors?: { name: string; message: string };
  links: Link[];
}

export interface PayoutBatch {
  batch_header: PayoutBatchHeader;
  items: PayoutItem[];
  total_items?: number;
  total_pages?: number;
  links: Link[];
}

// ───────────────────────────── Invoicing v2 ─────────────────────────────

export type InvoiceStatus =
  | "DRAFT"
  | "SENT"
  | "SCHEDULED"
  | "PAID"
  | "MARKED_AS_PAID"
  | "CANCELLED"
  | "REFUNDED"
  | "PARTIALLY_PAID"
  | "PARTIALLY_REFUNDED"
  | "MARKED_AS_REFUNDED"
  | "UNPAID"
  | "PAYMENT_PENDING"
  | "AUTO_CANCELLED";

export type PaymentTermType =
  | "DUE_ON_RECEIPT"
  | "DUE_ON_DATE_SPECIFIED"
  | "NET_10"
  | "NET_15"
  | "NET_30"
  | "NET_45"
  | "NET_60"
  | "NET_90"
  | "NO_DUE_DATE";

export interface InvoiceItem {
  name: string;
  quantity: string;
  unit_amount: Money;
  description?: string;
  tax?: { name: string; percent: string; amount?: Money };
  discount?: { percent?: string; amount?: Money };
  item_date?: string;
  unit_of_measure?: "QUANTITY" | "HOURS" | "AMOUNT";
}

export interface InvoiceRecipient {
  billing_info?: {
    name?: { given_name?: string; surname?: string };
    email_address?: string;
    business_name?: string;
  };
  shipping_info?: Record<string, unknown>;
}

export interface CreateInvoiceRequest {
  detail: {
    currency_code: string;
    invoice_number?: string;
    reference?: string;
    invoice_date?: string;
    note?: string;
    terms_and_conditions?: string;
    memo?: string;
    payment_term?: { term_type?: PaymentTermType; due_date?: string };
  };
  invoicer?: {
    business_name?: string;
    name?: { given_name?: string; surname?: string };
    email_address?: string;
    website?: string;
    logo_url?: string;
  };
  primary_recipients?: InvoiceRecipient[];
  additional_recipients?: string[];
  items: InvoiceItem[];
  configuration?: {
    tax_calculated_after_discount?: boolean;
    tax_inclusive?: boolean;
    allow_tip?: boolean;
    partial_payment?: { allow_partial_payment: boolean; minimum_amount_due?: Money };
  };
}

export interface InvoicePaymentTransaction {
  payment_id?: string;
  method: InvoicePaymentMethod;
  type?: "PAYPAL" | "EXTERNAL";
  payment_date?: string;
  amount: Money;
  note?: string;
}

export interface Invoice extends Omit<CreateInvoiceRequest, "detail"> {
  id: string;
  status: InvoiceStatus;
  detail: CreateInvoiceRequest["detail"] & {
    invoice_number: string;
    metadata?: { create_time?: string; last_update_time?: string; recipient_view_url?: string; invoicer_view_url?: string };
  };
  amount: Money & { breakdown?: { item_total?: Money; tax_total?: Money; discount?: Record<string, unknown> } };
  due_amount?: Money;
  payments?: { paid_amount: Money; transactions: InvoicePaymentTransaction[] };
  links: Link[];
}

export type InvoicePaymentMethod =
  | "BANK_TRANSFER"
  | "CASH"
  | "CHECK"
  | "CREDIT_CARD"
  | "DEBIT_CARD"
  | "PAYPAL"
  | "WIRE_TRANSFER"
  | "OTHER";

export interface InvoiceNotificationRequest {
  send_to_invoicer?: boolean;
  send_to_recipient?: boolean;
  additional_recipients?: string[];
  subject?: string;
  note?: string;
}

export interface RecordInvoicePaymentRequest {
  method: InvoicePaymentMethod;
  payment_date?: string;
  amount?: Money;
  note?: string;
  type?: "PAYPAL" | "EXTERNAL";
  payment_id?: string;
}

export interface InvoiceList {
  items: Invoice[];
  total_items?: number;
  total_pages?: number;
  links: Link[];
}

// ───────────────────────────── Disputes v1 ─────────────────────────────

export type DisputeReason =
  | "MERCHANDISE_OR_SERVICE_NOT_RECEIVED"
  | "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED"
  | "UNAUTHORISED"
  | "CREDIT_NOT_PROCESSED"
  | "DUPLICATE_TRANSACTION"
  | "INCORRECT_AMOUNT"
  | "PAYMENT_BY_OTHER_MEANS"
  | "CANCELED_RECURRING_BILLING"
  | "PROBLEM_WITH_REMITTANCE"
  | "OTHER";
export type DisputeStatus =
  | "OPEN"
  | "WAITING_FOR_BUYER_RESPONSE"
  | "WAITING_FOR_SELLER_RESPONSE"
  | "UNDER_REVIEW"
  | "RESOLVED"
  | "OTHER";
export type DisputeState =
  | "OPEN_INQUIRIES"
  | "REQUIRED_ACTION"
  | "REQUIRED_OTHER_PARTY_ACTION"
  | "UNDER_PAYPAL_REVIEW"
  | "APPEALABLE"
  | "RESOLVED";
export type DisputeLifeCycleStage = "INQUIRY" | "CHARGEBACK" | "PRE_ARBITRATION" | "ARBITRATION";
export type AcceptClaimType = "REFUND" | "REFUND_WITH_RETURN" | "PARTIAL_REFUND" | "REFUND_WITH_RETURN_SHIPMENT_LABEL";

export interface DisputeSummary {
  dispute_id: string;
  create_time: string;
  update_time: string;
  reason: DisputeReason;
  status: DisputeStatus;
  dispute_state: DisputeState;
  dispute_amount: Money;
  dispute_life_cycle_stage: DisputeLifeCycleStage;
  dispute_channel: "INTERNAL" | "EXTERNAL" | "ALERT";
  buyer_response_due_date?: string;
  seller_response_due_date?: string;
  links: Link[];
}

export interface DisputeEvidence {
  evidence_type: "PROOF_OF_FULFILLMENT" | "PROOF_OF_REFUND" | "OTHER" | string;
  evidence_info?: {
    tracking_info?: { carrier_name: string; tracking_number: string }[];
    refund_ids?: string[];
  };
  documents?: { name: string; url?: string }[];
  notes?: string;
  source?: string;
  date?: string;
}

export interface Dispute extends DisputeSummary {
  disputed_transactions: {
    buyer_transaction_id?: string;
    seller_transaction_id?: string;
    create_time?: string;
    transaction_status?: string;
    gross_amount?: Money;
    invoice_number?: string;
    custom?: string;
    buyer?: { name?: string; email?: string };
    seller?: { email?: string; merchant_id?: string };
  }[];
  dispute_outcome?: {
    outcome_code:
      | "RESOLVED_BUYER_FAVOUR"
      | "RESOLVED_SELLER_FAVOUR"
      | "RESOLVED_WITH_PAYOUT"
      | "CANCELED_BY_BUYER"
      | "ACCEPTED"
      | "DENIED"
      | "NONE";
    amount_refunded?: Money;
  };
  evidences?: DisputeEvidence[];
  allowed_response_options?: { accept_claim?: { accept_claim_types: AcceptClaimType[] } };
  messages?: { posted_by: "BUYER" | "SELLER"; time_posted: string; content: string; documents?: { name: string; url?: string }[] }[];
}

export interface DisputeList {
  items: DisputeSummary[];
  links: Link[];
}

export interface ListDisputesQuery {
  dispute_state?: DisputeState | DisputeState[];
  disputed_transaction_id?: string;
  page_size?: number;
  page?: number;
  update_time_after?: string;
}

export interface AcceptClaimRequest {
  note?: string;
  accept_claim_type?: AcceptClaimType;
  refund_amount?: Money;
}

export interface EvidenceFile {
  name: string;
  contentType: "application/pdf" | "image/png" | "image/jpeg" | "image/gif";
  data: Uint8Array;
}

// ───────────────────────────── Transaction Search v1 ─────────────────────────────

export type TransactionStatusCode = "D" | "P" | "S" | "V";

export interface TransactionSearchQuery {
  /** RFC 3339 with seconds. Max range 31 days. */
  start_date: string;
  end_date: string;
  transaction_id?: string;
  transaction_status?: TransactionStatusCode;
  transaction_type?: string;
  fields?: string;
  page_size?: number;
  page?: number;
  balance_affecting_records_only?: "Y" | "N";
}

export interface TransactionInfo {
  paypal_account_id?: string;
  transaction_id: string;
  paypal_reference_id?: string;
  paypal_reference_id_type?: "ODR" | "TXN" | "SUB" | "PAP";
  transaction_event_code: string;
  transaction_initiation_date: string;
  transaction_updated_date: string;
  transaction_amount: Money;
  fee_amount?: Money;
  transaction_status: TransactionStatusCode;
  transaction_subject?: string;
  transaction_note?: string;
  invoice_id?: string;
  custom_field?: string;
  protection_eligibility?: "01" | "02" | "03";
}

export interface TransactionSearchResponse {
  transaction_details: { transaction_info: TransactionInfo; payer_info?: { email_address?: string; account_id?: string } }[];
  account_number: string;
  start_date: string;
  end_date: string;
  last_refreshed_datetime: string;
  page: number;
  total_items: number;
  total_pages: number;
  links: Link[];
}

// ───────────────────────────── Vault v3 ─────────────────────────────

export interface CreateSetupTokenRequest {
  customer?: { id?: string; merchant_customer_id?: string };
  payment_source: {
    paypal: {
      description?: string;
      usage_pattern?: UsagePattern;
      usage_type?: "MERCHANT" | "PLATFORM";
      customer_type?: "CONSUMER" | "BUSINESS";
      permit_multiple_payment_tokens?: boolean;
      experience_context?: {
        return_url?: string;
        cancel_url?: string;
        brand_name?: string;
        locale?: string;
        shipping_preference?: "GET_FROM_FILE" | "NO_SHIPPING" | "SET_PROVIDED_ADDRESS";
      };
    };
  };
}

export type SetupTokenStatus = "CREATED" | "PAYER_ACTION_REQUIRED" | "APPROVED" | "VAULTED" | "TOKENIZED";

export interface SetupToken {
  id: string;
  customer?: { id: string };
  status: SetupTokenStatus;
  payment_source: Record<string, unknown>;
  links: Link[];
}

export interface CreatePaymentTokenRequest {
  customer?: { id?: string };
  payment_source: { token: { id: string; type: "SETUP_TOKEN" } };
}

export interface PaymentToken {
  id: string;
  customer: { id: string; merchant_customer_id?: string };
  payment_source: { paypal?: { email_address?: string; payer_id?: string; description?: string; usage_type?: string } };
  links: Link[];
}

export interface PaymentTokenList {
  customer: { id: string };
  payment_tokens: PaymentToken[];
  total_items?: number;
  total_pages?: number;
  links: Link[];
}

// ───────────────────────────── Webhooks ─────────────────────────────

export interface WebhookEventEnvelope<TType extends string = string, TResource = unknown> {
  id: string;
  event_version: string;
  create_time: string;
  resource_type: string;
  resource_version?: string;
  event_type: TType;
  summary: string;
  resource: TResource;
  links: Link[];
}

export interface WebhookHeaders {
  "paypal-transmission-id": string;
  "paypal-transmission-time": string;
  "paypal-transmission-sig": string;
  "paypal-cert-url": string;
  "paypal-auth-algo": string;
}
