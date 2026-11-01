/**
 * Per-IP fixed-window rate limiting for the hosted demo (in memory, per process).
 *
 *   enforceRateLimit(request, "ai");   // throws RateLimitedError -> 429
 *
 * Limits: AI_RATE_LIMIT_PER_MINUTE (default 8), AI_RATE_LIMIT_PER_DAY (default 150),
 * API_RATE_LIMIT_PER_MINUTE (default 120) for other mutating API routes.
 */
import { singleton } from "../singleton";
import { RateLimitedError } from "./errors";

type Window = { start: number; count: number };

const windows = singleton("ratelimit:windows", () => new Map<string, Window>());

function num(name: string, fallback: number) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? req.headers.get("cf-connecting-ip") ?? "local";
}

/** Returns seconds until retry when over the limit, or 0 when allowed (and counts the hit). */
export function hit(key: string, limit: number, windowMs: number, now = Date.now()): number {
  if (windows.size > 20_000) {
    for (const [k, w] of windows) if (now - w.start > 24 * 60 * 60 * 1000) windows.delete(k);
  }
  const w = windows.get(key);
  if (!w || now - w.start >= windowMs) {
    windows.set(key, { start: now, count: 1 });
    return 0;
  }
  if (w.count >= limit) return Math.ceil((w.start + windowMs - now) / 1000);
  w.count++;
  return 0;
}

export function enforceRateLimit(req: Request, kind: "ai" | "api" = "api") {
  const ip = clientIp(req);
  const checks: [string, number, number][] =
    kind === "ai"
      ? [
          [`ai:min:${ip}`, num("AI_RATE_LIMIT_PER_MINUTE", 8), 60_000],
          [`ai:day:${ip}`, num("AI_RATE_LIMIT_PER_DAY", 150), 24 * 60 * 60 * 1000],
        ]
      : [[`api:min:${ip}`, num("API_RATE_LIMIT_PER_MINUTE", 120), 60_000]];
  for (const [key, limit, windowMs] of checks) {
    const retry = hit(key, limit, windowMs);
    if (retry) throw new RateLimitedError(retry);
  }
}
