import { allBookings } from "@/lib/deposit/bookings";
import { toDepositRow } from "@/lib/deposit/insights";
import { route } from "@/lib/http";

/** The host's dashboard data: every booking, with amounts re-read from PayPal at settlement. */
export const GET = route(async () => ({ rows: allBookings().map(toDepositRow) }));
