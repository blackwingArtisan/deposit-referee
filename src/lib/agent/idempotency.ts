/**
 * Idempotency for agent tool calls. The same tool + same input within a run maps to the same
 * key; a second call replays the stored result instead of moving money twice. The key is
 * also sent to PayPal as PayPal-Request-Id, so PayPal de-duplicates too.
 */
import { createHash } from "node:crypto";
import { singleton } from "../singleton";
import { dataPath, readJsonFile, writeJsonFile } from "../store/files";

type Record_ = { state: "in_flight" | "succeeded" | "failed"; result?: unknown; at: number; attempts: number };

const TTL_MS = 24 * 60 * 60 * 1000;

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.keys(value as object)
    .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`)
    .join(",")}}`;
}

/** UUID-shaped (36 chars) so it fits every PayPal-Request-Id limit. */
export function deriveIdempotencyKey(parts: { scope: string; tool: string; input: unknown }): string {
  const h = createHash("sha256").update(`${parts.scope}|${parts.tool}|${stableStringify(parts.input)}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

export class IdempotencyStore {
  private map: Map<string, Record_>;
  constructor(private readonly file: string | null) {
    const loaded = file ? readJsonFile<Record<string, Record_>>(file, {}) : {};
    const now = Date.now();
    this.map = new Map(Object.entries(loaded).filter(([, r]) => now - r.at < TTL_MS && r.state !== "in_flight"));
  }

  get(key: string): Record_ | undefined {
    return this.map.get(key);
  }

  /** false if the key is in flight or already succeeded. */
  begin(key: string): boolean {
    const r = this.map.get(key);
    if (r && (r.state === "in_flight" || r.state === "succeeded")) return false;
    this.map.set(key, { state: "in_flight", at: Date.now(), attempts: (r?.attempts ?? 0) + 1 });
    return true;
  }

  succeed(key: string, result: unknown) {
    this.map.set(key, { state: "succeeded", result, at: Date.now(), attempts: this.map.get(key)?.attempts ?? 1 });
    this.save();
  }

  fail(key: string) {
    const r = this.map.get(key);
    this.map.set(key, { state: "failed", at: Date.now(), attempts: r?.attempts ?? 1 });
    this.save();
  }

  /** PayPal-Request-Id for this attempt: a retry after failure needs a fresh id, or PayPal replays the failure. */
  requestIdFor(key: string): string {
    const attempts = this.map.get(key)?.attempts ?? 1;
    return attempts <= 1 ? key : deriveIdempotencyKey({ scope: key, tool: "retry", input: attempts });
  }

  private save() {
    if (!this.file) return;
    const now = Date.now();
    writeJsonFile(this.file, Object.fromEntries([...this.map].filter(([, r]) => now - r.at < TTL_MS && r.state === "succeeded")));
  }
}

export function getIdempotencyStore(): IdempotencyStore {
  return singleton("agent:idempotency", () => new IdempotencyStore(dataPath("agent-idempotency.json")));
}
