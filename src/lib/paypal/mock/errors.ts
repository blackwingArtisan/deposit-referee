/**
 * Errors the mock throws, using PayPal's standard names/messages and documented issue codes.
 * A few issue codes are not documented by PayPal; they are listed in MOCK_ONLY_ISSUES so app
 * code doesn't rely on them.
 */
import { PayPalApiError } from "../errors";
import { mockIds } from "./ids";

export const MOCK_ONLY_ISSUES = [
  "MULTI_PURCHASE_UNIT_NOT_SUPPORTED",
  "MAX_REAUTHORIZATIONS_EXCEEDED",
  "REAUTHORIZATION_AMOUNT_EXCEEDED",
  "INVALID_INVOICE_STATUS",
  "INVOICE_PAYMENT_EXCEEDS_DUE",
  "INVALID_DATE_RANGE",
  "ORDER_NOT_APPROVABLE",
] as const;

const info = (issue: string, api = "orders/v2") => ({
  href: `https://developer.paypal.com/docs/api/${api}/#error-${issue}`,
  rel: "information_link",
  method: "GET" as const,
});

export function apiError(status: number, name: string, message: string, issue?: string, description?: string, api?: string) {
  return new PayPalApiError({
    status,
    name,
    message,
    details: issue ? [{ issue, description }] : undefined,
    debugId: mockIds.debugId(),
    links: issue ? [info(issue, api)] : undefined,
  });
}

/** Payouts errors carry { field, issue } details where issue is human text. */
export function payoutsError(status: number, name: string, message: string, field: string, issue: string) {
  return new PayPalApiError({
    status,
    name,
    message,
    details: [{ field, issue, location: "body" }],
    debugId: mockIds.debugId(),
    links: [{ href: `https://developer.paypal.com/docs/api/payments.payouts-batch/v1/#error-${name}`, rel: "information_link", method: "GET" }],
  });
}

export const notFound = (what: string, id: string) =>
  apiError(
    404,
    "RESOURCE_NOT_FOUND",
    "The specified resource does not exist.",
    "INVALID_RESOURCE_ID",
    `Specified resource ID does not exist. Please check the resource ID and try again. (${what} ${id})`,
  );

export const unprocessable = (issue: string, description: string, api?: string) =>
  apiError(
    422,
    "UNPROCESSABLE_ENTITY",
    "The requested action could not be performed, semantically incorrect, or failed business validation.",
    issue,
    description,
    api,
  );

export const invalidRequest = (issue: string, description: string) =>
  apiError(400, "INVALID_REQUEST", "Request is not well-formed, syntactically incorrect, or violates schema.", issue, description);
