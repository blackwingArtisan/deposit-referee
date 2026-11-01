/**
 * Runs one tool call for an agent (Claude or scripted): validate -> guard -> timeline card ->
 * a tool_result string the model can read.
 */
import { startStep } from "../events/bus";
import type { MoneyDirection, ToolSource } from "../events/types";
import type { Guard, GuardOutcome } from "./guard";
import type { AgentTool } from "./tool";

export const SOURCE_LABEL: Record<ToolSource, string> = {
  "paypal-agent-toolkit": "PayPal Agent Toolkit",
  "kit-extension": "Toolkit-style extension",
  app: "App tool",
};

export interface ToolCallResult {
  content: string;
  isError: boolean;
  outcome?: GuardOutcome;
  output?: unknown;
}

const MAX_RESULT_CHARS = 8000;

function forModel(value: unknown): string {
  const json = JSON.stringify(value, (k, v) => (k === "links" ? undefined : v));
  if (!json) return "OK";
  return json.length > MAX_RESULT_CHARS ? `${json.slice(0, MAX_RESULT_CHARS)}…[truncated]` : json;
}

function humanize(name: string) {
  return name.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

function directionFor(tool: AgentTool): MoneyDirection | undefined {
  if (tool.risk === "read") return undefined;
  if (/void/.test(tool.name)) return "neutral";
  if (/refund|payout|accept_dispute/.test(tool.name)) return "out";
  if (/authoriz/.test(tool.name) && !/capture/.test(tool.name)) return "hold";
  if (/capture|pay_order|charge/.test(tool.name)) return "in";
  return "neutral";
}

export async function runTool(tool: AgentTool, rawInput: unknown, ctx: { runId: string; actor: string; channel: string; guard: Guard }): Promise<ToolCallResult> {
  let input: unknown;
  let title = humanize(tool.name);
  try {
    input = tool.parse(rawInput);
    title = tool.title?.(input as never) ?? title;
  } catch (error) {
    const step = startStep({ kind: "tool", title, subtitle: `${SOURCE_LABEL[tool.source]} · ${tool.name}`, tool: { name: tool.name, source: tool.source, input: rawInput } });
    step.fail(error, { detail: "Invalid tool input" });
    return { content: JSON.stringify({ error: "INVALID_INPUT", message: error instanceof Error ? error.message : String(error) }), isError: true };
  }

  const step = startStep({
    kind: "tool",
    title,
    subtitle: `${SOURCE_LABEL[tool.source]} · ${tool.name}`,
    direction: directionFor(tool),
    tool: { name: tool.name, source: tool.source, input },
    data: tool.risk === "read" ? { quiet: true, risk: tool.risk } : { risk: tool.risk },
  });

  const outcome = await ctx.guard.run(tool, input as never, {
    runId: ctx.runId,
    actor: ctx.actor,
    channel: ctx.channel,
    onImpact: (impact) => step.update({ title: impact.summary, amount: impact.amount }),
    onApprovalRequested: (a) => step.update({ status: "awaiting_approval", detail: a.reason, approval: { id: a.id, state: "pending", reason: a.reason } }),
    onApprovalDecided: (a) =>
      step.update({
        status: a.state === "approved" ? "running" : "denied",
        detail: a.state === "approved" ? `Approved by ${a.decidedBy}` : a.state === "expired" ? "Approval expired" : `Declined by ${a.decidedBy}`,
        approval: { id: a.id, state: a.state, reason: a.reason, decidedBy: a.decidedBy },
      }),
  });

  if (outcome.status === "executed") {
    step.succeed({
      detail: outcome.replayed ? "Replayed stored result (idempotent)" : undefined,
      tool: { name: tool.name, source: tool.source, input, output: outcome.result },
    });
    return { content: forModel(outcome.result), isError: false, outcome, output: outcome.result };
  }
  if (outcome.status === "denied") {
    step.update({ status: "denied", detail: outcome.reason, error: { name: outcome.code, message: outcome.reason } });
    return {
      content: JSON.stringify({
        error: "DENIED_BY_GUARD",
        code: outcome.code,
        reason: outcome.reason,
        guidance: "Do not retry this exact call. Tell the user what was blocked and why, or propose a smaller/allowed alternative.",
      }),
      isError: true,
      outcome,
    };
  }
  step.fail(outcome.error);
  const e = outcome.error as { name?: string; message?: string; issue?: string; debugId?: string; status?: number };
  return {
    content: JSON.stringify({ error: e.name ?? "TOOL_FAILED", message: e.message ?? String(outcome.error), issue: e.issue, debug_id: e.debugId, http_status: e.status }),
    isError: true,
    outcome,
  };
}
