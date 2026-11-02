/**
 * Anthropic client + the guarded call path every AI helper uses:
 *   worst-case estimate -> daily cap reservation -> call -> refusal check -> real cost -> timeline
 *
 * All calls go through `client.beta.messages` so Sonnet 5.5 requests can carry the
 * server-side refusal fallback (beta) without mixing beta and non-beta types.
 */
import Anthropic from "@anthropic-ai/sdk";
import { getEnv } from "../env";
import { startStep } from "../events/bus";
import { singleton } from "../singleton";
import { getBudget } from "./budget";
import { modelLabel, SERVER_FALLBACK } from "./config";
import { actualCostUsd, estimateInputTokens, worstCaseCostUsd } from "./cost";
import { AiBudgetExceededError, AiCreditError, AiRefusalError, AiUnavailableError } from "./errors";

export type BetaCreateParams = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
export type BetaMessage = Anthropic.Beta.BetaMessage;
export type BetaMessageParam = Anthropic.Beta.BetaMessageParam;

export function isAiLive(): boolean {
  return getEnv().aiMode === "live";
}

export function getAnthropic(): Anthropic {
  const env = getEnv();
  if (env.aiMode !== "live") throw new AiUnavailableError();
  return singleton("ai:client", () => new Anthropic({ apiKey: env.anthropicApiKey, maxRetries: 2, timeout: 120_000 }));
}

/** Adds the server-side refusal fallback where the model supports it (Sonnet 5.5). */
export function withServerFallback<P extends { model: string; betas?: Anthropic.Beta.AnthropicBeta[] }>(params: P): P {
  const fb = SERVER_FALLBACK[params.model];
  if (!fb) return params;
  return { ...params, betas: [...new Set([...(params.betas ?? []), fb.beta])], fallbacks: "default" } as P;
}

export function assertNotRefused(message: Pick<BetaMessage, "stop_reason" | "stop_details">) {
  if (message.stop_reason === "refusal") {
    const details = message.stop_details as { category?: string | null; explanation?: string | null } | null;
    throw new AiRefusalError(details?.category ?? null, details?.explanation);
  }
}

/** Anthropic reports an empty account as a 402 billing error, or as a 400 about the credit balance. */
export function isCreditFailure(error: unknown): boolean {
  if (!(error instanceof Anthropic.APIError)) return false;
  return error.status === 402 || (error.status === 400 && /credit balance/i.test(error.message));
}

/** Reserves the worst case, and turns "over the limit" into a message the host can act on. */
function reserveOrExplain(budget: ReturnType<typeof getBudget>, estimate: number) {
  try {
    return budget.reserve(estimate);
  } catch (error) {
    throw error instanceof AiBudgetExceededError ? new AiCreditError("daily limit") : error;
  }
}

export interface CallMeta {
  /** Short label for the timeline, e.g. "extract receipt". */
  feature: string;
  quiet?: boolean;
}

export interface ClaudeCallResult<M extends BetaMessage = BetaMessage> {
  message: M;
  costUsd: number;
}

/**
 * Runs one Messages API call under the spend cap. `exec` performs the actual SDK call so the
 * same guard wraps create(), parse() and countless future variants.
 */
export async function guardedClaudeCall<M extends BetaMessage>(
  params: BetaCreateParams,
  meta: CallMeta,
  exec: (client: Anthropic, params: BetaCreateParams) => Promise<M>,
): Promise<ClaudeCallResult<M>> {
  const client = getAnthropic();
  const p = withServerFallback(params);
  const estimate = worstCaseCostUsd(p.model, estimateInputTokens({ system: p.system, messages: p.messages, tools: p.tools }), p.max_tokens);
  const budget = getBudget();
  const reservation = reserveOrExplain(budget, estimate);
  const step = startStep({
    kind: "ai",
    title: `${modelLabel(p.model)} · ${meta.feature}`,
    subtitle: `worst case $${estimate.toFixed(4)} reserved`,
    data: meta.quiet ? { quiet: true } : undefined,
  });
  let settled = false;
  try {
    const message = await exec(client, p);
    const cost = actualCostUsd(message);
    budget.commit(reservation, cost);
    settled = true;
    assertNotRefused(message);
    const fellBack = message.model !== p.model;
    step.succeed({
      detail: `${message.usage.input_tokens.toLocaleString()} in · ${message.usage.output_tokens.toLocaleString()} out · $${cost.toFixed(4)}${fellBack ? ` · served by ${modelLabel(message.model)}` : ""}`,
      data: { model: message.model, usage: message.usage, costUsd: cost, stopReason: message.stop_reason, quiet: meta.quiet },
    });
    return { message, costUsd: cost };
  } catch (error) {
    if (!settled) budget.release(reservation);
    const failure = isCreditFailure(error) ? new AiCreditError() : error;
    step.fail(failure);
    throw failure;
  }
}

/** Emits a timeline step for a mocked AI call so demos still show "AI did something". */
export function recordMockAiCall(feature: string, detail = "AI mock mode: returned the fixture") {
  startStep({ kind: "ai", title: `AI (mock) · ${feature}`, subtitle: "No ANTHROPIC_API_KEY" }).succeed({ detail });
}

/** Text of all text blocks in a message. */
export function textOf(message: Pick<BetaMessage, "content">): string {
  return message.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}
