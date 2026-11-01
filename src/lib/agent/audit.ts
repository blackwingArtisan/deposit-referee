/**
 * Append-only, hash-chained audit log of everything the guard decides
 * (.data/audit.jsonl). There is no update or delete API; verify() detects tampering.
 */
import { createHash } from "node:crypto";
import { singleton } from "../singleton";
import { appendJsonLine, dataPath, readJsonLines } from "../store/files";
import type { Money } from "../money";

export type AuditAction =
  | "tool.requested"
  | "tool.denied"
  | "tool.replayed"
  | "tool.executed"
  | "tool.failed"
  | "approval.requested"
  | "approval.approved"
  | "approval.denied"
  | "approval.expired";

export interface AuditEntry {
  seq: number;
  ts: string;
  action: AuditAction;
  actor: string;
  runId?: string;
  tool?: string;
  risk?: string;
  amount?: Money;
  counterparties?: string[];
  idempotencyKey?: string;
  approvalId?: string;
  reason?: string;
  input?: unknown;
  result?: unknown;
  prevHash: string;
  hash: string;
}

export type AuditInput = Omit<AuditEntry, "seq" | "ts" | "prevHash" | "hash">;

const GENESIS = "0".repeat(64);
const SECRET_KEY = /secret|password|access_token|authorization|api_key|card_number|cvv/i;

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, SECRET_KEY.test(k) ? "[redacted]" : redact(v, depth + 1)]));
}

/** Keeps audit lines small: ids and statuses of a PayPal response, not the whole thing. */
export function resultRef(result: unknown): unknown {
  if (!result || typeof result !== "object") return result;
  const r = result as Record<string, unknown>;
  const pick = (o: Record<string, unknown>) =>
    Object.fromEntries(["id", "status", "dispute_id", "payment_id", "href", "final_capture"].filter((k) => k in o).map((k) => [k, o[k]]));
  if (r.batch_header && typeof r.batch_header === "object") {
    const h = r.batch_header as Record<string, unknown>;
    return { payout_batch_id: h.payout_batch_id, batch_status: h.batch_status };
  }
  if (r.response && typeof r.response === "object") return { status: r.status, ...pick(r.response as Record<string, unknown>) };
  const picked = pick(r);
  return Object.keys(picked).length ? picked : "[result]";
}

function hashOf(entry: Omit<AuditEntry, "hash">): string {
  return createHash("sha256").update(JSON.stringify(entry)).digest("hex");
}

export class AuditLog {
  private entries: AuditEntry[] | null = null;
  constructor(private readonly file: string | null) {}

  private load(): AuditEntry[] {
    if (!this.entries) this.entries = this.file ? readJsonLines<AuditEntry>(this.file) : [];
    return this.entries;
  }

  append(input: AuditInput): AuditEntry {
    const entries = this.load();
    const prev = entries.at(-1);
    const base: Omit<AuditEntry, "hash"> = {
      ...input,
      input: input.input === undefined ? undefined : redact(input.input),
      seq: (prev?.seq ?? 0) + 1,
      ts: new Date().toISOString(),
      prevHash: prev?.hash ?? GENESIS,
    };
    const entry: AuditEntry = { ...base, hash: hashOf(base) };
    entries.push(entry);
    if (this.file) appendJsonLine(this.file, entry);
    return entry;
  }

  list(filter: { runId?: string; tool?: string; limit?: number } = {}): AuditEntry[] {
    const all = this.load().filter((e) => (!filter.runId || e.runId === filter.runId) && (!filter.tool || e.tool === filter.tool));
    return filter.limit ? all.slice(-filter.limit) : all;
  }

  /** Recomputes the hash chain. Returns the first broken seq if any line was edited or removed. */
  verify(entries: AuditEntry[] = this.load()): { ok: boolean; brokenAt?: number; count: number } {
    let prevHash = GENESIS;
    for (const e of entries) {
      const { hash, ...rest } = e;
      if (e.prevHash !== prevHash || hashOf(rest) !== hash) return { ok: false, brokenAt: e.seq, count: entries.length };
      prevHash = hash;
    }
    return { ok: true, count: entries.length };
  }
}

export function getAuditLog(): AuditLog {
  return singleton("agent:audit", () => new AuditLog(dataPath("audit.jsonl")));
}
