/**
 * Which PayPal calls the PayPal Agent Toolkit (1.11.0, the latest) has a tool for. Where it has
 * none, the calls strip says so in plain words and the call goes through the kit's own extension,
 * behind the same Guard. Shared by server and browser.
 */
export const TOOLKIT_VERSION = "1.11.0";

/** Operations the Toolkit has no tool for, in the words the calls strip shows. */
export const TOOLKIT_GAPS: Partial<Record<string, string>> = {
  "orders.create": `The Agent Toolkit ${TOOLKIT_VERSION} create_order tool only makes pay-now orders, not a hold, so this uses the kit's own call.`,
  "orders.authorize": `The Agent Toolkit ${TOOLKIT_VERSION} has no tool to place a hold, so this uses the kit's own call.`,
  "payments.getAuthorization": `The Agent Toolkit ${TOOLKIT_VERSION} has no get_authorization tool, so this uses the kit's own call.`,
  "payments.captureAuthorization": `The Agent Toolkit ${TOOLKIT_VERSION} has no tool to capture from a hold, so this uses the kit's own call, behind the same Guard.`,
  "payments.voidAuthorization": `The Agent Toolkit ${TOOLKIT_VERSION} has no tool to void a hold, so this uses the kit's own call, behind the same Guard.`,
  "payments.reauthorize": `The Agent Toolkit ${TOOLKIT_VERSION} has no tool to refresh a hold, so this uses the kit's own call.`,
  "payments.getCapture": `The Agent Toolkit ${TOOLKIT_VERSION} has no get_capture tool, so this uses the kit's own call.`,
  "disputes.provideEvidence": `The Agent Toolkit ${TOOLKIT_VERSION} has no tool to send dispute evidence, so this uses the kit's own call, behind the same Guard.`,
};

/** How a PayPal call was made, for the calls strip. */
export interface PayPalVia {
  /** The guarded tool that made the call, when one did. */
  tool?: string;
  /** The Agent Toolkit tool that made it, or null when the Toolkit has none for it. */
  toolkit: string | null;
  /** Why the Toolkit wasn't used, when it has no tool for this call. */
  gap?: string;
}

export function viaFor(operation: string, tool: { name: string; source: string } | undefined): PayPalVia | undefined {
  if (tool?.source === "paypal-agent-toolkit") return { tool: tool.name, toolkit: tool.name };
  const gap = TOOLKIT_GAPS[operation];
  if (!tool && !gap) return undefined;
  return { tool: tool?.name, toolkit: null, gap };
}
