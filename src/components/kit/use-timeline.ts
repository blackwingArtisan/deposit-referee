"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { mergeEvents, type TimelineEvent, type TimelineStep } from "@/lib/events/types";
import { useKit } from "./kit-provider";

/**
 * Live timeline for this tab's session (+ "global" events such as webhooks).
 *   const { steps, events, connected } = useTimeline({ includeGlobal: true });
 */
export function useTimeline(opts: { includeGlobal?: boolean; runId?: string; onEvent?: (e: TimelineEvent) => void } = {}) {
  const { sessionId } = useKit();
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const { includeGlobal = true, runId } = opts;
  // Keep the latest callback without re-subscribing (avoids stale closures in onEvent).
  const onEventRef = useRef(opts.onEvent);
  useEffect(() => {
    onEventRef.current = opts.onEvent;
  });

  useEffect(() => {
    if (sessionId === "ssr") return;
    const channels = [sessionId, ...(includeGlobal ? ["global"] : [])].join(",");
    const params = new URLSearchParams({ channels, ...(runId ? { runId } : {}) });
    const source = new EventSource(`/api/events?${params}`);
    source.addEventListener("open", () => setConnected(true));
    source.addEventListener("error", () => setConnected(false));
    source.addEventListener("snapshot", (e) => setEvents(JSON.parse((e as MessageEvent).data)));
    source.addEventListener("timeline", (e) => {
      const event = JSON.parse((e as MessageEvent).data) as TimelineEvent;
      setEvents((prev) => [...prev, event].slice(-1500));
      onEventRef.current?.(event);
    });
    return () => source.close();
  }, [sessionId, includeGlobal, runId]);

  const steps: TimelineStep[] = useMemo(() => mergeEvents(events), [events]);
  return { events, steps, connected, clear: () => setEvents([]) };
}
