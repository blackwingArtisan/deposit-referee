import { appConfig } from "@/app.config";
import { getBudget, isAiLive } from "@/lib/ai";
import { AI_MODELS, modelLabel } from "@/lib/ai/config";
import { DEFAULT_POLICY } from "@/lib/agent/policy";
import { getEnv } from "@/lib/env";
import { route } from "@/lib/http";
import { getBrowserClientId } from "@/lib/paypal";

/** Public runtime status for the UI: modes, models, AI spend. Never includes secrets. */
export const GET = route(async () => {
  const env = getEnv();
  return {
    app: { name: appConfig.name, slug: appConfig.slug },
    paypal: { mode: env.paypalMode, clientId: getBrowserClientId() ?? null, buyerEmail: env.sandboxBuyerEmail, webhookConfigured: Boolean(env.paypalWebhookId), testCard: env.paypalMode === "sandbox" && env.demoTestCard },
    ai: { mode: isAiLive() ? "live" : "mock", models: { default: modelLabel(AI_MODELS.default), smart: modelLabel(AI_MODELS.smart) }, budget: getBudget().status() },
    policy: { ...DEFAULT_POLICY, ...appConfig.agentPolicy },
  };
});
