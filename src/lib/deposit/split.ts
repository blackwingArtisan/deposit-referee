/**
 * The renter accepted some items and contested others. The accepted items are charged at once,
 * through the Guard's approval gate like every charge, and never as the final capture, so the
 * contested part stays on the same hold. A person settles that part later (settle.ts), and the
 * settlement voids whatever is left. PayPal can't shrink an authorization, so the app's own limit
 * keeps any further charge to the contested amount. Server only.
 */
import { randomUUID } from "node:crypto";
import { appConfig } from "@/app.config";
import { captureAcceptedItems } from "@/agents/tools/capture-accepted";
import { runTool } from "@/lib/agent/execute";
import { Guard } from "@/lib/agent/guard";
import { getContext, withContext } from "@/lib/events/bus";
import { HttpError } from "@/lib/http";
import { getPayPal } from "@/lib/paypal";
import { activeSettlements, requireBooking, saveBooking } from "./bookings";
import { dollarsToCents, formatExactCents, RuleError } from "./rules";
import { failureReason } from "./settle";
import { splitOf } from "./split-rules";
import type { Booking } from "./types";

async function capturePart(id: string, channel: string, runId: string) {
  const part = requireBooking(id).partCapture!;
  const ctx = { runId, actor: "host", channel, guard: new Guard({ paypal: getPayPal(), policy: appConfig.agentPolicy }) };
  const result = await runTool(captureAcceptedItems, { booking_id: id, amount_cents: part.requestedCents, idempotency_key: `${id}:accepted:${part.requestedCents}` }, ctx);
  if (result.isError) {
    const now = requireBooking(id);
    saveBooking({ ...now, status: "contested", partCapture: { ...now.partCapture!, error: failureReason(result) } });
    return;
  }

  // What the host sees is what PayPal says it captured, read back.
  const { capture_id } = result.output as { capture_id: string };
  const capture = await getPayPal().payments.getCapture(capture_id);
  const cents = dollarsToCents(capture.amount.value);
  if (cents !== part.requestedCents) throw new RuleError(`PayPal shows ${formatExactCents(cents)} captured, not the approved ${formatExactCents(part.requestedCents)}.`);
  const now = requireBooking(id);
  const contested = now.proposal!.lines.filter((line) => !part.lines.some((accepted) => accepted.id === line.id));
  saveBooking({
    ...now,
    status: "contested",
    partCapture: { ...now.partCapture!, captureId: capture.id, captureStatus: capture.status, capturedCents: cents, finalCapture: capture.final_capture, capturedAt: new Date().toISOString(), error: undefined },
    // From here the decision is only about the contested items.
    proposal: { ...now.proposal!, lines: contested, aiCents: contested.reduce((sum, line) => sum + (line.aiCents ?? line.amountCents), 0) },
  });
}

/** Sends the accepted items' charge to the approval gate. Resolves when it has finished. */
export function requestPartCapture(id: string, channel = getContext().channel): { booking: Booking; finished: Promise<void> } {
  const booking = requireBooking(id);
  if (activeSettlements().has(id)) throw new HttpError(409, "This booking is already being settled.", "conflict");
  if (booking.status !== "contested") throw new HttpError(409, `A booking in status ${booking.status} can't be charged.`, "conflict");
  const split = splitOf(booking);
  if (!split || booking.partCapture?.captureId) throw new HttpError(409, "There are no accepted items left to charge on their own.", "conflict");

  const runId = `part_${randomUUID().slice(0, 12)}`;
  const saved = saveBooking({ ...booking, status: "awaiting_approval", partCapture: { runId, lines: split.accepted, requestedCents: split.acceptedCents, contestedCents: split.contestedCents } });
  const active = activeSettlements();
  active.add(id);
  const finished = withContext({ channel, runId, actor: "host" }, () => capturePart(id, channel, runId))
    .catch((e) => {
      const now = requireBooking(id);
      saveBooking({ ...now, status: "contested", partCapture: { ...now.partCapture!, error: e instanceof Error ? e.message : String(e) } });
    })
    .finally(() => active.delete(id));
  return { booking: saved, finished };
}
