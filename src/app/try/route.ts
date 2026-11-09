import { connection } from "next/server";
import { findBooking } from "@/lib/deposit/bookings";
import { sampleBookingId, SAMPLES } from "@/lib/deposit/sample-bookings";

/**
 * "Try the demo booking": straight to a sample that is ready to look at, the one waiting on the
 * host's decision first, with its photos, the AI's boxes and the proposed charge on screen.
 */
export async function GET() {
  // Read the store on each visit; built ahead of time it would always point at the list.
  await connection();
  const order = [...SAMPLES].sort((a, b) => rank(a.stage) - rank(b.stage));
  const ready = order.map((s) => findBooking(sampleBookingId(s.key))).find((b) => b?.sample);
  return new Response(null, { status: 307, headers: { Location: ready ? `/bookings/${ready.id}` : "/bookings", "Cache-Control": "no-store" } });
}

const rank = (stage: string) => ({ proposed: 0, settled: 1, held: 2 })[stage] ?? 3;
