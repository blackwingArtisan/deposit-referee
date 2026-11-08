/**
 * Timeline events: the single stream that powers <ToolCallTimeline>. Shared by server and
 * client, so keep this file free of Node imports.
 *
 * Several events can share a `stepId`; the UI merges them into one card (e.g. a tool call
 * that goes running -> awaiting_approval -> succeeded).
 */
import type { Money } from "../money";

export type TimelineKind =
  | "run"
  | "agent.message"
  | "agent.thinking"
  | "tool"
  | "paypal"
  | "approval"
  | "guard"
  | "webhook"
  | "ai"
  | "info";

export type TimelineStatus =
  | "pending"
  | "running"
  | "awaiting_approval"
  | "succeeded"
  | "failed"
  | "denied"
  | "skipped"
  | "info";

export type MoneyDirection = "in" | "out" | "hold" | "neutral";

export type ToolSource = "paypal-agent-toolkit" | "kit-extension" | "app";

export interface TimelineEvent {
  id: string;
  stepId: string;
  /** Session id of the browser tab that caused it, or "global" (webhooks, background jobs). */
  channel: string;
  runId?: string;
  /** The app record this event belongs to, when there is one. */
  bookingId?: string;
  ts: string;
  kind: TimelineKind;
  status: TimelineStatus;
  title: string;
  subtitle?: string;
  detail?: string;
  amount?: Money;
  direction?: MoneyDirection;
  tool?: { name: string; source: ToolSource; input?: unknown; output?: unknown };
  paypal?: {
    operation: string;
    method: string;
    path: string;
    mode: "mock" | "sandbox";
    httpStatus?: number;
    debugId?: string;
    requestId?: string;
    durationMs?: number;
  };
  approval?: { id: string; state: "pending" | "approved" | "denied" | "expired"; reason?: string; decidedBy?: string };
  error?: { name: string; message: string; issue?: string; debugId?: string };
  data?: unknown;
}

/** A card in the UI = all events of one stepId merged (later fields win). */
export interface TimelineStep extends TimelineEvent {
  startedAt: string;
  updatedAt: string;
  history: TimelineStatus[];
}

export function mergeEvents(events: TimelineEvent[]): TimelineStep[] {
  const steps = new Map<string, TimelineStep>();
  for (const e of events) {
    const prev = steps.get(e.stepId);
    if (!prev) {
      steps.set(e.stepId, { ...e, startedAt: e.ts, updatedAt: e.ts, history: [e.status] });
    } else {
      const merged: TimelineStep = {
        ...prev,
        ...Object.fromEntries(Object.entries(e).filter(([, v]) => v !== undefined)),
        id: prev.id,
        startedAt: prev.startedAt,
        updatedAt: e.ts,
        history: prev.history.at(-1) === e.status ? prev.history : [...prev.history, e.status],
      } as TimelineStep;
      steps.set(e.stepId, merged);
    }
  }
  return [...steps.values()].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}
