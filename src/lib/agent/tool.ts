/**
 * Agent tool definition. Every tool declares its risk; "money" tools must also declare their
 * impact (amount + who gets paid) so the guard can apply caps, allowlists and approvals.
 *
 *   export const issueCredit = defineTool({
 *     name: "issue_store_credit",
 *     description: "Give the customer store credit instead of a refund.",
 *     risk: "money",
 *     schema: z.object({ customer_email: z.string().email(), amount: z.string() }),
 *     impact: async (i) => ({ amount: money(i.amount), counterparties: [i.customer_email], summary: `Credit ${i.amount}` }),
 *     execute: async (i, ctx) => credits.add(i.customer_email, i.amount, { idempotencyKey: ctx.idempotencyKey }),
 *   });
 */
import { z } from "zod";
import type { PayPalApi } from "../paypal/api";
import type { Money } from "../money";
import type { ToolSource } from "../events/types";

export type ToolRisk = "read" | "write" | "money";

export interface ToolContext {
  runId: string;
  actor: string;
  paypal: PayPalApi;
  /** Deterministic per (run, tool, input). Pass it on as PayPal-Request-Id. */
  idempotencyKey: string;
  /** PayPal-Request-Id for this attempt (differs from idempotencyKey after a failed attempt). */
  requestId: string;
}

export interface ToolImpact {
  amount?: Money;
  /** Who receives money (emails, merchant ids). Checked against the allowlist. */
  counterparties?: string[];
  /** Human sentence for the timeline + approval card, e.g. "Capture $45.00 of $120.00 authorization". */
  summary: string;
}

export interface AgentTool<I = unknown, O = unknown> {
  name: string;
  description: string;
  source: ToolSource;
  risk: ToolRisk;
  /** JSON Schema passed to Claude as input_schema. */
  inputSchema: Record<string, unknown>;
  /** Validates and normalizes raw model input (throws on invalid). */
  parse(input: unknown): I;
  /** Resolves amount/counterparties before execution. May call PayPal read APIs. */
  impact?(input: I, ctx: Omit<ToolContext, "idempotencyKey" | "requestId">): Promise<ToolImpact>;
  execute(input: I, ctx: ToolContext): Promise<O>;
  /** Short title for the timeline card before impact is known. */
  title?(input: I): string;
}

export function defineTool<S extends z.ZodType, O>(def: {
  name: string;
  description: string;
  risk: ToolRisk;
  source?: ToolSource;
  schema: S;
  impact?: AgentTool<z.infer<S>, O>["impact"];
  execute: AgentTool<z.infer<S>, O>["execute"];
  title?: AgentTool<z.infer<S>, O>["title"];
}): AgentTool<z.infer<S>, O> {
  if (def.risk === "money" && !def.impact) throw new Error(`Tool ${def.name} moves money and must define impact()`);
  const json = z.toJSONSchema(def.schema, { target: "draft-2020-12", io: "input" }) as Record<string, unknown>;
  delete json.$schema;
  return {
    name: def.name,
    description: def.description,
    source: def.source ?? "app",
    risk: def.risk,
    inputSchema: json,
    parse: (input) => def.schema.parse(input ?? {}),
    impact: def.impact,
    execute: def.execute,
    title: def.title,
  };
}
