/**
 * Takes the host's exact approved charge out of a deposit hold. Runs behind the Guard, which
 * stops at the approval gate before execute() is reached (requireApprovalFor in app.config.ts).
 */
import { z } from "zod";
import { defineTool } from "@/lib/agent/tool";
import { captureAuthorization } from "@/lib/agent/tools/extensions";
import { assertChargeFits, assertHoldOpen, centsToDollars, dollarsToCents, formatExactCents, releasedCents, RuleError } from "@/lib/deposit/rules";
import { moneyFromMinor } from "@/lib/money";
import type { PayPalApi } from "@/lib/paypal/api";

export const CAPTURE_DEPOSIT = "capture_deposit";

/** Reads the hold from PayPal, not from our record, and refuses anything we should not capture. */
async function readCapturableHold(paypal: PayPalApi, authorizationId: string, chargeCents: number) {
  const auth = await paypal.payments.getAuthorization(authorizationId);
  assertHoldOpen(auth.expiration_time);
  if (auth.status !== "CREATED") throw new RuleError(`This hold is ${auth.status}, so no new charge can be taken from it.`);
  const authorizedCents = dollarsToCents(auth.amount.value);
  assertChargeFits(chargeCents, authorizedCents);
  return { authorizedCents };
}

export const captureDeposit = defineTool({
  name: CAPTURE_DEPOSIT,
  description: "Capture the host's exact approved charge from a deposit hold. Refuses an expired hold, a used hold, or a charge above the hold.",
  risk: "money",
  schema: z.object({
    authorization_id: z.string().min(10),
    amount_cents: z.number().int().positive(),
    idempotency_key: z.string().describe("Same key: never captured twice"),
  }),
  title: (i) => `Charge exactly ${formatExactCents(i.amount_cents)}`,
  impact: async (i, ctx) => {
    const { authorizedCents } = await readCapturableHold(ctx.paypal, i.authorization_id, i.amount_cents);
    const released = releasedCents(authorizedCents, i.amount_cents);
    return {
      amount: moneyFromMinor(i.amount_cents),
      summary: `Charge exactly ${formatExactCents(i.amount_cents)} from the ${formatExactCents(authorizedCents)} hold and release ${formatExactCents(released)} to the renter`,
    };
  },
  execute: async (i, ctx) => {
    // Checked again: time passes while the host decides.
    const { authorizedCents } = await readCapturableHold(ctx.paypal, i.authorization_id, i.amount_cents);
    return captureAuthorization.execute(
      { authorization_id: i.authorization_id, amount: centsToDollars(i.amount_cents), currency_code: "USD", final_capture: i.amount_cents === authorizedCents },
      ctx,
    );
  },
});
