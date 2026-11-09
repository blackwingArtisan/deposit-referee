"use client";

import { useState } from "react";
import { Check, Copy, Smartphone } from "lucide-react";
import { useKit } from "@/components/kit/kit-provider";
import { useToast } from "@/components/toast";
import { Button, Card } from "@/components/ui";
import type { BookingView } from "@/lib/deposit/types";

/**
 * Only in the host's browser: a one-time link that opens this booking as its host on another
 * device (a phone, say). The link works once, for 30 minutes; only its hash is kept.
 */
export function HostLink({ booking }: { booking: BookingView }) {
  const { kitFetch } = useKit();
  const { toast } = useToast();
  const [link, setLink] = useState<{ url: string; expiresAt: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  if (booking.viewer !== "host") return null;

  const make = async () => {
    setBusy(true);
    try {
      const made = await kitFetch<{ path: string; expiresAt: string }>(`/api/bookings/${booking.id}/host-link`, { method: "POST" });
      setLink({ url: new URL(made.path, window.location.origin).toString(), expiresAt: made.expiresAt });
      setCopied(false);
    } catch (error) {
      toast({ title: "Could not make the link", description: error instanceof Error ? error.message : undefined, variant: "error" });
    } finally {
      setBusy(false);
    }
  };
  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
    } catch {
      toast({ title: "Copy didn't work here", description: "Select the link and copy it by hand.", variant: "error" });
    }
  };
  const until = link ? new Date(link.expiresAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";

  return (
    <Card>
      <div className="space-y-3 px-5 py-4 text-sm" data-testid="host-link">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-start gap-2">
            <Smartphone className="mt-0.5 size-4 shrink-0 text-zinc-500" aria-hidden />
            <div className="min-w-0">
              <p className="font-semibold text-zinc-900">Open on another device</p>
            </div>
          </div>
          <Button variant="secondary" size="sm" loading={busy} disabled={busy} onClick={make} data-testid="host-link-make">
            {link ? "Make a new link" : "Make a one-time link"}
          </Button>
        </div>
        {link ? (
          <div className="space-y-2">
            <div className="flex gap-2">
              <input readOnly value={link.url} onFocus={(e) => e.currentTarget.select()} aria-label="One-time host link" className="min-w-0 flex-1 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-1.5 font-mono text-xs text-zinc-700" data-testid="host-link-url" />
              <Button variant="secondary" size="sm" icon={copied ? <Check className="size-4" /> : <Copy className="size-4" />} onClick={copy} data-testid="host-link-copy">
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
            <p className="text-xs text-zinc-500" data-testid="host-link-terms">
              Works once, until {until}. Anyone who opens it first becomes a host of this booking, so send it only to yourself.
            </p>
          </div>
        ) : null}
      </div>
    </Card>
  );
}
