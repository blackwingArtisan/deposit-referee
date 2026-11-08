import { allBookings } from "@/lib/deposit/bookings";
import { toDepositRow } from "@/lib/deposit/insights";
import { route } from "@/lib/http";

/** The host's dashboard data: every booking but test rows, with amounts re-read from PayPal at settlement. */
export const GET = route(async (req) => {
  const bookings = allBookings({ tests: req.nextUrl.searchParams.has("tests") });
  return { rows: bookings.map(toDepositRow), samples: bookings.filter((b) => b.sample).length };
});
