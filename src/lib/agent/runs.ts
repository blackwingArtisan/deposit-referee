/**
 * Starts agent runs in the background and tracks them. The browser follows along over the
 * timeline SSE stream (channel = its session id) and approves via /api/agent/approvals.
 */
import { randomUUID } from "node:crypto";
import { timeline, withContext } from "../events/bus";
import { isAiLive } from "../ai/client";
import { modelLabel, resolveModel, FEATURE_DEFAULTS } from "../ai/config";
import { getPayPal } from "../paypal";
import { singleton } from "../singleton";
import type { AgentDefinition, AgentInput } from "./define";
import { Guard } from "./guard";
import { runClaudeAgent } from "./loop";
import { runScriptedAgent } from "./scripted";

export interface AgentRun {
  id: string;
  agentId: string;
  agentName: string;
  channel: string;
  goal: string;
  mode: "claude" | "scripted";
  status: "running" | "completed" | "failed";
  startedAt: string;
  finishedAt?: string;
  summary?: string;
  error?: string;
  costUsd: number;
}

const runs = singleton("agent:runs", () => new Map<string, AgentRun>());

export function getRun(id: string) {
  return runs.get(id);
}

export function listRuns(channel?: string): AgentRun[] {
  return [...runs.values()].filter((r) => !channel || r.channel === channel).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

/** Kicks off a run and returns immediately. Use runAgentToCompletion() in tests/scripts. */
export function startAgentRun(def: AgentDefinition, input: AgentInput, opts: { channel: string }): AgentRun {
  const run: AgentRun = {
    id: `run_${randomUUID().slice(0, 12)}`,
    agentId: def.id,
    agentName: def.name,
    channel: opts.channel,
    goal: input.goal,
    mode: isAiLive() ? "claude" : def.mockScript ? "scripted" : "claude",
    status: "running",
    startedAt: new Date().toISOString(),
    costUsd: 0,
  };
  runs.set(run.id, run);
  void runAgentToCompletion(def, input, run);
  return run;
}

export async function runAgentToCompletion(def: AgentDefinition, input: AgentInput, run: AgentRun): Promise<AgentRun> {
  return withContext({ channel: run.channel, runId: run.id, actor: `agent:${def.id}` }, async () => {
    const stepId = `run:${run.id}`;
    const engine = run.mode === "claude" ? modelLabel(resolveModel(def.model, FEATURE_DEFAULTS.agent.role)) : "simulated (AI mock mode)";
    timeline.emit({ kind: "run", status: "running", stepId, title: `${def.name} started`, subtitle: engine, detail: input.goal });
    const guard = new Guard({ paypal: getPayPal(), policy: def.policy });
    try {
      let result;
      if (run.mode === "claude") {
        result = await runClaudeAgent({ runId: run.id, channel: run.channel, def, input, guard });
      } else {
        if (!def.mockScript) throw new Error(`${def.name} has no mockScript and AI is in mock mode (set ANTHROPIC_API_KEY).`);
        result = await runScriptedAgent({ runId: run.id, channel: run.channel, def, input, guard, script: def.mockScript(input) });
      }
      Object.assign(run, { status: "completed", summary: result.summary, costUsd: result.costUsd, finishedAt: new Date().toISOString() });
      timeline.emit({ kind: "run", status: "succeeded", stepId, title: `${def.name} finished`, subtitle: engine, detail: result.summary || "Done.", data: { costUsd: result.costUsd, turns: result.turns } });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      Object.assign(run, { status: "failed", error: message, finishedAt: new Date().toISOString() });
      timeline.emit({ kind: "run", status: "failed", stepId, title: `${def.name} stopped`, subtitle: engine, detail: message, error: { name: (error as Error)?.name ?? "Error", message } });
    }
    return run;
  });
}
