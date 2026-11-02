"use client";

import { useEffect, useState, useSyncExternalStore, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useKit } from "@/components/kit/kit-provider";
import { PageHeader } from "@/components/shell/app-shell";
import { useToast } from "@/components/toast";
import { Button, Card, CardBody, CardHeader, Field, Input, MoneyInput } from "@/components/ui";
import { dollarsToCents, formatCents, MAX_DEPOSIT_CENTS, MIN_DEPOSIT_CENTS } from "@/lib/deposit/rules";
import type { BookingView } from "@/lib/deposit/types";

function outcome(booking: BookingView): string {
  const s = booking.settlement;
  if (booking.status === "settled" && s?.capturedCents !== undefined && s.releasedCents !== undefined) return `${formatCents(s.capturedCents)} captured, ${formatCents(s.releasedCents)} released`;
  if (booking.status === "draft") return "Waiting for deposit";
  return `${formatCents(booking.depositCents)} on hold`;
}

const noSubscription = () => () => undefined;

export default function BookingsPage() {
  const { kitFetch } = useKit();
  const { toast } = useToast();
  const router = useRouter();
  const [bookings, setBookings] = useState<BookingView[]>([]);
  const [busy, setBusy] = useState(false);
  // On a slow phone the form is on screen before React is running. The fields are uncontrolled so
  // React keeps what was already typed, and the button waits so the form can't submit natively.
  const hydrated = useSyncExternalStore(noSubscription, () => true, () => false);

  useEffect(() => {
    kitFetch<{ bookings: BookingView[] }>("/api/bookings")
      .then((r) => setBookings(r.bookings))
      .catch((e: Error) => toast({ title: "Could not load bookings", description: e.message, variant: "error" }));
  }, [kitFetch, toast]);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    try {
      const booking = await kitFetch<BookingView>("/api/bookings", { json: { item: form.get("item"), renter: form.get("renter"), depositCents: dollarsToCents(String(form.get("deposit"))) } });
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
              <Field label="Deposit" htmlFor="deposit" hint={`From ${formatCents(MIN_DEPOSIT_CENTS)} to ${formatCents(MAX_DEPOSIT_CENTS)}.`}>
                <MoneyInput id="deposit" name="deposit" defaultValue="300.00" className="w-40" />
              </Field>
              <Button type="submit" loading={busy} disabled={!hydrated} data-testid="create-booking">
                Create booking
              </Button>
            </form>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Your bookings" />
          <CardBody>
            {bookings.length ? (
              <ul className="divide-y divide-zinc-100">
                {bookings.map((b) => (
                  <li key={b.id}>
                    <Link href={`/bookings/${b.id}`} className="flex items-baseline justify-between gap-4 py-3 hover:text-brand">
                      <span className="min-w-0 truncate font-medium text-zinc-900">{b.item}</span>
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
