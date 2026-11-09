"use client";

import { FlaskConical, ImagePlus } from "lucide-react";
import { useKit } from "@/components/kit/kit-provider";
import { useToast } from "@/components/toast";
import { Button, Card } from "@/components/ui";
import { formatExactCents } from "@/lib/deposit/rules";
import type { BookingView, PhotoSlot } from "@/lib/deposit/types";

export type DemoPhotoKind = { clean?: boolean; faint?: boolean; two?: boolean };

/**
 * Everything that only exists so the app can be tried without real photos, behind one disclosure:
 * the sample photos, and the limit test that has an agent ask for one cent over the hold.
 */
export function DemoTools({
  booking,
  busy,
  act,
  addDemoPhoto,
  canReplace,
}: {
  booking: BookingView;
  busy: string | null;
  act: (name: string, failTitle: string, action: () => Promise<BookingView>) => Promise<void>;
  addDemoPhoto: (slot: PhotoSlot, kind?: DemoPhotoKind) => Promise<void>;
  canReplace: boolean;
}) {
  const { kitFetch } = useKit();
  const { toast } = useToast();
  const { status, photos, proposal } = booking;
  const authorizedCents = booking.authorizedCents ?? booking.depositCents;
  const missing = status === "held" ? (["check_in", "check_out"] as const).filter((slot) => !photos[slot]) : [];
  const replaceable = canReplace ? (["check_in", "check_out"] as const).filter((slot) => photos[slot]) : [];
  const limitTest = !!proposal && (status === "proposed" || status === "contested");
  if (booking.viewer !== "host" || (!missing.length && !replaceable.length && !limitTest)) return null;

  const runLimitTest = async () => {
    const after = await kitFetch<BookingView>(`/api/bookings/${booking.id}/limit-test`, { method: "POST" });
    toast({ title: `Refused: ${formatExactCents(authorizedCents + 1)} is more than the hold`, description: "The app's code stopped it before PayPal. No money moved.", variant: "success", durationMs: 5000 });
    return after;
  };
  const label = { check_in: "check-in", check_out: "check-out" } as const;

  return (
    <Card>
      {/* Keyed on what it holds, so it starts closed again when the photos give way to the limit test. */}
      <details key={limitTest ? "decide" : "photos"} data-testid="demo-tools">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-3 text-sm font-semibold text-zinc-900 [&::-webkit-details-marker]:hidden">
          <FlaskConical className="size-4 text-zinc-500" aria-hidden /> Demo tools
          <span className="font-normal text-zinc-500">· sample photos{limitTest ? " and the limit test" : ""}</span>
        </summary>
        <div className="space-y-4 border-t border-zinc-100 px-5 py-4 text-sm">
          {missing.length ? (
            <div className="space-y-2">
              <p className="text-zinc-600">Sample photos of a cabin floor (CC0), with marks added digitally.</p>
              <div className="flex flex-wrap gap-2">
                {missing.includes("check_in") ? (
                  <Button variant="secondary" size="sm" icon={<ImagePlus className="size-4" />} loading={busy === "photo:check_in"} disabled={!!busy} onClick={() => addDemoPhoto("check_in")} data-testid="demo-photo-check_in">
                    Check-in photo
                  </Button>
                ) : null}
                {missing.includes("check_out") ? (
                  <>
                    <Button variant="secondary" size="sm" icon={<ImagePlus className="size-4" />} loading={busy === "photo:check_out"} disabled={!!busy} onClick={() => addDemoPhoto("check_out")} data-testid="demo-photo-check_out">
                      Check-out, a gouge
                    </Button>
                    <Button variant="secondary" size="sm" disabled={!!busy} onClick={() => addDemoPhoto("check_out", { two: true })} data-testid="demo-photo-two">
                      Check-out, two marks
                    </Button>
                    <Button variant="secondary" size="sm" disabled={!!busy} onClick={() => addDemoPhoto("check_out", { faint: true })} data-testid="demo-photo-faint">
                      Check-out, a faint mark
                    </Button>
                    <Button variant="secondary" size="sm" disabled={!!busy} onClick={() => addDemoPhoto("check_out", { clean: true })} data-testid="demo-photo-clean">
                      Check-out, no damage
                    </Button>
                  </>
                ) : null}
              </div>
            </div>
          ) : null}
          {replaceable.length ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-zinc-600">Replace with the sample:</span>
              {replaceable.map((slot) => (
                <Button key={slot} variant="ghost" size="sm" loading={busy === `photo:${slot}`} disabled={!!busy} onClick={() => addDemoPhoto(slot)} data-testid={`replace-demo-${slot}`}>
                  {label[slot]} photo
                </Button>
              ))}
            </div>
          ) : null}
          {limitTest ? (
            <div className="flex flex-wrap items-center gap-2" data-testid="for-judges">
              <span className="text-zinc-600">Have an agent try to capture {formatExactCents(authorizedCents + 1)}, one cent over the hold, through the real tool and Guard.</span>
              <Button variant="secondary" size="sm" disabled={!!busy} loading={busy === "limit-test"} onClick={() => act("limit-test", "The limit test could not run", runLimitTest)} data-testid="limit-test">
                Test the limit
              </Button>
            </div>
          ) : null}
        </div>
      </details>
    </Card>
  );
}
