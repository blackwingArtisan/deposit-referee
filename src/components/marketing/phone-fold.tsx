"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

/**
 * A table or long list folded on a phone and open on a wider screen. It starts folded, so a phone
 * never shows it and then hides it; a wider screen opens it once the page is running.
 */
export function PhoneFold({ summary, children, testId }: { summary: string; children: ReactNode; testId: string }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (ref.current && window.matchMedia("(min-width: 640px)").matches) ref.current.open = true;
  }, []);
  return (
    <details ref={ref} className="group" data-testid={testId}>
      <summary
        className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 hover:text-zinc-950 sm:hidden [&::-webkit-details-marker]:hidden"
        data-testid={`${testId}-toggle`}
      >
        {summary}
        <ChevronDown className="size-4 transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      {children}
    </details>
  );
}
