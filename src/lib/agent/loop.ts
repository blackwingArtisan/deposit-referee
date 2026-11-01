/**
 * Claude tool-use loop (manual loop over client.beta.messages.create).
 *
 * Manual rather than the SDK tool runner because each turn must (1) pass the daily spend
 * cap before the request is sent, (2) stream every step to the timeline, and (3) route every
 * tool call through the Guard, which can pause for human approval.
 *
 * Conversation is append-only: assistant content (including thinking blocks) is sent back
 * exactly as received.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { timeline } from "../events/bus";
import { FEATURE_DEFAULTS, resolveModel } from "../ai/config";
import { guardedClaudeCall, type BetaMessageParam } from "../ai/client";
import type { AgentDefinition, AgentInput } from "./define";
import { runTool } from "./execute";
import type { Guard } from "./guard";
import { describePolicy } from "./policy";
import type { AgentTool } from "./tool";

export interface AgentRunResult {
  summary: string;
  turns: number;
  costUsd: number;
  stopReason: string;
}

export function buildSystemPrompt(def: AgentDefinition, guard: Guard): string {
  return [
    def.system.trim(),
    "",
    "How you work:",
    "- The user watches a live timeline of your steps. Before each tool call, write one short sentence saying what you are about to do and why.",
    `- Money-moving tools pass through a guard. ${describePolicy(guard.policy)} If a tool result says DENIED_BY_GUARD, do not retry the same call; explain what was blocked.`,
    "- Amounts are decimal strings such as \"45.00\". Never invent ids; take them from the context or from tool results.",
    "- When you are done, reply with a 1-3 sentence summary of what you did, including amounts and ids.",
    `- Today's date is ${new Date().toISOString().slice(0, 10)}.`,
  ].join("\n");
}

function toBetaTool(t: AgentTool): Anthropic.Beta.BetaTool {
  return { name: t.name, description: t.description, input_schema: t.inputSchema as Anthropic.Beta.BetaTool.InputSchema };
}

function userGoal(input: AgentInput): string {
  return input.context ? `${input.goal}\n\nContext:\n${JSON.stringify(input.context, null, 2)}` : input.goal;
}

export async function runClaudeAgent(opts: { runId: string; channel: string; def: AgentDefinition; input: AgentInput; guard: Guard }): Promise<AgentRunResult> {
  const { def, guard, runId, channel } = opts;
  const actor = `agent:${def.id}`;
  const tools = def.tools();
  const byName = new Map(tools.map((t) => [t.name.toLowerCase(), t]));
  const system = buildSystemPrompt(def, guard);
  const model = resolveModel(def.model, FEATURE_DEFAULTS.agent.role);
  const maxTurns = def.maxTurns ?? 10;
  const mcp = def.remoteMcp?.() ?? null;
  const messages: BetaMessageParam[] = [{ role: "user", content: userGoal(opts.input) }];
  let costUsd = 0;
  let lastText = "";

  for (let turn = 1; turn <= maxTurns; turn++) {
    const { message, costUsd: turnCost } = await guardedClaudeCall(
      {
        model,
        max_tokens: FEATURE_DEFAULTS.agent.maxTokens,
        thinking: { type: "adaptive", display: "summarized" },
        output_config: { effort: def.effort ?? FEATURE_DEFAULTS.agent.effort },
        system,
        tools: [
          ...tools.map(toBetaTool),
          ...(mcp ? [{ type: "mcp_toolset" as const, mcp_server_name: mcp.name, default_config: { enabled: false }, configs: Object.fromEntries(mcp.allowedTools.map((n) => [n, { enabled: true }])) }] : []),
        ],
        ...(mcp ? { mcp_servers: [{ type: "url" as const, url: mcp.url, name: mcp.name, authorization_token: mcp.authorizationToken }], betas: ["mcp-client-2025-11-20"] } : {}),
        messages,
      },
      { feature: `agent turn ${turn}`, quiet: true },
      (client, params) => client.beta.messages.create(params),
    );
    costUsd += turnCost;

    for (const block of message.content) {
      if (block.type === "thinking" && block.thinking.trim()) {
        timeline.emit({ kind: "agent.thinking", status: "info", title: "Reasoning", detail: block.thinking.trim(), data: { quiet: true } });
      } else if (block.type === "text" && block.text.trim()) {
        lastText = block.text.trim();
        timeline.emit({ kind: "agent.message", status: "info", title: def.name, detail: lastText });
      } else if (block.type === "mcp_tool_use") {
        timeline.emit({ kind: "tool", status: "running", stepId: block.id, title: `PayPal MCP · ${block.name}`, subtitle: `Remote MCP (${block.server_name}) · read-only`, tool: { name: block.name, source: "paypal-agent-toolkit", input: block.input } });
      } else if (block.type === "mcp_tool_result") {
        timeline.emit({ kind: "tool", status: block.is_error ? "failed" : "succeeded", stepId: block.tool_use_id, title: "PayPal MCP result", tool: { name: "mcp", source: "paypal-agent-toolkit", output: block.content } });
      }
    }
    messages.push({ role: "assistant", content: message.content as Anthropic.Beta.BetaContentBlockParam[] });

    if (message.stop_reason === "pause_turn") continue;
    const toolUses = message.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    if (!toolUses.length) return { summary: lastText, turns: turn, costUsd, stopReason: message.stop_reason ?? "end_turn" };
    if (message.stop_reason === "max_tokens") throw new Error("A tool call was cut off by max_tokens; not executing a truncated input.");

    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const tu of toolUses) {
      const tool = byName.get(tu.name.toLowerCase());
      if (!tool) {
        results.push({ type: "tool_result", tool_use_id: tu.id, is_error: true, content: `Unknown tool "${tu.name}". Available tools: ${tools.map((t) => t.name).join(", ")}` });
        continue;
      }
      const r = await runTool(tool, tu.input, { runId, actor, channel, guard });
      results.push({ type: "tool_result", tool_use_id: tu.id, content: r.content, is_error: r.isError });
    }
    // All results for one assistant turn go back in a single user message.
    messages.push({ role: "user", content: results });
  }
  return { summary: lastText || `Stopped after ${maxTurns} turns.`, turns: maxTurns, costUsd, stopReason: "max_turns" };
}
