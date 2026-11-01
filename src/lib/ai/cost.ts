/**
 * Cost estimation. Before a call we compute a deliberately pessimistic worst case
 * (input estimate + the full max_tokens of output, doubled when a refusal fallback could
 * run a second model); after the call we compute the real cost from `usage`.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { CACHE_READ_MULTIPLIER, CACHE_WRITE_MULTIPLIER, IMAGE_TOKEN_ESTIMATE, PRICING, SERVER_FALLBACK, UNKNOWN_MODEL_PRICE, type ModelPrice } from "./config";

export function priceFor(model: string): ModelPrice {
  return PRICING[model] ?? UNKNOWN_MODEL_PRICE;
}

function rates(price: ModelPrice, promptTokens: number) {
  if (price.longContextThreshold && promptTokens > price.longContextThreshold) {
    return { input: price.longInput ?? price.input, output: price.longOutput ?? price.output };
  }
  return { input: price.input, output: price.output };
}

/** Conservative token estimate (~3 chars/token, images at a fixed worst case). */
export function estimateInputTokens(payload: { system?: unknown; messages: unknown; tools?: unknown }): number {
  let images = 0;
  const json = JSON.stringify(payload, (key, value) => {
    if (value && typeof value === "object" && (value as { type?: string }).type === "image") {
      images++;
      return "[image]";
    }
    return value;
  });
  return Math.ceil(json.length / 3) + images * IMAGE_TOKEN_ESTIMATE + 64;
}

export function worstCaseCostUsd(model: string, inputTokens: number, maxTokens: number): number {
  const r = rates(priceFor(model), inputTokens);
  const single = (inputTokens * r.input + maxTokens * r.output) / 1_000_000;
  // With server-side fallback a declined attempt can be billed and then re-run.
  return SERVER_FALLBACK[model] ? single * 2 : single;
}

interface UsageLike {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

function usageCost(model: string, u: UsageLike): number {
  const prompt = u.input_tokens + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
  const r = rates(priceFor(model), prompt);
  return (
    (u.input_tokens * r.input +
      (u.cache_creation_input_tokens ?? 0) * r.input * CACHE_WRITE_MULTIPLIER +
      (u.cache_read_input_tokens ?? 0) * r.input * CACHE_READ_MULTIPLIER +
      u.output_tokens * r.output) /
    1_000_000
  );
}

/** Real cost of a finished message, per sampling iteration when the API reports them. */
export function actualCostUsd(message: Pick<Anthropic.Beta.BetaMessage, "model" | "usage">): number {
  const iterations = message.usage.iterations?.filter((i) => i.type !== "compaction") ?? [];
  if (iterations.length) {
    return iterations.reduce((sum, it) => {
      const model = "model" in it && typeof it.model === "string" ? it.model : message.model;
      return sum + usageCost(model, it as UsageLike);
    }, 0);
  }
  return usageCost(message.model, message.usage);
}
