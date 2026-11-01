/**
 * Vision helpers (Sonnet 5.5 by default).
 *
 *   const { data } = await extractReceipt({ image: { dataUrl } , mock: () => SAMPLE_RECEIPT });
 *   const { data } = await compareImages({ images: [before, after], question: "Is the item damaged?", schema });
 */
import { z } from "zod";
import { generateObject, type AiResult } from "./structured";
import type { Effort, ModelRole } from "./config";
import type { ImageInput } from "./images";

export async function extractFromImage<S extends z.ZodType>(opts: {
  image: ImageInput;
  schema: S;
  instructions: string;
  model?: ModelRole | string;
  effort?: Effort;
  mock?: () => z.infer<S> | Promise<z.infer<S>>;
  feature?: string;
}): Promise<AiResult<z.infer<S>>> {
  return generateObject({
    schema: opts.schema,
    images: [opts.image],
    prompt: opts.instructions,
    model: opts.model ?? "smart",
    effort: opts.effort,
    mock: opts.mock,
    feature: opts.feature ?? "extract from image",
  });
}

export async function compareImages<S extends z.ZodType>(opts: {
  images: ImageInput[];
  question: string;
  schema: S;
  /** Optional labels shown to the model, e.g. ["Listing photo", "Delivered item"]. */
  labels?: string[];
  model?: ModelRole | string;
  effort?: Effort;
  mock?: () => z.infer<S> | Promise<z.infer<S>>;
}): Promise<AiResult<z.infer<S>>> {
  if (opts.images.length < 2) throw new Error("compareImages needs at least two images");
  const labels = opts.labels ?? opts.images.map((_, i) => `Image ${i + 1}`);
  return generateObject({
    schema: opts.schema,
    images: opts.images,
    prompt: `The images are, in order: ${labels.join(", ")}.\n\n${opts.question}`,
    model: opts.model ?? "smart",
    effort: opts.effort,
    mock: opts.mock,
    feature: "compare images",
  });
}

export const ReceiptSchema = z.object({
  merchant: z.string().describe("Business name as printed"),
  date: z.string().nullable().describe("Purchase date as YYYY-MM-DD, null if not visible"),
  currency: z.string().describe("ISO 4217 code, e.g. USD"),
  subtotal: z.string().nullable().describe("Decimal string, e.g. 12.50"),
  tax: z.string().nullable(),
  tip: z.string().nullable(),
  total: z.string().describe("Grand total as a decimal string"),
  line_items: z.array(z.object({ description: z.string(), quantity: z.number(), amount: z.string() })),
  confidence: z.enum(["high", "medium", "low"]).describe("How legible the receipt was"),
});
export type Receipt = z.infer<typeof ReceiptSchema>;

export const SAMPLE_RECEIPT: Receipt = {
  merchant: "Blue Bottle Coffee",
  date: "2026-10-24",
  currency: "USD",
  subtotal: "14.50",
  tax: "1.27",
  tip: "2.00",
  total: "17.77",
  line_items: [
    { description: "Oat latte", quantity: 2, amount: "11.00" },
    { description: "Almond croissant", quantity: 1, amount: "3.50" },
  ],
  confidence: "high",
};

export function extractReceipt(opts: { image: ImageInput; mock?: () => Receipt }) {
  return extractFromImage({
    image: opts.image,
    schema: ReceiptSchema,
    instructions:
      "Extract this receipt. Copy amounts exactly as printed (decimal strings, no currency symbols). If a field is not visible use null. Do not invent line items.",
    mock: opts.mock ?? (() => SAMPLE_RECEIPT),
    feature: "extract receipt",
  });
}
