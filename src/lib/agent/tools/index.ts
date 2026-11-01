/**
 * Pick the PayPal tools an agent may use.
 *
 *   const tools = paypalTools({ toolkit: ["get_order", "create_refund"], extensions: ["capture_authorization"] });
 *   const tools = [...paypalTools(), myAppTool];
 */
import { getEnv } from "../../env";
import type { AgentTool } from "../tool";
import { KIT_EXTENSION_TOOLS } from "./extensions";
import { TOOLKIT_TOOL_NAMES, toolkitTools } from "./toolkit";

export { KIT_EXTENSION_TOOLS } from "./extensions";
export { TOOLKIT_TOOL_NAMES, toolkitCatalog, toolkitTools } from "./toolkit";

export type KitExtensionName = (typeof KIT_EXTENSION_TOOLS)[number]["name"];

export function paypalTools(opts: { toolkit?: string[]; extensions?: KitExtensionName[] } = {}): AgentTool[] {
  const mode = getEnv().paypalMode;
  const toolkit = toolkitTools(opts.toolkit ?? TOOLKIT_TOOL_NAMES, mode);
  const ext = (opts.extensions ? KIT_EXTENSION_TOOLS.filter((t) => opts.extensions!.includes(t.name)) : KIT_EXTENSION_TOOLS) as AgentTool[];
  return [...toolkit, ...ext];
}
