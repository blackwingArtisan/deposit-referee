import type { ReactNode } from "react";
import { cn } from "./cn";

export type Tone = "neutral" | "brand" | "success" | "warning" | "danger" | "info";

const tones: Record<Tone, string> = {
  neutral: "bg-zinc-100 text-zinc-700 ring-zinc-200",
  brand: "bg-brand-50 text-brand-700 ring-brand-200",
  success: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  warning: "bg-amber-50 text-amber-800 ring-amber-200",
  danger: "bg-red-50 text-red-700 ring-red-200",
  info: "bg-sky-50 text-sky-700 ring-sky-200",
};

export function Badge({ tone = "neutral", children, className, dot }: { tone?: Tone; children: ReactNode; className?: string; dot?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset whitespace-nowrap", tones[tone], className)}>
      {dot ? <span className="size-1.5 rounded-full bg-current opacity-70" /> : null}
      {children}
    </span>
  );
}

const STATUS_TONE: Record<string, Tone> = {
  COMPLETED: "success",
  CAPTURED: "success",
  PAID: "success",
  MARKED_AS_PAID: "success",
  SUCCESS: "success",
  VAULTED: "success",
  APPROVED: "info",
  CREATED: "info",
  SENT: "info",
  SCHEDULED: "info",
  PAYER_ACTION_REQUIRED: "warning",
  PENDING: "warning",
  PROCESSING: "warning",
  PARTIALLY_CAPTURED: "brand",
  PARTIALLY_PAID: "brand",
  PARTIALLY_REFUNDED: "brand",
  UNCLAIMED: "warning",
  WAITING_FOR_SELLER_RESPONSE: "warning",
  UNDER_REVIEW: "warning",
  OPEN: "warning",
  DRAFT: "neutral",
  REFUNDED: "neutral",
  VOIDED: "neutral",
  CANCELLED: "neutral",
  RESOLVED: "neutral",
  DENIED: "danger",
  DECLINED: "danger",
  FAILED: "danger",
  EXPIRED: "danger",
};

/** Colour-coded PayPal status (COMPLETED, PARTIALLY_CAPTURED, VOIDED...). */
export function StatusPill({ status, className }: { status: string; className?: string }) {
  const tone = STATUS_TONE[status?.toUpperCase()] ?? "neutral";
  return (
    <Badge tone={tone} dot className={className}>
      {status.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase())}
    </Badge>
  );
}
