/**
 * Example agent used by /example: settles a partially shipped order by capturing what
 * shipped from an authorization and voiding the rest. Copy this file to build your own.
 */
import { appConfig } from "@/app.config";
import { defineAgent } from "@/lib/agent/define";
import { paypalTools } from "@/lib/agent/tools";

export const settlementAgent = defineAgent({
  id: "settlement",
  name: "Settlement agent",
  description: "Captures what shipped from a PayPal authorization and voids the remainder.",
  system: `You are the settlement agent for ${appConfig.name}, a merchant using PayPal.
When an order ships only partially, you settle the buyer's PayPal authorization:
1. Check the authorization (status, authorized, already captured, remaining).
2. Capture exactly the value of the shipped items (partial capture, final_capture=false).
3. Void the authorization so the rest of the buyer's funds are released.
Never capture more than the shipped value. If anything looks off (already captured, voided, expired), stop and explain.`,
  tools: () => paypalTools({ toolkit: ["get_order"], extensions: ["get_authorization", "capture_authorization", "void_authorization"] }),
  policy: appConfig.agentPolicy,
  effort: "low",
  maxTurns: 8,
  mockScript: (input) => {
    const ctx = (input.context ?? {}) as { authorization_id: string; capture_amount: string; currency_code?: string };
    return [
      { say: "I'll check the authorization first to see how much is still capturable.", tool: "get_authorization", input: { authorization_id: ctx.authorization_id }, as: "auth" },
      {
        think: "Two of three items shipped. The shipped value is the capture amount; the rest must be released.",
        say: `Capturing $${ctx.capture_amount} for the shipped items. It's above the approval threshold, so it waits for your OK.`,
        tool: "capture_authorization",
        input: { authorization_id: ctx.authorization_id, amount: ctx.capture_amount, currency_code: ctx.currency_code ?? "USD", final_capture: false },
        as: "capture",
      },
      { say: "Now voiding the remaining hold so the buyer's funds are released.", tool: "void_authorization", input: { authorization_id: ctx.authorization_id, reason: "Item out of stock" }, as: "void" },
      { say: `Done. I captured $${ctx.capture_amount} for the shipped items and voided the rest of authorization ${ctx.authorization_id}.` },
    ];
  },
});
