/**
 * Structured output against a Zod schema.
 *
 *   const { data } = await generateObject({
 *     schema: z.object({ category: z.enum(["refund", "question"]), confidence: z.number() }),
 *     prompt: `Classify this message: ${text}`,
 *     mock: () => ({ category: "refund", confidence: 0.9 }),   // used when no API key
 *   });
 */
import type Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { FEATURE_DEFAULTS, resolveModel, type Effort, type ModelRole } from "./config";
import { guardedClaudeCall, isAiLive, recordMockAiCall, type BetaMessageParam } from "./client";
import { AiOutputError, AiUnavailableError } from "./errors";
import { imageBlock, type ImageInput } from "./images";

export interface AiResult<T> {
  data: T;
  mocked: boolean;
  model?: string;
  costUsd: number;
}

export interface GenerateObjectOptions<S extends z.ZodType> {
  schema: S;
  /** Simple form: one user message. Use `messages` for multi-turn. */
  prompt?: string;
  messages?: BetaMessageParam[];
  system?: string;
  /** Images are placed before the prompt text. */
  images?: ImageInput[];
  /** "default" (Haiku 5.5), "smart" (Sonnet 5.5) or an explicit model id. */
  model?: ModelRole | string;
  effort?: Effort;
  maxTokens?: number;
  /** Timeline label. */
  feature?: string;
  /** Fixture returned (and schema-validated) when AI is in mock mode. */
  mock?: () => z.infer<S> | Promise<z.infer<S>>;
}

export function buildUserContent(prompt: string | undefined, images: ImageInput[] = []): Anthropic.Beta.BetaContentBlockParam[] {
  return [...images.map(imageBlock), ...(prompt ? [{ type: "text" as const, text: prompt }] : [])];
}

export async function generateObject<S extends z.ZodType>(opts: GenerateObjectOptions<S>): Promise<AiResult<z.infer<S>>> {
  const feature = opts.feature ?? "structured output";
  if (!isAiLive()) {
    if (!opts.mock) throw new AiUnavailableError(`AI mock mode: "${feature}" needs a \`mock\` fixture or an ANTHROPIC_API_KEY.`);
    const data = opts.schema.parse(await opts.mock());
    recordMockAiCall(feature);
    return { data, mocked: true, costUsd: 0 };
  }
  const defaults = opts.images?.length ? FEATURE_DEFAULTS.vision : FEATURE_DEFAULTS.structured;
  const messages: BetaMessageParam[] = opts.messages ?? [{ role: "user", content: buildUserContent(opts.prompt, opts.images) }];
  const { message, costUsd } = await guardedClaudeCall(
    {
      model: resolveModel(opts.model, defaults.role),
      max_tokens: opts.maxTokens ?? defaults.maxTokens,
      thinking: { type: "adaptive" },
      output_config: { effort: opts.effort ?? defaults.effort },
      ...(opts.system ? { system: opts.system } : {}),
      messages,
    },
    { feature },
    (client, params) =>
      client.beta.messages.parse({
        ...params,
        output_config: { ...params.output_config, format: betaZodOutputFormat(opts.schema) },
      }),
  );
  if (message.stop_reason === "max_tokens") throw new AiOutputError(`"${feature}" hit max_tokens before finishing; raise maxTokens or lower effort.`);
  const parsed = (message as { parsed_output?: unknown }).parsed_output;
  if (parsed == null) throw new AiOutputError(`"${feature}" returned no parseable output.`);
  return { data: parsed as z.infer<S>, mocked: false, model: message.model, costUsd };
}
