import { z } from "zod";
import { createBooking, listBookings, viewBooking } from "@/lib/deposit/bookings";
import { MAX_DEPOSIT_CENTS, MIN_DEPOSIT_CENTS } from "@/lib/deposit/rules";
import { readJson, route } from "@/lib/http";

const Body = z.object({
  item: z.string().trim().min(2).max(80),
  renter: z.string().trim().min(1).max(60),
  depositCents: z.number().int().min(MIN_DEPOSIT_CENTS).max(MAX_DEPOSIT_CENTS),
});

export const GET = route(async () => ({ bookings: listBookings() }));

export const POST = route(async (req) => viewBooking(createBooking(await readJson(req, Body))));
