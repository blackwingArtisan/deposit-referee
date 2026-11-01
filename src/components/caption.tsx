"use client";

/**
 * Captions for silent demo videos.
 *   const { caption } = useCaption(); caption("The agent captures $80 for the shipped items");
 * Also exposed as window.__kitCaption(text, ms) for Playwright scripts, and shown automatically
 * for agent/PayPal steps when the URL has ?captions=1.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { cn } from "./ui/cn";

const CaptionContext = createContext<{ caption: (text: string, ms?: number) => void; autoCaptions: boolean } | null>(null);

declare global {
  interface Window {
    __kitCaption?: (text: string, ms?: number) => void;
  }
}

export function CaptionProvider({ children }: { children: ReactNode }) {
  const [text, setText] = useState<string | null>(null);
  const [autoCaptions] = useState(() => {
    try {
      return typeof window !== "undefined" && new URLSearchParams(window.location.search).get("captions") === "1";
    } catch {
      return false;
    }
  });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const caption = useCallback((t: string, ms = 3200) => {
    setText(t);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setText(null), ms);
  }, []);

  useEffect(() => {
    window.__kitCaption = caption;
    return () => {
      delete window.__kitCaption;
    };
  }, [caption]);

  const value = useMemo(() => ({ caption, autoCaptions }), [caption, autoCaptions]);
  return (
    <CaptionContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-8 z-[70] flex justify-center px-4" aria-live="polite">
        <div
          className={cn(
            "max-w-3xl rounded-2xl bg-zinc-950/88 px-6 py-3.5 text-center text-lg font-medium leading-snug text-white shadow-2xl ring-1 ring-white/10 backdrop-blur transition-all duration-300",
            text ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0",
          )}
        >
          {text}
        </div>
      </div>
    </CaptionContext.Provider>
  );
}

export function useCaption() {
  const ctx = useContext(CaptionContext);
  if (!ctx) throw new Error("useCaption must be used inside <CaptionProvider>");
  return ctx;
}
