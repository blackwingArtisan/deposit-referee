/**
 * Guard policy: the rules every money-moving agent tool call must pass.
 * Override per app in src/app.config.ts (agentPolicy) or per agent in its definition.
 */
import { singleton } from "../singleton";
import { dataPath, readJsonFile, writeJsonFile } from "../store/files";
import { moneyFromMinor, toMinor, type Money } from "../money";

export interface GuardPolicy {
  /** Caps below are in this currency. Money in other currencies always needs approval. */
  currency: string;
  /** Hard cap for any single tool call that has an amount (decimal string). */
  maxPerAction: string;
  /** Hard cap on money moved by agents per UTC day, across all runs. */
  maxPerDay: string;
  /** Money-moving calls above this amount wait for a human. "0" = approve everything. */
  approvalThreshold: string;
  /**
   * If set, every counterparty a money tool pays (payout receivers, etc.) must match one of
   * these patterns ("*" wildcard, case-insensitive), e.g. ["*@example.com"].
   */
  allowedCounterparties?: string[];
  /** These tools always need a human, whatever the amount. */
  requireApprovalFor?: string[];
  /** Never allowed. */
  blockedTools?: string[];
  approvalTimeoutMs: number;
}

export const DEFAULT_POLICY: GuardPolicy = {
  currency: "USD",
  maxPerAction: "500.00",
  maxPerDay: "2000.00",
  approvalThreshold: "50.00",
  allowedCounterparties: ["*@example.com", "*@personal.example.com", "*@business.example.com"],
  requireApprovalFor: ["accept_dispute_claim"],
  blockedTools: [],
  approvalTimeoutMs: 5 * 60 * 1000,
};

export function matchesPattern(value: string, pattern: string): boolean {
  const re = new RegExp(`^${pattern.split("*").map((p) => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`, "i");
  return re.test(value);
}

export function describePolicy(p: GuardPolicy): string {
  return [
    `Single action cap: ${p.maxPerAction} ${p.currency}.`,
    `Daily cap across all agent actions: ${p.maxPerDay} ${p.currency}.`,
    `Money movements above ${p.approvalThreshold} ${p.currency} wait for human approval.`,
    p.allowedCounterparties?.length ? `Payees must match: ${p.allowedCounterparties.join(", ")}.` : "",
    p.requireApprovalFor?.length ? `Always needs approval: ${p.requireApprovalFor.join(", ")}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/** Money moved by agents today (persisted), with reservations so concurrent calls can't overshoot. */
export class DailyMoneyCounter {
  private pending = new Map<string, number>();
  constructor(private readonly file: string | null) {}
  private mem = { day: "", currency: "USD", minor: 0 };

  private read(currency: string) {
    const day = new Date().toISOString().slice(0, 10);
    const data = this.file ? readJsonFile(this.file, this.mem) : this.mem;
    return data.day === day && data.currency === currency ? data : { day, currency, minor: 0 };
  }

  used(currency: string): Money {
    const pendingMinor = [...this.pending.values()].reduce((a, b) => a + b, 0);
    const minor = this.read(currency).minor + pendingMinor;
    return moneyFromMinor(minor, currency);
  }

  /** Returns false if amount would exceed the cap. */
  reserve(key: string, amount: Money, cap: Money): boolean {
    const usedMinor = toMinor(this.used(amount.currency_code).value, amount.currency_code);
    const add = toMinor(amount.value, amount.currency_code);
    if (usedMinor + add > toMinor(cap.value, cap.currency_code)) return false;
    this.pending.set(key, add);
    return true;
  }

  commit(key: string, currency: string) {
    const add = this.pending.get(key) ?? 0;
    this.pending.delete(key);
    const data = this.read(currency);
    const next = { ...data, minor: data.minor + add };
    this.mem = next;
    if (this.file) writeJsonFile(this.file, next);
  }

  rollback(key: string) {
    this.pending.delete(key);
  }
}

export function getDailyMoneyCounter(): DailyMoneyCounter {
  return singleton("agent:daily-money", () => new DailyMoneyCounter(dataPath("agent-spend.json")));
}
