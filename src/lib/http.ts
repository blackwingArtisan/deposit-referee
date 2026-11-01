/**
 * Route handler wrapper used by every API route:
 *
 *   export const POST = route(async (req) => {
 *     const body = await readJson(req, z.object({ amount: z.string() }));
 *     return getPayPal().orders.create(...);          // plain values become JSON
 *   }, { rateLimit: "api" });
 *
 * It (1) opts out of prerendering (Cache Components), (2) tags timeline events with the
 * browser session (x-kit-session header) so each tab sees its own activity, (3) rate-limits,
 * (4) maps PayPal/AI/validation errors to JSON with the right status (and PayPal debug_id).
 */
import { connection, type NextRequest } from "next/server";
import { ZodError, type z } from "zod";
import { withContext } from "./events/bus";
import { getEnv, InvalidEnvError } from "./env";
import { PayPalApiError, PayPalNetworkError } from "./paypal/errors";
import { enforceRateLimit } from "./ai/rate-limit";
import { RateLimitedError } from "./ai/errors";

export const SESSION_HEADER = "x-kit-session";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code = "HTTP_ERROR",
  ) {
    super(message);
  }
}

export interface RouteOptions {
  /** "api" (default for non-GET), "ai" for routes that call Claude, false to skip. */
  rateLimit?: "ai" | "api" | false;
  /** 404 unless PAYPAL_MODE=mock (dev helpers). */
  mockOnly?: boolean;
}

export function errorResponse(error: unknown): Response {
  if (error instanceof PayPalApiError) {
    return Response.json({ error: { type: "paypal", ...error.toJSON() } }, { status: error.status >= 400 && error.status < 600 ? error.status : 502 });
  }
  if (error instanceof PayPalNetworkError) return Response.json({ error: { type: "paypal_network", message: error.message } }, { status: 502 });
  if (error instanceof ZodError) return Response.json({ error: { type: "validation", message: "Invalid request", issues: error.issues } }, { status: 400 });
  if (error instanceof RateLimitedError) {
    return Response.json({ error: { type: "rate_limited", message: error.message } }, { status: 429, headers: { "Retry-After": String(error.retryAfterSeconds) } });
  }
  if (error instanceof HttpError) return Response.json({ error: { type: error.code, message: error.message } }, { status: error.status });
  if (error instanceof InvalidEnvError) return Response.json({ error: { type: "config", message: error.message } }, { status: 500 });
  const e = error as { name?: string; message?: string; status?: number };
  const status = typeof e?.status === "number" && e.status >= 400 && e.status < 600 ? e.status : 500;
  if (status === 500) console.error("[api]", error);
  return Response.json({ error: { type: e?.name ?? "error", message: e?.message ?? "Unexpected error" } }, { status });
}

export function route<Ctx = { params: Promise<Record<string, string>> }>(
  handler: (req: NextRequest, ctx: Ctx) => Promise<unknown> | unknown,
  opts: RouteOptions = {},
) {
  return async (req: NextRequest, ctx: Ctx): Promise<Response> => {
    await connection();
    try {
      if (opts.mockOnly && getEnv().paypalMode !== "mock") throw new HttpError(404, "Only available in PAYPAL_MODE=mock", "not_found");
      const limit = opts.rateLimit ?? (req.method === "GET" ? false : "api");
      if (limit) enforceRateLimit(req, limit);
      const channel = req.headers.get(SESSION_HEADER) || "global";
      const result = await withContext({ channel, actor: "user" }, () => handler(req, ctx));
      if (result instanceof Response) return result;
      return Response.json(result ?? { ok: true });
    } catch (error) {
      return errorResponse(error);
    }
  };
}

export async function readJson<S extends z.ZodType>(req: Request, schema: S): Promise<z.infer<S>> {
  let raw: unknown = {};
  const text = await req.text();
  if (text) {
    try {
      raw = JSON.parse(text);
    } catch {
      throw new HttpError(400, "Body must be JSON", "invalid_json");
    }
  }
  return schema.parse(raw);
}

export const moneyValue = /^\d+(\.\d{1,2})?$/;
