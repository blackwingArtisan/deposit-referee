"use client";

import { useEffect, useState, useSyncExternalStore, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useKit } from "@/components/kit/kit-provider";
import { PageHeader } from "@/components/shell/app-shell";
import { useToast } from "@/components/toast";
import { Badge, Button, Card, CardBody, CardHeader, Field, Input, MoneyInput } from "@/components/ui";
import { formatCents, MAX_DEPOSIT_CENTS, MIN_DEPOSIT_CENTS, parseDeposit } from "@/lib/deposit/rules";
import type { BookingListItem, BookingView } from "@/lib/deposit/types";

function outcome(booking: BookingListItem): string {
  const s = booking.settlement;
  if (booking.status === "settled" && s?.capturedCents !== undefined && s.releasedCents !== undefined) return `${formatCents(s.capturedCents)} captured, ${formatCents(s.releasedCents)} released`;
  if (booking.status === "draft") return "Waiting for the renter’s hold";
  return `${formatCents(booking.depositCents)} on hold`;
}

const noSubscription = () => () => undefined;

export default function BookingsPage() {
  const { kitFetch } = useKit();
  const { toast } = useToast();
  const router = useRouter();
  const [bookings, setBookings] = useState<BookingListItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [depositError, setDepositError] = useState<string | null>(null);
  // On a slow phone the form is on screen before React is running. The fields are uncontrolled so
  // React keeps what was already typed, and the button waits so the form can't submit natively.
  const hydrated = useSyncExternalStore(noSubscription, () => true, () => false);

  useEffect(() => {
    kitFetch<{ bookings: BookingListItem[] }>("/api/bookings")
      .then((r) => setBookings(r.bookings))
      .catch((e: Error) => toast({ title: "Could not load bookings", description: e.message, variant: "error" }));
  }, [kitFetch, toast]);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const deposit = parseDeposit(String(form.get("deposit") ?? ""));
    setDepositError(deposit.error ?? null);
    if (deposit.cents === undefined) return;
    setBusy(true);
    try {
      const booking = await kitFetch<BookingView>("/api/bookings", { json: { item: form.get("item"), renter: form.get("renter"), depositCents: deposit.cents } });
      router.push(`/bookings/${booking.id}`);
    } catch (e) {
      toast({ title: "Could not create the booking", description: (e as Error).message, variant: "error", durationMs: 7000 });
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="Bookings" description="Hold a deposit for each rental, then settle it from the check-in and check-out photos." />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <Card>
          <CardHeader title="New booking" />
          <CardBody>
            <form onSubmit={create} className="space-y-4">
              <Field label="What's being rented" htmlFor="item">
                <Input id="item" name="item" required minLength={2} maxLength={80} placeholder="Lakeside cabin, weekend of Nov 6" />
              </Field>
              <Field label="Renter" htmlFor="renter">
                <Input id="renter" name="renter" required maxLength={60} placeholder="Renter's name" />
              </Field>
              <Field label="Deposit" htmlFor="deposit" hint={`From ${formatCents(MIN_DEPOSIT_CENTS)} to ${formatCents(MAX_DEPOSIT_CENTS)}.`} error={depositError ? <span data-testid="deposit-error">{depositError}</span> : undefined}>
                <MoneyInput id="deposit" name="deposit" defaultValue="300.00" className="w-40" aria-invalid={depositError ? true : undefined} onChange={() => setDepositError(null)} />
              </Field>
              <Button type="submit" loading={busy} disabled={!hydrated} data-testid="create-booking">
                Create booking
              </Button>
            </form>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Your bookings" description="The samples, and the bookings made in this browser. Other visitors don't see yours." />
          <CardBody>
            {bookings.length ? (
              <ul className="divide-y divide-zinc-100">
                {bookings.map((b) => (
                  <li key={b.id}>
                    <Link href={`/bookings/${b.id}`} className="flex flex-col gap-0.5 py-3 hover:text-brand sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
                      <span className="flex min-w-0 items-baseline gap-2">
                        <span className="min-w-0 font-medium text-zinc-900 sm:truncate">{b.item}</span>
                        {b.sample ? <Badge>Sample</Badge> : null}
                      </span>
                      <span className="shrink-0 text-sm tabular-nums text-zinc-600">{outcome(b)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-zinc-600">No bookings yet. Create one to hold your first deposit.</p>
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
