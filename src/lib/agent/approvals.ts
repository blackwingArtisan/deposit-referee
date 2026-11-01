/**
 * Human-in-the-loop approvals. The guard calls request() and awaits the decision; the UI
 * (<ApprovalPrompt>) calls POST /api/agent/approvals/:id which calls decide().
 * In-memory per process (pending approvals die with the process, by design).
 */
import { randomUUID } from "node:crypto";
import { singleton } from "../singleton";
import type { Money } from "../money";

export type ApprovalState = "pending" | "approved" | "denied" | "expired";

export interface Approval {
  id: string;
  runId?: string;
  channel: string;
  tool: string;
  summary: string;
  reason: string;
  amount?: Money;
  counterparties?: string[];
  input: unknown;
  state: ApprovalState;
  createdAt: string;
  expiresAt: string;
  decidedAt?: string;
  decidedBy?: string;
  note?: string;
}

export type ApprovalRequestInput = Omit<Approval, "id" | "state" | "createdAt" | "expiresAt" | "decidedAt" | "decidedBy" | "note">;

export class ApprovalService {
  private approvals = new Map<string, Approval>();
  private waiters = new Map<string, (a: Approval) => void>();
  private listeners = new Set<(a: Approval) => void>();

  request(input: ApprovalRequestInput, timeoutMs: number): { approval: Approval; decision: Promise<Approval> } {
    const now = Date.now();
    const approval: Approval = { ...input, id: `apr_${randomUUID().slice(0, 12)}`, state: "pending", createdAt: new Date(now).toISOString(), expiresAt: new Date(now + timeoutMs).toISOString() };
    this.approvals.set(approval.id, approval);
    const decision = new Promise<Approval>((resolve) => {
      this.waiters.set(approval.id, resolve);
      const timer = setTimeout(() => this.settle(approval.id, "expired", "system"), timeoutMs);
      timer.unref?.();
    });
    this.notify(approval);
    return { approval: { ...approval }, decision };
  }

  decide(id: string, decision: "approved" | "denied", by = "user", note?: string): Approval {
    const a = this.approvals.get(id);
    if (!a) throw Object.assign(new Error(`Approval ${id} not found`), { status: 404 });
    if (a.state !== "pending") throw Object.assign(new Error(`Approval ${id} is already ${a.state}`), { status: 409 });
    return this.settle(id, decision, by, note)!;
  }

  private settle(id: string, state: Exclude<ApprovalState, "pending">, by: string, note?: string): Approval | undefined {
    const a = this.approvals.get(id);
    if (!a || a.state !== "pending") return a;
    a.state = state;
    a.decidedAt = new Date().toISOString();
    a.decidedBy = by;
    a.note = note;
    this.waiters.get(id)?.({ ...a });
    this.waiters.delete(id);
    this.notify(a);
    return { ...a };
  }

  get(id: string): Approval | undefined {
    const a = this.approvals.get(id);
    return a ? { ...a } : undefined;
  }

  list(filter: { state?: ApprovalState; channel?: string; runId?: string } = {}): Approval[] {
    return [...this.approvals.values()]
      .filter((a) => (!filter.state || a.state === filter.state) && (!filter.channel || a.channel === filter.channel) && (!filter.runId || a.runId === filter.runId))
      .map((a) => ({ ...a }));
  }

  onChange(fn: (a: Approval) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify(a: Approval) {
    for (const l of this.listeners) l({ ...a });
  }
}

export function getApprovals(): ApprovalService {
  return singleton("agent:approvals", () => new ApprovalService());
}
