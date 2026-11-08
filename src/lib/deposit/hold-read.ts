/**
 * Reads a deposit hold with the PayPal Agent Toolkit's own get_order tool. The Toolkit has no
 * get_authorization tool, but the order carries its holds and their captures, so the Toolkit
 * read is enough. Only a hold the order doesn't list falls back to the kit's own read, and the
 * calls strip says so. Server only.
 */
import { runTool } from "@/lib/agent/execute";
import type { Guard } from "@/lib/agent/guard";
import { orderViaToolkit } from "@/lib/agent/tools/extensions";
import { toolkitTools } from "@/lib/agent/tools/toolkit";
import type { PayPalApi } from "@/lib/paypal/api";
import type * as T from "@/lib/paypal/types";

function holdIn(order: T.Order | undefined, authorizationId: string): T.Authorization | undefined {
  return order?.purchase_units?.flatMap((u) => u.payments?.authorizations ?? []).find((a) => a.id === authorizationId);
}

/** Inside a guarded money tool: the read runs as the Toolkit's get_order. */
export async function readHold(paypal: PayPalApi, orderId: string | undefined, authorizationId: string): Promise<T.Authorization> {
  const hold = orderId ? holdIn(await orderViaToolkit(paypal, orderId), authorizationId) : undefined;
  return hold ?? paypal.payments.getAuthorization(authorizationId);
}

/** Outside a tool: the Toolkit's get_order goes through the Guard like any agent tool call. */
export async function readHoldGuarded(paypal: PayPalApi, orderId: string | undefined, authorizationId: string, ctx: { runId: string; actor: string; channel: string; guard: Guard }): Promise<T.Authorization> {
  if (orderId) {
    const result = await runTool(toolkitTools(["get_order"], paypal.mode)[0], { id: orderId }, ctx);
    if (result.isError) throw new Error(`Reading the hold from PayPal failed: ${result.content}`);
    const hold = holdIn(result.output as T.Order, authorizationId);
    if (hold) return hold;
  }
  return paypal.payments.getAuthorization(authorizationId);
}
