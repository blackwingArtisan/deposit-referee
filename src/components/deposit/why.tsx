import type { ReactNode } from "react";

/** An explanation folded behind "Why?", so the screen leads with one money headline. */
export function Why({ children, testId = "why", className = "" }: { children: ReactNode; testId?: string; className?: string }) {
  return (
    <details className={`group text-sm text-zinc-700 ${className}`} data-testid={testId}>
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-sm font-medium text-brand underline underline-offset-2 [&::-webkit-details-marker]:hidden" data-testid={`${testId}-toggle`}>
        <span className="group-open:hidden">Why?</span>
        <span className="hidden group-open:inline">Hide why</span>
      </summary>
      <div className="mt-1.5 space-y-1.5">{children}</div>
    </details>
  );
}
