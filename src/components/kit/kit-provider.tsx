"use client";

/**
 * Client-side kit context: a per-tab session id (timeline channel), runtime status from
 * /api/kit/status, and kitFetch() which adds the session header and throws ApiError on failure.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export interface KitStatus {
  app: { name: string; slug: string };
  paypal: { mode: "mock" | "sandbox"; clientId: string | null; buyerEmail: string; webhookConfigured: boolean; testCard: boolean };
  ai: { mode: "live" | "mock"; models: { default: string; smart: string }; budget: { capUsd: number; spentUsd: number; remainingUsd: number; calls: number } };
  policy: { currency: string; approvalThreshold: string; maxPerAction: string; maxPerDay: string };
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: { error?: { type?: string; name?: string; message?: string; issue?: string; debug_id?: string } },
  ) {
    super(body.error?.issue ? `${body.error.message}` : (body.error?.message ?? `Request failed (${status})`));
    this.name = "ApiError";
  }
  get debugId() {
    return this.body.error?.debug_id;
  }
}

interface KitContextValue {
  sessionId: string;
  status: KitStatus | null;
  refreshStatus: () => Promise<void>;
  kitFetch: <T = unknown>(path: string, init?: RequestInit & { json?: unknown }) => Promise<T>;
}

const KitContext = createContext<KitContextValue | null>(null);

function getSessionId(): string {
  if (typeof window === "undefined") return "ssr";
  try {
    const existing = sessionStorage.getItem("kit-session");
    if (existing) return existing;
    const id = `s_${crypto.randomUUID().slice(0, 12)}`;
    sessionStorage.setItem("kit-session", id);
    return id;
  } catch {
    return `s_${Math.random().toString(36).slice(2, 14)}`;
  }
}

export function KitProvider({ children }: { children: ReactNode }) {
  const [sessionId] = useState(getSessionId);
  const [status, setStatus] = useState<KitStatus | null>(null);

  const kitFetch = useCallback(
    async <T,>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> => {
      const { json, headers, ...rest } = init;
      const res = await fetch(path, {
        ...rest,
        method: rest.method ?? (json !== undefined ? "POST" : "GET"),
        headers: { "x-kit-session": sessionId, ...(json !== undefined ? { "Content-Type": "application/json" } : {}), ...headers },
        body: json !== undefined ? JSON.stringify(json) : rest.body,
      });
      const ct = res.headers.get("content-type") ?? "";
      const body = ct.includes("application/json") ? await res.json() : await res.text();
      if (!res.ok) throw new ApiError(res.status, typeof body === "object" ? body : { error: { message: String(body) } });
      return body as T;
    },
    [sessionId],
  );

  const refreshStatus = useCallback(async () => {
    try {
      setStatus(await kitFetch<KitStatus>("/api/kit/status"));
    } catch {
      /* status is decorative */
    }
  }, [kitFetch]);

  useEffect(() => {
    let cancelled = false;
    const tick = () =>
      kitFetch<KitStatus>("/api/kit/status")
        .then((s) => {
          if (!cancelled) setStatus(s);
        })
        .catch(() => undefined);
    void tick();
    const t = setInterval(tick, 20_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [kitFetch]);

  const value = useMemo(() => ({ sessionId, status, refreshStatus, kitFetch }), [sessionId, status, refreshStatus, kitFetch]);
  return <KitContext.Provider value={value}>{children}</KitContext.Provider>;
}

export function useKit(): KitContextValue {
  const ctx = useContext(KitContext);
  if (!ctx) throw new Error("useKit must be used inside <KitProvider>");
  return ctx;
}
