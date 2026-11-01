/**
 * The one place for model choice, prices and per-feature defaults.
 * Prices: USD per 1M tokens, Anthropic first-party rates (checked 2026-10-25).
 */

export const AI_MODELS = {
  /** Fast + cheap: extraction, classification, chat, the agent loop. */
  default: "claude-haiku-5-5",
  /** Vision (photos, receipts, image comparison) and hard reasoning. */
  smart: "claude-sonnet-5-5",
} as const;

export type ModelRole = keyof typeof AI_MODELS;
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface ModelPrice {
  input: number;
  output: number;
  /** Haiku 5.5 bills prompts above this many tokens at the long-context rate. */
  longContextThreshold?: number;
  longInput?: number;
  longOutput?: number;
}

export const PRICING: Record<string, ModelPrice> = {
  "claude-haiku-5-5": { input: 0.1, output: 0.5, longContextThreshold: 100_000, longInput: 0.5, longOutput: 2.5 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  // Server-side fallback target for Sonnet 5.5 refusals.
  "claude-sonnet-5": { input: 2, output: 10 },
  "claude-opus-5-5": { input: 4, output: 20 },
};

/** Price used when the API reports a model we don't know: assume the expensive end. */
export const UNKNOWN_MODEL_PRICE: ModelPrice = { input: 10, output: 50 };

export const CACHE_READ_MULTIPLIER = 0.1;
export const CACHE_WRITE_MULTIPLIER = 1.25;

/**
 * Server-side refusal fallback (`fallbacks: "default"`) is available for Sonnet 5.5 on the
 * Claude API; Haiku 5.5 has none (sending it would be pointless).
 */
export const SERVER_FALLBACK: Record<string, { beta: string }> = {
  "claude-sonnet-5-5": { beta: "server-side-fallback-2026-07-01" },
};

export const FEATURE_DEFAULTS = {
  structured: { role: "default" as ModelRole, maxTokens: 8192, effort: "medium" as Effort },
  vision: { role: "smart" as ModelRole, maxTokens: 8192, effort: "medium" as Effort },
  stream: { role: "default" as ModelRole, maxTokens: 4096, effort: "low" as Effort },
  agent: { role: "default" as ModelRole, maxTokens: 8192, effort: "medium" as Effort },
};

/** Worst-case tokens assumed per image when estimating cost before a call. */
export const IMAGE_TOKEN_ESTIMATE = 5000;

export function resolveModel(roleOrId: ModelRole | string | undefined, fallbackRole: ModelRole): string {
  if (!roleOrId) return AI_MODELS[fallbackRole];
  return roleOrId in AI_MODELS ? AI_MODELS[roleOrId as ModelRole] : roleOrId;
}

export function modelLabel(model: string): string {
  const m = /^claude-(\w+)-(\d+)-(\d+)$/.exec(model);
  return m ? `Claude ${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}.${m[3]}` : model;
}
