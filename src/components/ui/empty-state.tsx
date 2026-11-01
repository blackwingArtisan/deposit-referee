import type { ReactNode } from "react";
import { Inbox } from "lucide-react";
import { cn } from "./cn";

export function EmptyState({ icon, title, description, action, className }: { icon?: ReactNode; title: ReactNode; description?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center rounded-xl border border-dashed border-zinc-200 bg-zinc-50/50 px-6 py-10 text-center", className)}>
      <div className="mb-3 flex size-11 items-center justify-center rounded-full bg-white text-zinc-400 shadow-sm ring-1 ring-zinc-200">{icon ?? <Inbox className="size-5" />}</div>
      <p className="text-sm font-semibold text-zinc-800">{title}</p>
      {description ? <p className="mt-1 max-w-sm text-sm text-zinc-500">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
