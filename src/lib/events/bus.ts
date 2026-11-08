/**
 * In-process event bus + request context.
 *
 *   await withContext({ channel: sessionId }, async () => { ...paypal calls emit events... })
 *   const step = startStep({ kind: "tool", title: "Capture $40" });
 *   step.update({ status: "awaiting_approval" }); step.succeed({ detail: "Captured" });
 *
 * Server-only (AsyncLocalStorage). The browser receives events over SSE (/api/events).
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { singleton } from "../singleton";
import type { TimelineEvent, TimelineStatus } from "./types";

export interface EventContext {
  channel: string;
  runId?: string;
  /** "user", "agent:<runId>", "system", "webhook" */
  actor: string;
  /** App record the work belongs to (e.g. a booking), so its events can be kept with it. */
  bookingId?: string;
}

const storage = singleton("events:als", () => new AsyncLocalStorage<EventContext>());

export function withContext<T>(ctx: Partial<EventContext>, fn: () => T): T {
  const parent = storage.getStore();
  return storage.run({ channel: "global", actor: "system", ...parent, ...ctx }, fn);
}

export function getContext(): EventContext {
  return storage.getStore() ?? { channel: "global", actor: "system" };
}

type Listener = (event: TimelineEvent) => void;

class TimelineBus {
  private buffer: TimelineEvent[] = [];
  private listeners = new Set<Listener>();
  constructor(private max = 3000) {}

  emit(input: Omit<TimelineEvent, "id" | "ts" | "channel" | "stepId"> & { channel?: string; stepId?: string }): TimelineEvent {
    const ctx = getContext();
    const event: TimelineEvent = {
      ...input,
      id: randomUUID(),
      stepId: input.stepId ?? randomUUID(),
      ts: new Date().toISOString(),
      channel: input.channel ?? ctx.channel,
      runId: input.runId ?? ctx.runId,
      bookingId: input.bookingId ?? ctx.bookingId,
    };
    this.buffer.push(event);
    if (this.buffer.length > this.max) this.buffer.splice(0, this.buffer.length - this.max);
    for (const l of this.listeners) {
      try {
        l(event);
      } catch {
        /* a broken SSE client must not break the emitter */
      }
    }
    return event;
  }

  history(filter: { channels?: string[]; runId?: string } = {}): TimelineEvent[] {
    return this.buffer.filter(
      (e) => (!filter.channels || filter.channels.includes(e.channel)) && (!filter.runId || e.runId === filter.runId),
    );
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  clear() {
    this.buffer = [];
  }
}

export const timeline = singleton("events:bus", () => new TimelineBus());

type EmitInput = Parameters<TimelineBus["emit"]>[0];

export interface Step {
  stepId: string;
  update(patch: Partial<EmitInput>): void;
  succeed(patch?: Partial<EmitInput>): void;
  fail(error: unknown, patch?: Partial<EmitInput>): void;
}

export function startStep(input: Omit<EmitInput, "status"> & { status?: TimelineStatus }): Step {
  const first = timeline.emit({ status: "running", ...input });
  const base = { kind: input.kind, title: input.title, stepId: first.stepId, channel: first.channel, runId: first.runId };
  return {
    stepId: first.stepId,
    update: (patch) => timeline.emit({ ...base, status: "running", ...patch }),
    succeed: (patch) => timeline.emit({ ...base, status: "succeeded", ...patch }),
    fail: (error, patch) =>
      timeline.emit({ ...base, status: "failed", error: describeError(error), ...patch }),
  };
}

export function describeError(error: unknown): TimelineEvent["error"] {
  if (error && typeof error === "object") {
    const e = error as { name?: string; message?: string; issue?: string; debugId?: string };
    return { name: e.name ?? "Error", message: e.message ?? String(error), issue: e.issue, debugId: e.debugId };
  }
  return { name: "Error", message: String(error) };
}
