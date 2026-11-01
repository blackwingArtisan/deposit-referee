import type { ReactNode } from "react";
import { cn } from "./cn";

export function Stat({ label, value, hint, icon, className }: { label: ReactNode; value: ReactNode; hint?: ReactNode; icon?: ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-2xl border border-zinc-200/80 bg-white p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04)]", className)}>
      <div className="flex items-center justify-between text-sm text-zinc-500">
        <span>{label}</span>
        {icon ? <span className="text-zinc-400">{icon}</span> : null}
      </div>
      <div className="mt-2 text-2xl font-semibold tracking-tight text-zinc-900 tabular-nums">{value}</div>
      {hint ? <div className="mt-1 text-xs text-zinc-500">{hint}</div> : null}
    </div>
  );
}
