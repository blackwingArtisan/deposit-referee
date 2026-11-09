"use client";

import { Bot, Building2, Smartphone, Wallet } from "lucide-react";
import { conversation, type RailWho } from "@/lib/deposit/conversation";
import type { BookingView } from "@/lib/deposit/types";

const WHO: Record<RailWho, { label: string; icon: typeof Bot; tone: string }> = {
  renter: { label: "Renter", icon: Smartphone, tone: "text-sky-700 bg-sky-50" },
  host: { label: "You", icon: Building2, tone: "text-zinc-700 bg-zinc-100" },
  claude: { label: "Claude", icon: Bot, tone: "text-brand-700 bg-brand-50" },
  paypal: { label: "PayPal", icon: Wallet, tone: "text-emerald-700 bg-emerald-50" },
};

const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" });

/**
 * One slim column that mirrors the renter's side in order: hold placed, proposal opened, each line
 * accepted or contested, Claude's second look, the counter, the settlement. The renter's phone and
 * the host's page read as one exchange.
 */
export function ConversationRail({ booking }: { booking: BookingView }) {
  const entries = conversation(booking);
  return (
    <aside aria-label="With the renter" data-testid="conversation-rail" className="rounded-xl border border-zinc-200/80 bg-white px-4 py-4">
      <h2 className="text-sm font-semibold text-zinc-900">With {booking.renter}</h2>
      <ol className="mt-3 space-y-0">
        {entries.map((entry, i) => {
          const who = WHO[entry.who];
          const Icon = who.icon;
          return (
            <li key={entry.key} data-testid="rail-entry" data-who={entry.who} data-waiting={entry.waiting ? "true" : undefined} className="relative flex gap-2.5 pb-3 last:pb-0">
              {i < entries.length - 1 ? <span className="absolute left-[11px] top-6 bottom-0 w-px bg-zinc-200" aria-hidden /> : null}
              <span className={`relative flex size-6 shrink-0 items-center justify-center rounded-full ${entry.waiting ? "bg-zinc-50 text-zinc-400" : who.tone}`} title={who.label}>
                <Icon className="size-3.5" aria-hidden />
              </span>
              <div className="min-w-0 pt-0.5 text-[13px] leading-snug">
                <p className={entry.waiting ? "text-zinc-500" : "text-zinc-900"}>
                  <span className="sr-only">{who.label}: </span>
                  <span data-testid="rail-text">{entry.text}</span>
                </p>
                {entry.at ? <p className="text-xs tabular-nums text-zinc-500">{entry.waiting ? `by ${day(entry.at)}` : clock(entry.at)}</p> : null}
              </div>
            </li>
          );
        })}
      </ol>
    </aside>
  );
}
