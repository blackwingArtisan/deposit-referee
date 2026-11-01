import type { ComponentProps, ReactNode } from "react";
import { cn } from "./cn";

const field =
  "w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-900 shadow-sm placeholder:text-zinc-400 transition focus:border-brand-400 focus:outline-none focus:ring-4 focus:ring-brand-100 disabled:bg-zinc-50 disabled:text-zinc-500";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(field, "h-10", className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cn(field, "min-h-24 py-2", className)} {...props} />;
}

export function Select({ className, ...props }: ComponentProps<"select">) {
  return <select className={cn(field, "h-10 pr-8", className)} {...props} />;
}

export function Label({ className, ...props }: ComponentProps<"label">) {
  return <label className={cn("text-sm font-medium text-zinc-700", className)} {...props} />;
}

/** Label + control + hint/error, stacked. */
export function Field({ label, hint, error, htmlFor, children, className }: { label: ReactNode; hint?: ReactNode; error?: ReactNode; htmlFor?: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error ? <p className="text-xs text-red-600">{error}</p> : hint ? <p className="text-xs text-zinc-500">{hint}</p> : null}
    </div>
  );
}

/** Money input with a currency prefix. */
export function MoneyInput({ currency = "USD", className, ...props }: ComponentProps<"input"> & { currency?: string }) {
  return (
    <div className={cn("relative", className)}>
      <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-zinc-400">{currency === "USD" ? "$" : currency}</span>
      <Input inputMode="decimal" className="pl-7 font-mono tabular-nums" {...props} />
    </div>
  );
}
