"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { LedgerEntry } from "@/lib/paypal/ledger";
import type { TimelineEvent } from "@/lib/events/types";
import { useKit } from "./kit-provider";

/** The local PayPal ledger; call refresh() after actions, or pass the latest timeline event. */
export function useLedger() {
  const { kitFetch } = useKit();
  const [entries, setEntries] = useState<LedgerEntry[] | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await kitFetch<{ entries: LedgerEntry[] }>("/api/paypal/ledger");
      setEntries(res.entries);
    } catch {
      setEntries((e) => e ?? []);
    }
  }, [kitFetch]);

  /** Debounced refresh when PayPal calls or webhooks complete. */
  const onTimelineEvent = useCallback(
    (e: TimelineEvent) => {
      if ((e.kind === "paypal" || e.kind === "webhook") && e.status !== "running") {
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(refresh, 250);
      }
    },
    [refresh],
  );

  useEffect(() => {
    let cancelled = false;
    kitFetch<{ entries: LedgerEntry[] }>("/api/paypal/ledger")
      .then((res) => {
        if (!cancelled) setEntries(res.entries);
      })
      .catch(() => {
        if (!cancelled) setEntries((e) => e ?? []);
      });
    return () => {
      cancelled = true;
    };
  }, [kitFetch]);

  return { entries, refresh, onTimelineEvent };
}
