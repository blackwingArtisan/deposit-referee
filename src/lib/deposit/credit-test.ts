/**
 * Mock mode only: fails one AI step on one booking the way an empty account does, so a browser
 * test can watch what the host sees. The real path is isCreditFailure() in src/lib/ai/client.ts.
 */
import { AiCreditError } from "@/lib/ai/errors";
import { singleton } from "@/lib/singleton";

export type AiStep = "review" | "agent";

const switches = () => singleton("deposit:credit-out", () => new Map<string, AiStep>());

export function setCreditOut(bookingId: string, step: AiStep | null) {
  if (step) switches().set(bookingId, step);
  else switches().delete(bookingId);
}

export function failIfCreditOut(bookingId: string, step: AiStep) {
  if (switches().get(bookingId) === step) throw new AiCreditError();
}
