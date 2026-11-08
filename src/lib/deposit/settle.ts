/**
 * Moves the money: the host's decision through the Guard's approval gate, then the capture and
 * the release of the rest, or a void of the whole hold. The route returns while this waits for
 * the host; the browser polls the booking. Every step is saved, so a failed release can be
 * retried without charging again.
 */
import { randomUUID } from "node:crypto";
import { appConfig } from "@/app.config";
import { captureDeposit } from "@/agents/tools/capture-deposit";
import { releaseDeposit } from "@/agents/tools/release-deposit";
import { runTool, type ToolCallResult } from "@/lib/agent/execute";
import { Guard } from "@/lib/agent/guard";
import { voidAuthorization } from "@/lib/agent/tools/extensions";
import { withContext } from "@/lib/events/bus";
import { HttpError } from "@/lib/http";
import { getPayPal } from "@/lib/paypal";
import { activeSettlements, decisionStatus, requireBooking, saveBooking } from "./bookings";
import { assertCaptureLimits, assertHoldOpen, dollarsToCents, formatCents, itemizedCents, releasedCents, renterClearance, RuleError } from "./rules";
import { heldCents, partCapturedCents, splitOf } from "./split-rules";
import type { Booking, Settlement } from "./types";

export function failureReason(result: ToolCallResult): string {
  const outcome = result.outcome;
  if (outcome?.status === "denied" && outcome.code === "APPROVAL_DENIED") {
    return outcome.approval?.decidedBy === "renter" ? "The renter contested before the capture, so it was stopped. No money moved." : "You declined this. No money moved, and the booking stays open for a new decision.";
  }
  if (outcome?.status === "denied") return outcome.reason;
  if (outcome?.status === "failed") return (outcome.error as Error)?.message ?? "PayPal call failed.";
  return result.content;
}

function updateSettlement(id: string, status: Booking["status"], patch: Partial<Settlement>): Booking {
  const booking = requireBooking(id);
  return saveBooking({ ...booking, status, settlement: { ...booking.settlement!, ...patch } });
}

/** Nothing moved, so the decision goes back to the host. */
function backToHost(id: string, error: string) {
  updateSettlement(id, decisionStatus(requireBooking(id)), { error });
}

type ToolCtx = Parameters<typeof runTool>[2];

/** The whole deposit goes back. PayPal's re-read decides whether that happened. */
async function releaseWhole(id: string, authorizationId: string, ctx: ToolCtx) {
  const paypal = getPayPal();
  if ((await paypal.payments.getAuthorization(authorizationId)).status !== "VOIDED") {
    const result = await runTool(releaseDeposit, { booking_id: id, idempotency_key: `${id}:release` }, ctx);
    if (result.isError) return backToHost(id, failureReason(result));
  }
  const auth = await paypal.payments.getAuthorization(authorizationId);
  if (auth.status !== "VOIDED") throw new RuleError(`PayPal shows this hold as ${auth.status}, not voided.`);
  // Anything already charged for accepted items stays charged; the rest of the hold goes back.
  const part = partCapturedCents(requireBooking(id));
  updateSettlement(id, "settled", { capturedCents: part, releasedCents: dollarsToCents(auth.amount.value) - part, authorizationStatus: auth.status, settledAt: new Date().toISOString(), error: undefined });
}

async function settle(id: string, channel: string) {
  const start = requireBooking(id);
  const { authorizationId: authorization_id, authorizedCents, settlement, proposal } = start;
  if (!authorization_id || authorizedCents === undefined || !settlement) throw new Error(`Booking ${id} has no hold to settle.`);
  // The host's approval releases what the agent proposed. If they changed the number, it's theirs.
  const actor = proposal && settlement.requestedCents === proposal.aiCents ? "agent:deposit-settlement" : "host";
  const ctx = { runId: settlement.runId, actor, channel, guard: new Guard({ paypal: getPayPal(), policy: appConfig.agentPolicy }) };
  if (settlement.kind === "release") return releaseWhole(id, authorization_id, ctx);

  let capturedCents = settlement.capturedCents;
  if (settlement.captureId === undefined) {
    const result = await runTool(captureDeposit, { booking_id: id, amount_cents: settlement.requestedCents, idempotency_key: `${id}:${settlement.requestedCents}` }, ctx);
    if (result.isError) return backToHost(id, failureReason(result));
    const capture = result.output as { capture_id: string; status: string; amount: { value: string } };
    capturedCents = dollarsToCents(capture.amount.value);
    updateSettlement(id, "captured", { captureId: capture.capture_id, captureStatus: capture.status, capturedCents, error: undefined });
  }

  const paypal = getPayPal();
  if (releasedCents(heldCents(start), capturedCents!) > 0 && (await paypal.payments.getAuthorization(authorization_id)).status !== "VOIDED") {
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
  // With a split, the accepted items were charged earlier from the same hold, and count here too.
  const part = partCapturedCents(start);
  updateSettlement(id, "settled", {
    captureStatus: capture.status,
    capturedCents: part + confirmedCents,
    releasedCents: releasedCents(dollarsToCents(auth.amount.value) - part, confirmedCents),
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
      updateSettlement(id, booking.settlement?.captureId ? "captured" : decisionStatus(booking), { error: message });
    })
    .finally(() => active.delete(id));
}

function requireDecidable(id: string): Booking & { holdExpiresAt: string; authorizedCents: number } {
  const booking = requireBooking(id);
  if (activeSettlements().has(id)) throw new HttpError(409, "This booking is already being settled.", "conflict");
  if (booking.status !== "proposed" && booking.status !== "contested") throw new HttpError(409, `A booking in status ${booking.status} can't be charged.`, "conflict");
  const { holdExpiresAt, authorizedCents } = booking;
  if (!holdExpiresAt || authorizedCents === undefined) throw new HttpError(409, "This booking has no hold.", "conflict");
  return { ...booking, holdExpiresAt, authorizedCents };
}

function asHttp<T>(check: () => T): T {
  try {
    return check();
  } catch (e) {
    throw e instanceof RuleError ? new HttpError(422, e.message, "rule") : e;
  }
}

function send(booking: Booking, settlement: Omit<Settlement, "runId">, channel: string) {
  const runId = `settle_${randomUUID().slice(0, 12)}`;
  const saved = saveBooking({ ...booking, status: "awaiting_approval", settlement: { ...settlement, runId } });
  return { booking: saved, finished: start(booking.id, channel, runId) };
}

/** Sends the host's exact charge to the approval gate. Resolves when the settlement has finished. */
export function requestSettlement(id: string, chargeCents: number, channel: string): { booking: Booking; finished: Promise<void> } {
  const booking = requireDecidable(id);
  if (splitOf(booking) && !booking.partCapture?.captureId) throw new HttpError(409, "The renter accepted part of this charge. Charge the accepted items first, or release the whole deposit.", "conflict");
  asHttp(() => {
    assertHoldOpen(booking.holdExpiresAt);
    assertCaptureLimits(chargeCents, itemizedCents(booking.proposal?.lines ?? []), heldCents(booking));
    const clearance = renterClearance(booking.renterState, chargeCents);
    if (!clearance.cleared) throw new RuleError(clearance.reason);
  });
  return send(booking, { kind: "charge", requestedCents: chargeCents, contestHeard: booking.status === "contested" }, channel);
}

/** Sends a full release to the approval gate. The renter loses nothing, so they don't have to answer first. */
export function requestRelease(id: string, channel: string): { booking: Booking; finished: Promise<void> } {
  const booking = requireDecidable(id);
  asHttp(() => assertHoldOpen(booking.holdExpiresAt));
  return send(booking, { kind: "release", requestedCents: 0 }, channel);
}

/** Finishes a booking whose charge went through but whose hold was not released. Never charges again. */
export function retryRelease(id: string, channel: string): { booking: Booking; finished: Promise<void> } {
  const booking = requireBooking(id);
  if (activeSettlements().has(id)) throw new HttpError(409, "This booking is already being settled.", "conflict");
  if (booking.status !== "captured" || !booking.settlement) throw new HttpError(409, "Nothing is waiting to be released on this booking.", "conflict");
  return { booking, finished: start(id, channel, booking.settlement.runId) };
}
