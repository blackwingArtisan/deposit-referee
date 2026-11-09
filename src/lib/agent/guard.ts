/**
 * The guard every agent tool call passes through:
 *
 *   blocked? -> idempotent replay? -> resolve impact (amount, payees) -> per-action cap ->
 *   payee allowlist -> daily cap -> human approval (above threshold) -> execute -> audit
 *
 * Every decision is appended to the audit log. Denials come back as structured results the
 * model can read ("DENIED_BY_GUARD"), never as silent failures.
 */
import { compareMoney, formatMoney, money, type Money } from "../money";
import type { PayPalApi } from "../paypal/api";
import { asTool } from "../events/bus";
import { getApprovals, type Approval, type ApprovalService } from "./approvals";
import { getAuditLog, resultRef, type AuditLog } from "./audit";
import { deriveIdempotencyKey, getIdempotencyStore, type IdempotencyStore } from "./idempotency";
import { DEFAULT_POLICY, getDailyMoneyCounter, matchesPattern, type DailyMoneyCounter, type GuardPolicy } from "./policy";
import type { AgentTool, ToolImpact } from "./tool";

export type DenyCode =
  | "BLOCKED_TOOL"
  | "OVER_ACTION_CAP"
  | "OVER_DAILY_CAP"
  | "COUNTERPARTY_NOT_ALLOWED"
  | "APPROVAL_DENIED"
  | "APPROVAL_EXPIRED"
  | "DUPLICATE_IN_FLIGHT";

export type GuardOutcome =
  | { status: "executed"; result: unknown; idempotencyKey: string; replayed: boolean; impact?: ToolImpact; approval?: Approval }
  | { status: "denied"; code: DenyCode; reason: string; impact?: ToolImpact; approval?: Approval }
  | { status: "failed"; error: unknown; impact?: ToolImpact; approval?: Approval };

export interface GuardCallContext {
  runId: string;
  actor: string;
  channel: string;
  onImpact?(impact: ToolImpact): void;
  onApprovalRequested?(approval: Approval): void;
  onApprovalDecided?(approval: Approval): void;
}

export interface GuardDeps {
  policy?: Partial<GuardPolicy>;
  paypal: PayPalApi;
  approvals?: ApprovalService;
  audit?: AuditLog;
  idempotency?: IdempotencyStore;
  daily?: DailyMoneyCounter;
}

export class Guard {
  readonly policy: GuardPolicy;
  private readonly approvals: ApprovalService;
  private readonly audit: AuditLog;
  private readonly idempotency: IdempotencyStore;
  private readonly daily: DailyMoneyCounter;
  private readonly paypal: PayPalApi;

  constructor(deps: GuardDeps) {
    this.policy = { ...DEFAULT_POLICY, ...deps.policy };
    this.paypal = deps.paypal;
    this.approvals = deps.approvals ?? getApprovals();
    this.audit = deps.audit ?? getAuditLog();
    this.idempotency = deps.idempotency ?? getIdempotencyStore();
    this.daily = deps.daily ?? getDailyMoneyCounter();
  }

  async run<I>(tool: AgentTool<I>, input: I, ctx: GuardCallContext): Promise<GuardOutcome> {
    const p = this.policy;
    const base = { actor: ctx.actor, runId: ctx.runId, tool: tool.name, risk: tool.risk };
    const deny = (code: DenyCode, reason: string, extra: { impact?: ToolImpact; approval?: Approval; key?: string } = {}): GuardOutcome => {
      this.audit.append({ ...base, action: "tool.denied", reason: `${code}: ${reason}`, amount: extra.impact?.amount, counterparties: extra.impact?.counterparties, idempotencyKey: extra.key, approvalId: extra.approval?.id });
      return { status: "denied", code, reason, impact: extra.impact, approval: extra.approval };
    };

    this.audit.append({ ...base, action: "tool.requested", input });

    if (p.blockedTools?.includes(tool.name)) return deny("BLOCKED_TOOL", `${tool.name} is blocked by policy.`);

    // Reads skip the money checks entirely.
    if (tool.risk === "read") {
      try {
        const result = await asTool(tool, () => tool.execute(input, { runId: ctx.runId, actor: ctx.actor, paypal: this.paypal, idempotencyKey: "", requestId: "" }));
        return { status: "executed", result, idempotencyKey: "", replayed: false };
      } catch (error) {
        this.audit.append({ ...base, action: "tool.failed", reason: errorMessage(error) });
        return { status: "failed", error };
      }
    }

    // Same tool + same input in the same run (or same explicit key) => same idempotency key.
    const explicitKey = (input as { idempotency_key?: string } | null)?.idempotency_key;
    const { idempotency_key: _omit, ...keyInput } = (input ?? {}) as Record<string, unknown>;
    void _omit;
    const key = deriveIdempotencyKey({ scope: explicitKey ? `explicit:${explicitKey}` : ctx.runId, tool: tool.name, input: keyInput });
    const existing = this.idempotency.get(key);
    if (existing?.state === "succeeded") {
      this.audit.append({ ...base, action: "tool.replayed", idempotencyKey: key, result: resultRef(existing.result) });
      return { status: "executed", result: existing.result, idempotencyKey: key, replayed: true };
    }
    if (existing?.state === "in_flight") return deny("DUPLICATE_IN_FLIGHT", "An identical call is already running.", { key });

    let impact: ToolImpact | undefined;
    if (tool.impact) {
      try {
        impact = await asTool(tool, () => tool.impact!(input, { runId: ctx.runId, actor: ctx.actor, paypal: this.paypal }));
        ctx.onImpact?.(impact);
      } catch (error) {
        this.audit.append({ ...base, action: "tool.failed", reason: `Could not resolve impact: ${errorMessage(error)}` });
        return { status: "failed", error };
      }
    }

    let approvalReason = p.requireApprovalFor?.includes(tool.name) ? `${tool.name} always requires human approval.` : undefined;
    const amount = impact?.amount;
    const inPolicyCurrency = amount ? amount.currency_code === p.currency : false;
    if (amount) {
      if (!inPolicyCurrency) {
        approvalReason ??= `${amount.currency_code} amounts are not covered by the ${p.currency} caps.`;
      } else {
        const cap = money(p.maxPerAction, p.currency);
        if (compareMoney(amount, cap) > 0) return deny("OVER_ACTION_CAP", `${formatMoney(amount)} exceeds the per-action cap of ${formatMoney(cap)}.`, { impact, key });
        const threshold = money(p.approvalThreshold, p.currency);
        if (tool.risk === "money" && compareMoney(amount, threshold) > 0) {
          approvalReason ??= `${formatMoney(amount)} is above the ${formatMoney(threshold)} approval threshold.`;
        }
      }
    }

    if (tool.risk === "money" && p.allowedCounterparties?.length && impact?.counterparties?.length) {
      const notAllowed = impact.counterparties.filter((c) => !p.allowedCounterparties!.some((pattern) => matchesPattern(c, pattern)));
      if (notAllowed.length) return deny("COUNTERPARTY_NOT_ALLOWED", `Not on the payee allowlist: ${notAllowed.join(", ")}.`, { impact, key });
    }

    let reserved = false;
    if (tool.risk === "money" && amount && inPolicyCurrency) {
      const dayCap = money(p.maxPerDay, p.currency);
      if (!this.daily.reserve(key, amount, dayCap)) {
        return deny("OVER_DAILY_CAP", `The app moves at most ${formatMoney(dayCap)} a day, and ${formatMoney(this.daily.used(p.currency))} has already moved today, so this ${formatMoney(amount)} was stopped. No money moved.`, { impact, key });
      }
      reserved = true;
    }
    const release = () => {
      if (reserved) this.daily.rollback(key);
    };

    if (!this.idempotency.begin(key)) {
      release();
      return deny("DUPLICATE_IN_FLIGHT", "An identical call is already running.", { impact, key });
    }

    let approval: Approval | undefined;
    if (approvalReason) {
      const { approval: pending, decision } = this.approvals.request(
        { runId: ctx.runId, channel: ctx.channel, tool: tool.name, summary: impact?.summary ?? tool.title?.(input) ?? tool.name, reason: approvalReason, amount, counterparties: impact?.counterparties, input },
        p.approvalTimeoutMs,
      );
      this.audit.append({ ...base, action: "approval.requested", approvalId: pending.id, reason: approvalReason, amount, idempotencyKey: key });
      ctx.onApprovalRequested?.(pending);
      approval = await decision;
      this.audit.append({ ...base, action: `approval.${approval.state as "approved" | "denied" | "expired"}`, approvalId: approval.id, actor: approval.decidedBy ?? "system", reason: approval.note });
      ctx.onApprovalDecided?.(approval);
      if (approval.state !== "approved") {
        release();
        this.idempotency.fail(key);
        return approval.state === "expired"
          ? deny("APPROVAL_EXPIRED", "Nobody approved this in time.", { impact, approval, key })
          : deny("APPROVAL_DENIED", `A human declined: ${approval.note ?? "no reason given"}.`, { impact, approval, key });
      }
    }

    try {
      const result = await asTool(tool, () => tool.execute(input, { runId: ctx.runId, actor: ctx.actor, paypal: this.paypal, idempotencyKey: key, requestId: this.idempotency.requestIdFor(key) }));
      this.idempotency.succeed(key, result);
      if (reserved) this.daily.commit(key, p.currency);
      this.audit.append({ ...base, action: "tool.executed", amount, counterparties: impact?.counterparties, idempotencyKey: key, approvalId: approval?.id, result: resultRef(result) });
      return { status: "executed", result, idempotencyKey: key, replayed: false, impact, approval };
    } catch (error) {
      this.idempotency.fail(key);
      release();
      this.audit.append({ ...base, action: "tool.failed", amount, idempotencyKey: key, approvalId: approval?.id, reason: errorMessage(error) });
      return { status: "failed", error, impact, approval };
    }
  }
}

function errorMessage(error: unknown): string {
  if (error && typeof error === "object") {
    const e = error as { message?: string; debugId?: string };
    return `${e.message ?? String(error)}${e.debugId ? ` (debug_id ${e.debugId})` : ""}`;
  }
  return String(error);
}

export type { Money };
