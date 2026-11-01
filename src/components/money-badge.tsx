import { ArrowDownLeft, ArrowUpRight, Lock } from "lucide-react";
import { formatMoney, type Money } from "@/lib/money";
import { cn } from "./ui/cn";

export type MoneyDirection = "in" | "out" | "hold" | "neutral";

const styles: Record<MoneyDirection, string> = {
  in: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  out: "bg-rose-50 text-rose-700 ring-rose-200",
  hold: "bg-amber-50 text-amber-800 ring-amber-200",
  neutral: "bg-zinc-100 text-zinc-800 ring-zinc-200",
};

const icons = { in: ArrowDownLeft, out: ArrowUpRight, hold: Lock, neutral: null } as const;

/**
 * An amount with direction: money in (green, +), out (red, −), held/authorized (amber, lock).
 *   <MoneyBadge amount={{ currency_code: "USD", value: "45.00" }} direction="in" />
 */
export function MoneyBadge({ amount, direction = "neutral", size = "md", className }: { amount: Money | null | undefined; direction?: MoneyDirection; size?: "sm" | "md" | "lg"; className?: string }) {
  if (!amount) return null;
  const Icon = icons[direction];
  const sign = direction === "in" ? "+" : direction === "out" ? "−" : "";
  const text = formatMoney({ ...amount, value: amount.value.replace(/^-/, "") });
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full font-semibold tabular-nums ring-1 ring-inset whitespace-nowrap",
        size === "sm" ? "px-2 py-0.5 text-xs" : size === "lg" ? "px-3 py-1 text-base" : "px-2.5 py-0.5 text-sm",
        styles[direction],
        className,
      )}
      title={`${amount.value} ${amount.currency_code}`}
    >
      {Icon ? <Icon className={size === "lg" ? "size-4" : "size-3.5"} aria-hidden /> : null}
      {sign}
      {text}
    </span>
  );
}
