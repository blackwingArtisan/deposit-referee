/**
 * Scripted agent for AI mock mode (no ANTHROPIC_API_KEY). It runs the same tools through the
 * same Guard, timeline and audit log as the Claude loop; only the "decisions" are scripted.
 * The timeline labels it clearly as scripted, with no AI call.
 */
import { timeline } from "../events/bus";
import type { AgentDefinition, AgentInput, ScriptStep } from "./define";
import { runTool } from "./execute";
import type { Guard } from "./guard";
import type { AgentRunResult } from "./loop";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function runScriptedAgent(opts: { runId: string; channel: string; def: AgentDefinition; input: AgentInput; guard: Guard; script: ScriptStep[]; pauseMs?: number }): Promise<AgentRunResult> {
  const { def, guard, runId, channel } = opts;
  const actor = `agent:${def.id}`;
  const tools = new Map(def.tools().map((t) => [t.name, t]));
  const results: Record<string, unknown> = {};
  const basePause = opts.pauseMs ?? 700;
  let lastSay = "";

  for (const step of opts.script) {
    if (step.think) {
      timeline.emit({ kind: "agent.thinking", status: "info", title: "Reasoning (scripted, no AI)", detail: step.think, data: { quiet: true } });
    }
    if (step.say) {
      lastSay = step.say;
      timeline.emit({ kind: "agent.message", status: "info", title: `${def.name} (scripted, no AI)`, detail: step.say });
    }
    await sleep(step.pauseMs ?? basePause);
    if (!step.tool) continue;
    const tool = tools.get(step.tool);
    if (!tool) throw new Error(`Script uses unknown tool "${step.tool}"`);
    const input = typeof step.input === "function" ? step.input(results) : (step.input ?? {});
    const r = await runTool(tool, input, { runId, actor, channel, guard });
    if (step.as) results[step.as] = r.isError ? { error: JSON.parse(r.content) } : r.output;
    await sleep(basePause / 2);
  }
  return { summary: lastSay, turns: opts.script.length, costUsd: 0, stopReason: "script_complete" };
}
