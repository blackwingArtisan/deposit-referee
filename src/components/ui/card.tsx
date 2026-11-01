import type { ComponentProps, ReactNode } from "react";
import { cn } from "./cn";

export function Card({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("rounded-2xl border border-zinc-200/80 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04)]", className)} {...props} />;
}

export function CardHeader({ title, description, action, className }: { title: ReactNode; description?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-start justify-between gap-4 border-b border-zinc-100 px-5 py-4", className)}>
      <div className="min-w-0">
        <h3 className="text-[15px] font-semibold tracking-tight text-zinc-900">{title}</h3>
        {description ? <p className="mt-0.5 text-sm text-zinc-500">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function CardBody({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("px-5 py-4", className)} {...props} />;
}

export function CardFooter({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("flex items-center justify-end gap-2 border-t border-zinc-100 px-5 py-3", className)} {...props} />;
}
