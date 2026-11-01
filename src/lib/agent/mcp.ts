/**
 * OPTIONAL: PayPal's hosted MCP server through Anthropic's MCP connector, for READ-ONLY tools.
 *
 * Anthropic's servers call the MCP tools inside the API response, so our Guard never sees
 * those calls. That is acceptable only for reads. Money-moving tools stay local and guarded.
 *
 * Status: not exercised by the kit's tests (needs sandbox credentials). The exact bearer
 * format PayPal's hosted MCP expects is not confirmed in PayPal's docs; we pass a sandbox
 * OAuth access token.
 *
 *   remoteMcp: () => paypalRemoteMcp(),   // in an AgentDefinition, sandbox mode only
 */
import { getEnv } from "../env";
import { singleton } from "../singleton";
import type { RemoteMcpConfig } from "./define";

export const PAYPAL_SANDBOX_MCP_URL = "https://mcp.sandbox.paypal.com/http";

export const READ_ONLY_MCP_TOOLS = ["get_order", "list_transactions", "list_invoices", "get_invoice", "list_disputes", "get_dispute", "get_refund", "show_product_details", "list_products"];

/** Cached token for the connector (must be fetched before the run; see prefetchRemoteMcpToken). */
const tokenCache = singleton("agent:mcp-token", () => ({ value: "" }));

export async function prefetchRemoteMcpToken() {
  if (getEnv().paypalMode !== "sandbox") return;
  const { getSandboxAccessToken } = await import("../paypal");
  tokenCache.value = await getSandboxAccessToken();
}

export function paypalRemoteMcp(allowedTools: string[] = READ_ONLY_MCP_TOOLS): RemoteMcpConfig | null {
  if (getEnv().paypalMode !== "sandbox" || !tokenCache.value) return null;
  return { url: PAYPAL_SANDBOX_MCP_URL, name: "paypal", authorizationToken: tokenCache.value, allowedTools };
}
