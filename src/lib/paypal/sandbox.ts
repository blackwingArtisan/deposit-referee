/**
 * Real PayPal REST client — SANDBOX ONLY. The base URL is a constant; there is no option to
 * point it anywhere else, so live credentials simply fail with 401.
 */
import { randomUUID } from "node:crypto";
import type { PayPalApi, RequestOptions } from "./api";
import { PayPalApiError, PayPalNetworkError } from "./errors";
import { recordCallMeta } from "./meta";
import { OPERATIONS, operationPath, type OperationKey } from "./operations";
import type * as T from "./types";
import type { WebhookVerification } from "./webhooks";

export const SANDBOX_API_BASE = "https://api-m.sandbox.paypal.com" as const;

/** Kit-defined issue code: the app lacks the Transaction Search (reporting) scope. */
export const TRANSACTION_SEARCH_NOT_ENABLED = "TRANSACTION_SEARCH_NOT_ENABLED";

export interface SandboxConfig {
  clientId: string;
  clientSecret: string;
  webhookId?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

interface RequestInit_ {
  id?: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  form?: FormData;
  rawBody?: string;
  requestId?: string;
  prefer?: "return=representation" | "return=minimal";
  mockResponse?: RequestOptions["mockResponse"];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class SandboxPayPal implements PayPalApi {
  readonly mode = "sandbox" as const;
  private token?: { value: string; expiresAt: number };
  private tokenInflight?: Promise<string>;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly cfg: SandboxConfig) {
    this.fetchImpl = cfg.fetch ?? fetch;
    this.timeoutMs = cfg.timeoutMs ?? 25_000;
  }

  /** OAuth2 client-credentials token, cached until 2 minutes before expiry. */
  async getAccessToken(force = false): Promise<string> {
    if (!force && this.token && Date.now() < this.token.expiresAt) return this.token.value;
    if (this.tokenInflight) return this.tokenInflight;
    this.tokenInflight = (async () => {
      const basic = Buffer.from(`${this.cfg.clientId}:${this.cfg.clientSecret}`).toString("base64");
      let res: Response;
      try {
        res = await this.fetchImpl(`${SANDBOX_API_BASE}/v1/oauth2/token`, {
          method: "POST",
          headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
          body: "grant_type=client_credentials",
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (cause) {
        throw new PayPalNetworkError("Could not reach PayPal sandbox OAuth endpoint", "oauth.token", { cause });
      }
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw PayPalApiError.fromResponse(res.status, json, res.headers, "oauth.token");
      const { access_token, expires_in } = json as { access_token: string; expires_in: number };
      this.token = { value: access_token, expiresAt: Date.now() + Math.max(60, expires_in - 120) * 1000 };
      return access_token;
    })().finally(() => {
      this.tokenInflight = undefined;
    });
    return this.tokenInflight;
  }

  private async request<R>(op: OperationKey, init: RequestInit_ = {}): Promise<R> {
    const spec = OPERATIONS[op];
    const url = new URL(SANDBOX_API_BASE + operationPath(op, init.id));
    for (const [k, v] of Object.entries(init.query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));
    const isWrite = spec.method !== "GET";
    const requestId = isWrite ? (init.requestId ?? randomUUID()) : undefined;
    const maxAttempts = !isWrite ? 3 : "idempotent" in spec && spec.idempotent ? 2 : 1;
    let authRetried = false;

    for (let attempt = 1; ; attempt++) {
      const headers: Record<string, string> = { Authorization: `Bearer ${await this.getAccessToken()}`, Accept: "application/json" };
      if (init.body !== undefined || init.rawBody !== undefined) headers["Content-Type"] = "application/json";
      if (requestId) headers["PayPal-Request-Id"] = requestId;
      if (init.prefer) headers["Prefer"] = init.prefer;
      if (init.mockResponse) headers["PayPal-Mock-Response"] = JSON.stringify(init.mockResponse);

      let res: Response;
      try {
        res = await this.fetchImpl(url, {
          method: spec.method,
          headers,
          body: init.form ?? init.rawBody ?? (init.body !== undefined ? JSON.stringify(init.body) : undefined),
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (cause) {
        if (attempt < maxAttempts) {
          await sleep(400 * attempt);
          continue;
        }
        throw new PayPalNetworkError(`Network error calling PayPal ${spec.method} ${url.pathname}`, op, { cause });
      }

      const debugId = res.headers.get("paypal-debug-id") ?? undefined;
      recordCallMeta({ httpStatus: res.status, debugId, requestId });

      if (res.status === 401 && !authRetried) {
        authRetried = true;
        await this.getAccessToken(true);
        attempt--;
        continue;
      }
      if ((res.status === 429 || res.status >= 500) && attempt < maxAttempts) {
        await sleep(500 * attempt);
        continue;
      }
      if (res.status === 204) return undefined as R;
      const text = await res.text();
      let json: unknown = undefined;
      try {
        json = text ? JSON.parse(text) : undefined;
      } catch {
        json = text;
      }
      if (!res.ok) throw PayPalApiError.fromResponse(res.status, json, res.headers, op);
      return json as R;
    }
  }

  orders: PayPalApi["orders"] = {
    create: (body, opts) =>
      this.request("orders.create", { body, requestId: opts?.requestId, prefer: "return=representation", mockResponse: opts?.mockResponse }),
    get: (id) => this.request("orders.get", { id }),
    capture: (id, opts) =>
      this.request("orders.capture", { id, body: {}, requestId: opts?.requestId, prefer: "return=representation", mockResponse: opts?.mockResponse }),
    authorize: (id, opts) =>
      this.request("orders.authorize", { id, body: {}, requestId: opts?.requestId, prefer: "return=representation", mockResponse: opts?.mockResponse }),
  };

  payments: PayPalApi["payments"] = {
    getAuthorization: (id) => this.request("payments.getAuthorization", { id }),
    captureAuthorization: (id, body, opts) =>
      this.request("payments.captureAuthorization", { id, body: body ?? {}, requestId: opts?.requestId, prefer: "return=representation", mockResponse: opts?.mockResponse }),
    voidAuthorization: async (id, opts) => {
      const res = await this.request<T.Authorization | undefined>("payments.voidAuthorization", {
        id,
        requestId: opts?.requestId,
        prefer: "return=representation",
        mockResponse: opts?.mockResponse,
      });
      // 204 without a body is also valid; fetch the voided authorization so callers get a resource.
      return res ?? this.request<T.Authorization>("payments.getAuthorization", { id });
    },
    reauthorize: (id, body, opts) =>
      this.request("payments.reauthorize", { id, body: body ?? {}, requestId: opts?.requestId, prefer: "return=representation", mockResponse: opts?.mockResponse }),
    getCapture: (id) => this.request("payments.getCapture", { id }),
    refundCapture: (id, body, opts) =>
      this.request("payments.refundCapture", { id, body: body ?? {}, requestId: opts?.requestId, prefer: "return=representation", mockResponse: opts?.mockResponse }),
    getRefund: (id) => this.request("payments.getRefund", { id }),
  };

  payouts: PayPalApi["payouts"] = {
    create: (body, opts) => this.request("payouts.create", { body, requestId: opts?.requestId }),
    get: (id, query) => this.request("payouts.get", { id, query }),
  };

  invoicing: PayPalApi["invoicing"] = {
    generateNextNumber: () => this.request("invoicing.generateNextNumber", { body: {} }),
    create: async (body, opts) => {
      const res = await this.request<T.Invoice | T.Link>("invoicing.create", {
        body,
        requestId: opts?.requestId,
        prefer: "return=representation",
      });
      if ("id" in res && res.id) return res as T.Invoice;
      // Minimal response is a link to the new invoice; follow it.
      const href = (res as T.Link).href;
      const id = href?.split("/").pop();
      if (!id) throw new PayPalApiError({ status: 500, name: "UNEXPECTED_RESPONSE", message: "Invoice create returned no id" });
      return this.request<T.Invoice>("invoicing.get", { id });
    },
    send: (id, body) => this.request("invoicing.send", { id, body: body ?? { send_to_recipient: true } }),
    remind: (id, body) => this.request("invoicing.remind", { id, body: body ?? { send_to_recipient: true } }),
    cancel: (id, body) => this.request("invoicing.cancel", { id, body: body ?? { send_to_recipient: true } }),
    get: (id) => this.request("invoicing.get", { id }),
    list: (query) => this.request("invoicing.list", { query: { page: 1, page_size: 20, total_required: true, ...query } }),
    recordPayment: (id, body) => this.request("invoicing.recordPayment", { id, body }),
  };

  disputes: PayPalApi["disputes"] = {
    list: (query) =>
      this.request("disputes.list", {
        query: {
          ...query,
          dispute_state: Array.isArray(query?.dispute_state) ? query.dispute_state.join(",") : query?.dispute_state,
        },
      }),
    get: (id) => this.request("disputes.get", { id }),
    provideEvidence: (id, input, files = []) => {
      const form = new FormData();
      form.append("input", new Blob([JSON.stringify(input)], { type: "application/json" }));
      files.forEach((f, i) => form.append(`file${i + 1}`, new Blob([new Uint8Array(f.data)], { type: f.contentType }), f.name));
      return this.request("disputes.provideEvidence", { id, form });
    },
    // The integration guide sends JSON ({ note }); the OpenAPI schema lists multipart. JSON is what PayPal's own examples use.
    acceptClaim: (id, body) => this.request("disputes.acceptClaim", { id, body: body ?? {} }),
  };

  transactions: PayPalApi["transactions"] = {
    search: async (query) => {
      try {
        return await this.request<T.TransactionSearchResponse>("transactions.search", { query: { fields: "all", ...query } as Record<string, string | number> });
      } catch (e) {
        // Transaction Search needs the reporting scope, which a new sandbox app does not have.
        if (e instanceof PayPalApiError && e.status === 403) {
          throw new PayPalApiError({
            status: 403,
            name: e.paypalName,
            message:
              "Transaction Search is not enabled for this PayPal app (missing scope https://uri.paypal.com/services/reporting/search/read). " +
              "Enable it under the sandbox app's features in the PayPal Developer Dashboard; it can take hours to apply. Until then use the local ledger.",
            details: [{ issue: TRANSACTION_SEARCH_NOT_ENABLED, description: e.message }],
            debugId: e.debugId,
            operation: "transactions.search",
          });
        }
        throw e;
      }
    },
  };

  webhooks: PayPalApi["webhooks"] = {
    verify: async (headers, rawBody): Promise<WebhookVerification> => {
      const webhookId = this.cfg.webhookId;
      if (!webhookId) return { verified: false, status: "NOT_CONFIGURED", reason: "PAYPAL_WEBHOOK_ID is not set" };
      const h = (name: string) => headers.get(name) ?? "";
      if (!h("paypal-transmission-id")) return { verified: false, status: "FAILURE", reason: "Missing PayPal transmission headers" };
      // Embed the raw event verbatim: re-serializing parsed JSON can change bytes and fail verification.
      const rawJson =
        `{"auth_algo":${JSON.stringify(h("paypal-auth-algo"))},"cert_url":${JSON.stringify(h("paypal-cert-url"))},` +
        `"transmission_id":${JSON.stringify(h("paypal-transmission-id"))},"transmission_sig":${JSON.stringify(h("paypal-transmission-sig"))},` +
        `"transmission_time":${JSON.stringify(h("paypal-transmission-time"))},"webhook_id":${JSON.stringify(webhookId)},"webhook_event":${rawBody}}`;
      const res = await this.request<{ verification_status: "SUCCESS" | "FAILURE" }>("webhooks.verify", { rawBody: rawJson });
      return { verified: res.verification_status === "SUCCESS", status: res.verification_status };
    },
  };

  vault: PayPalApi["vault"] = {
    createSetupToken: (body, opts) => this.request("vault.createSetupToken", { body, requestId: opts?.requestId }),
    getSetupToken: (id) => this.request("vault.getSetupToken", { id }),
    createPaymentToken: (body, opts) => this.request("vault.createPaymentToken", { body, requestId: opts?.requestId }),
    getPaymentToken: (id) => this.request("vault.getPaymentToken", { id }),
    listPaymentTokens: (customerId) => this.request("vault.listPaymentTokens", { query: { customer_id: customerId } }),
    deletePaymentToken: (id) => this.request("vault.deletePaymentToken", { id }),
  };
}
