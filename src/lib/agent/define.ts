/**
 * An agent = instructions + tools + guard policy (+ a script for AI mock mode).
 * Register app agents in src/agents/index.ts.
 */
import type { Effort, ModelRole } from "../ai/config";
import type { GuardPolicy } from "./policy";
import type { AgentTool } from "./tool";

export interface AgentInput {
  /** What the user asked, in plain language. */
  goal: string;
  /** Facts the agent needs (ids, amounts), passed as JSON. */
  context?: Record<string, unknown>;
}

/** One step of a scripted (mock-AI) run. `input` may be computed from earlier results. */
export interface ScriptStep {
  say?: string;
  think?: string;
  tool?: string;
  input?: Record<string, unknown> | ((results: Record<string, any>) => Record<string, unknown>); // eslint-disable-line @typescript-eslint/no-explicit-any
  /** Store the tool output under this key for later steps. */
  as?: string;
  pauseMs?: number;
}

export interface RemoteMcpConfig {
  /** e.g. https://mcp.sandbox.paypal.com/http (PayPal's hosted MCP, sandbox) */
  url: string;
  name: string;
  authorizationToken?: string;
  /** Only these tools are enabled; everything else is off. Keep it to read-only tools. */
  allowedTools: string[];
}

export interface AgentDefinition {
  id: string;
  name: string;
  description: string;
  /** Role + domain rules. The kit appends timeline/guard instructions. */
  system: string;
  tools: () => AgentTool[];
  policy?: Partial<GuardPolicy>;
  model?: ModelRole | string;
  effort?: Effort;
  maxTurns?: number;
  /** Used when there is no ANTHROPIC_API_KEY, so the demo still runs end to end. */
  mockScript?: (input: AgentInput) => ScriptStep[];
  /** Optional, sandbox only, READ-ONLY tools via Anthropic's MCP connector (bypasses the guard, so never allow writes). */
  remoteMcp?: () => RemoteMcpConfig | null;
}

export function defineAgent(def: AgentDefinition): AgentDefinition {
  return def;
}
