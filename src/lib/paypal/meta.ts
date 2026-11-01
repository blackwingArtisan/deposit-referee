/**
 * Per-call HTTP metadata (status, debug id, request id) passed from the transport (sandbox
 * HTTP or the mock) to the instrumentation layer without changing return types.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { singleton } from "../singleton";

export interface CallMeta {
  httpStatus?: number;
  debugId?: string;
  requestId?: string;
  /** true when PayPal (or the mock) replayed a stored result for a reused PayPal-Request-Id */
  replayed?: boolean;
}

const store = singleton("paypal:meta", () => new AsyncLocalStorage<CallMeta>());

export function runWithCallMeta<T>(meta: CallMeta, fn: () => Promise<T>): Promise<T> {
  return store.run(meta, fn);
}

export function recordCallMeta(patch: CallMeta) {
  const current = store.getStore();
  if (current) Object.assign(current, patch);
}
