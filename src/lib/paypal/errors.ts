import type { Link } from "./types";

export interface PayPalErrorDetail {
  issue: string;
  description?: string;
  field?: string;
  value?: string;
  location?: "body" | "path" | "query";
}

/**
 * Normalized PayPal API error. Same class for sandbox and mock so app code handles both.
 *
 *   catch (e) { if (isPayPalError(e, "AUTHORIZATION_ALREADY_CAPTURED")) ... }
 *
 * `name` is PayPal's error name (UNPROCESSABLE_ENTITY, RESOURCE_NOT_FOUND...), `issue` is the
 * first details[].issue (the specific reason), `debugId` is what PayPal support asks for.
 */
export class PayPalApiError extends Error {
  readonly status: number;
  readonly paypalName: string;
  readonly issue?: string;
  readonly details: PayPalErrorDetail[];
  readonly debugId?: string;
  readonly links: Link[];
  readonly operation?: string;

  constructor(init: {
    status: number;
    name: string;
    message: string;
    details?: PayPalErrorDetail[];
    debugId?: string;
    links?: Link[];
    operation?: string;
  }) {
    const issue = init.details?.[0]?.issue;
    super(issue ? `${init.message} [${issue}]` : init.message);
    this.name = "PayPalApiError";
    this.status = init.status;
    this.paypalName = init.name;
    this.details = init.details ?? [];
    this.issue = issue;
    this.debugId = init.debugId;
    this.links = init.links ?? [];
    this.operation = init.operation;
  }

  /** Parses REST errors ({name,message,debug_id,details}) and OAuth errors ({error,error_description}). */
  static fromResponse(status: number, body: unknown, headers?: Headers, operation?: string): PayPalApiError {
    const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
    const debugId = (b.debug_id as string | undefined) ?? headers?.get("paypal-debug-id") ?? undefined;
    if (typeof b.error === "string") {
      return new PayPalApiError({
        status,
        name: b.error.toUpperCase(),
        message: (b.error_description as string) ?? b.error,
        debugId,
        operation,
      });
    }
    return new PayPalApiError({
      status,
      name: (b.name as string) ?? `HTTP_${status}`,
      message: (b.message as string) ?? (typeof body === "string" && body ? body.slice(0, 300) : `PayPal returned HTTP ${status}`),
      details: Array.isArray(b.details) ? (b.details as PayPalErrorDetail[]) : undefined,
      debugId,
      links: Array.isArray(b.links) ? (b.links as Link[]) : undefined,
      operation,
    });
  }

  toJSON() {
    return {
      name: this.paypalName,
      message: this.message,
      status: this.status,
      issue: this.issue,
      details: this.details,
      debug_id: this.debugId,
      operation: this.operation,
    };
  }
}

export function isPayPalError(error: unknown, issueOrName?: string): error is PayPalApiError {
  if (!(error instanceof PayPalApiError)) return false;
  if (!issueOrName) return true;
  return (
    error.issue === issueOrName ||
    error.paypalName === issueOrName ||
    error.details.some((d) => d.issue === issueOrName)
  );
}

/** Network failure, timeout, or non-JSON response before PayPal could answer. */
export class PayPalNetworkError extends Error {
  constructor(message: string, readonly operation?: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "PayPalNetworkError";
  }
}
