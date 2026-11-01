/**
 * Streaming text for chat-like UIs.
 *
 *   // app/api/explain/route.ts
 *   export const POST = route(async (req) => {
 *     enforceRateLimit(req, "ai");
 *     const stream = await streamText({ prompt: "Explain this refund...", mock: "Here is why..." });
 *     return textStreamResponse(stream);
 *   });
 *
 * The budget check happens before the stream starts, so cap/rate errors are normal JSON errors.
 * Read it in the browser with readTextStream() from "@/components/ai/read-text-stream".
 */
import { getBudget } from "./budget";
import { FEATURE_DEFAULTS, modelLabel, resolveModel, type Effort, type ModelRole } from "./config";
import { actualCostUsd, estimateInputTokens, worstCaseCostUsd } from "./cost";
import { assertNotRefused, getAnthropic, isAiLive, recordMockAiCall, withServerFallback, type BetaCreateParams, type BetaMessageParam } from "./client";
import { AiUnavailableError } from "./errors";
import { buildUserContent } from "./structured";
import type { ImageInput } from "./images";
import { startStep } from "../events/bus";

export interface StreamTextOptions {
  prompt?: string;
  messages?: BetaMessageParam[];
  system?: string;
  images?: ImageInput[];
  model?: ModelRole | string;
  effort?: Effort;
  maxTokens?: number;
  feature?: string;
  /** Text streamed word-by-word when AI is in mock mode. */
  mock?: string;
}

const encoder = new TextEncoder();

function mockStream(text: string): ReadableStream<Uint8Array> {
  const words = text.split(/(\s+)/);
  return new ReadableStream({
    async pull(controller) {
      const next = words.shift();
      if (next === undefined) return controller.close();
      await new Promise((r) => setTimeout(r, 18));
      controller.enqueue(encoder.encode(next));
    },
  });
}

export async function streamText(opts: StreamTextOptions): Promise<ReadableStream<Uint8Array>> {
  const feature = opts.feature ?? "stream text";
  if (!isAiLive()) {
    if (opts.mock === undefined) throw new AiUnavailableError(`AI mock mode: "${feature}" needs a \`mock\` string or an ANTHROPIC_API_KEY.`);
    recordMockAiCall(feature);
    return mockStream(opts.mock);
  }
  const d = FEATURE_DEFAULTS.stream;
  const params: BetaCreateParams = withServerFallback({
    model: resolveModel(opts.model, opts.images?.length ? "smart" : d.role),
    max_tokens: opts.maxTokens ?? d.maxTokens,
    thinking: { type: "adaptive" },
    output_config: { effort: opts.effort ?? d.effort },
    ...(opts.system ? { system: opts.system } : {}),
    messages: opts.messages ?? [{ role: "user", content: buildUserContent(opts.prompt, opts.images) }],
  });
  const client = getAnthropic();
  const budget = getBudget();
  const estimate = worstCaseCostUsd(params.model, estimateInputTokens({ system: params.system, messages: params.messages }), params.max_tokens);
  const reservation = budget.reserve(estimate);
  const step = startStep({ kind: "ai", title: `${modelLabel(params.model)} · ${feature}`, subtitle: `streaming · worst case $${estimate.toFixed(4)} reserved` });
  const stream = client.beta.messages.stream(params);

  return new ReadableStream<Uint8Array>({
    start(controller) {
      stream.on("text", (delta) => controller.enqueue(encoder.encode(delta)));
      stream
        .finalMessage()
        .then((message) => {
          const cost = actualCostUsd(message);
          budget.commit(reservation, cost);
          try {
            assertNotRefused(message);
            step.succeed({ detail: `${message.usage.output_tokens} tokens · $${cost.toFixed(4)}` });
          } catch (e) {
            step.fail(e);
            controller.enqueue(encoder.encode(`\n\n[${(e as Error).message}]`));
          }
          controller.close();
        })
        .catch((e) => {
          budget.release(reservation);
          step.fail(e);
          controller.error(e);
        });
    },
    cancel() {
      stream.abort();
    },
  });
}

export function textStreamResponse(stream: ReadableStream<Uint8Array>): Response {
  return new Response(stream, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
}
