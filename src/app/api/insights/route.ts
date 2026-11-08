import { bookingsFor } from "@/lib/deposit/bookings";
import { currentVisitor } from "@/lib/deposit/visitor";
import { toDepositRow } from "@/lib/deposit/insights";
import { route } from "@/lib/http";

/** The host's dashboard data: the samples and this visitor's bookings, with amounts re-read from PayPal at settlement. */
export const GET = route(async (req) => {
  const bookings = bookingsFor(await currentVisitor(), { tests: req.nextUrl.searchParams.has("tests") });
  return { rows: bookings.map(toDepositRow), samples: bookings.filter((b) => b.sample).length };
});
