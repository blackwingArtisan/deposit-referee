/**
 * The photo comparison and the settlement agent call Claude. When that fails, the host sees what
 * happened in plain words and what to do next, never the API's JSON or a request id. Server only.
 */
import { AiCreditError, RateLimitedError } from "@/lib/ai/errors";
import { HttpError } from "@/lib/http";

const NOTHING_MOVED = "Nothing was charged and the deposit is still on hold.";

export const AI_UNREADABLE_PHOTO = `Claude couldn't read one of the photos. Replace it with a clear JPEG, PNG or WebP photo and compare again. ${NOTHING_MOVED}`;
export const AI_BUSY = `Claude is busy right now. Wait a minute and try again. ${NOTHING_MOVED}`;
export const AI_DIDNT_FINISH = `The photo comparison didn't finish. ${NOTHING_MOVED} Try again, or replace a photo.`;

function words(error: unknown): { message: string; status?: number } {
  const e = error as { message?: unknown; status?: unknown } | null;
  return { message: typeof e?.message === "string" ? e.message : String(error), status: typeof e?.status === "number" ? e.status : undefined };
}

/** An error from the photo comparison, as the host should see it. */
export function plainAiError(error: unknown): Error {
  if (error instanceof HttpError || error instanceof RateLimitedError || error instanceof AiCreditError) return error;
  const { message, status } = words(error);
  if (/could not process image|invalid.*image|image.*(invalid|corrupt|unsupported)/i.test(message)) return new HttpError(422, AI_UNREADABLE_PHOTO, "photo_unreadable");
  if (status === 429 || status === 529 || /overloaded|rate.?limit/i.test(message)) return new HttpError(503, AI_BUSY, "ai_busy");
  return new HttpError(502, AI_DIDNT_FINISH, "ai_error");
}

/** The settlement agent's stop reason, without raw JSON or request ids. Plain reasons pass through. */
export function plainAgentError(reason: string): string {
  const raw = /[{}[\]]|req_[A-Za-z0-9]+|request[_ ]id|^\d{3}\b/i.test(reason);
  if (!raw) return reason;
  if (/could not process image/i.test(reason)) return AI_UNREADABLE_PHOTO;
  if (/overloaded|rate.?limit|\b(429|529)\b/i.test(reason)) return AI_BUSY;
  return `The settlement agent stopped before it made a proposal. ${NOTHING_MOVED} Ask it again.`;
}
