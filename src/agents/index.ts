/**
 * APP-OWNED: the agents this app exposes at POST /api/agent/runs { agentId }.
 */
import type { AgentDefinition } from "@/lib/agent/define";
import { settlementAgent } from "./settlement";

export const AGENTS: Record<string, AgentDefinition> = {
  [settlementAgent.id]: settlementAgent,
};
