/**
 * Moves the money: the host's exact charge through the approval gate, then releases the rest.
 * The route returns while this waits for the host; the browser polls the booking. Every step
 * is saved, so a failed release can be retried without charging again.
 */
import { randomUUID } from "node:crypto";
import { appConfig } from "@/app.config";
import { captureDeposit } from "@/agents/tools/capture-deposit";
import { runTool, type ToolCallResult } from "@/lib/agent/execute";
import { Guard } from "@/lib/agent/guard";
import { voidAuthorization } from "@/lib/agent/tools/extensions";
import { withContext } from "@/lib/events/bus";
import { HttpError } from "@/lib/http";
import { getPayPal } from "@/lib/paypal";
import { activeSettlements, requireBooking, saveBooking } from "./bookings";
import { assertChargeFits, assertHoldOpen, dollarsToCents, formatCents, releasedCents, RuleError } from "./rules";
import type { Booking, Settlement } from "./types";

function failureReason(result: ToolCallResult): string {
  const outcome = result.outcome;
  if (outcome?.status === "denied") return outcome.reason;
  if (outcome?.status === "failed") return (outcome.error as Error)?.message ?? "PayPal call failed.";
  return result.content;
}

function updateSettlement(id: string, status: Booking["status"], patch: Partial<Settlement>): Booking {
  const booking = requireBooking(id);
  return saveBooking({ ...booking, status, settlement: { ...booking.settlement!, ...patch } });
}

async function settle(id: string, channel: string) {
  const start = requireBooking(id);
  const { authorizationId: authorization_id, authorizedCents, settlement } = start;
  if (!authorization_id || authorizedCents === undefined || !settlement) throw new Error(`Booking ${id} has no hold to settle.`);
  const ctx = { runId: settlement.runId, actor: "host", channel, guard: new Guard({ paypal: getPayPal(), policy: appConfig.agentPolicy }) };

  let capturedCents = settlement.capturedCents;
  if (settlement.captureId === undefined) {
    const result = await runTool(captureDeposit, { authorization_id, amount_cents: settlement.requestedCents, idempotency_key: `${id}:${settlement.requestedCents}` }, ctx);
    if (result.isError) {
      updateSettlement(id, "reviewed", { error: failureReason(result) });
      return;
    }
    const capture = result.output as { capture_id: string; status: string; amount: { value: string } };
    capturedCents = dollarsToCents(capture.amount.value);
    updateSettlement(id, "captured", { captureId: capture.capture_id, captureStatus: capture.status, capturedCents, error: undefined });
  }

  const paypal = getPayPal();
  if (releasedCents(authorizedCents, capturedCents!) > 0 && (await paypal.payments.getAuthorization(authorization_id)).status !== "VOIDED") {
    const result = await runTool(voidAuthorization, { authorization_id, reason: "Deposit settled: releasing what was not charged" }, ctx);
    if (result.isError) {
      updateSettlement(id, "captured", { error: `The charge went through, but the rest of the hold was not released: ${failureReason(result)}` });
      return;
    }
  }

  // The result screen shows what PayPal says happened, not what we asked for.
  const { captureId } = requireBooking(id).settlement!;
  const capture = await paypal.payments.getCapture(captureId!);
  const auth = await paypal.payments.getAuthorization(authorization_id);
  const confirmedCents = dollarsToCents(capture.amount.value);
  if (confirmedCents !== settlement.requestedCents) throw new RuleError(`PayPal shows ${formatCents(confirmedCents)} captured, not the approved ${formatCents(settlement.requestedCents)}.`);
  updateSettlement(id, "settled", {
    captureStatus: capture.status,
    capturedCents: confirmedCents,
    releasedCents: releasedCents(dollarsToCents(auth.amount.value), confirmedCents),
    authorizationStatus: auth.status,
    settledAt: new Date().toISOString(),
    error: undefined,
  });
}

function start(id: string, channel: string, runId: string) {
  const active = activeSettlements();
  active.add(id);
  return withContext({ channel, runId, actor: "host" }, () => settle(id, channel))
    .catch((e) => {
      const booking = requireBooking(id);
      const message = e instanceof Error ? e.message : String(e);
      // Nothing captured yet means nothing moved: the host can simply try again.
      updateSettlement(id, booking.settlement?.captureId ? "captured" : "reviewed", { error: message });
    })
    .finally(() => active.delete(id));
}

/** Sends the host's exact charge to the approval gate. Resolves when the settlement has finished. */
export function requestSettlement(id: string, chargeCents: number, channel: string): { booking: Booking; finished: Promise<void> } {
  const booking = requireBooking(id);
  if (activeSettlements().has(id)) throw new HttpError(409, "This booking is already being settled.", "conflict");
  if (booking.status !== "reviewed") throw new HttpError(409, `A booking in status ${booking.status} can't be charged.`, "conflict");
  const { holdExpiresAt, authorizedCents } = booking;
  if (!holdExpiresAt || authorizedCents === undefined) throw new HttpError(409, "This booking has no hold.", "conflict");
  try {
    assertHoldOpen(holdExpiresAt);
    assertChargeFits(chargeCents, authorizedCents);
  } catch (e) {
    throw e instanceof RuleError ? new HttpError(422, e.message, "rule") : e;
  }
  const runId = `settle_${randomUUID().slice(0, 12)}`;
  const saved = saveBooking({ ...booking, status: "awaiting_approval", settlement: { runId, requestedCents: chargeCents } });
  return { booking: saved, finished: start(id, channel, runId) };
}

/** Finishes a booking whose charge went through but whose hold was not released. Never charges again. */
export function retryRelease(id: string, channel: string): { booking: Booking; finished: Promise<void> } {
  const booking = requireBooking(id);
  if (activeSettlements().has(id)) throw new HttpError(409, "This booking is already being settled.", "conflict");
  if (booking.status !== "captured" || !booking.settlement) throw new HttpError(409, "Nothing is waiting to be released on this booking.", "conflict");
  return { booking, finished: start(id, channel, booking.settlement.runId) };
}
