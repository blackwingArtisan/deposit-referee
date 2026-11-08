import { z } from "zod";
import { createBooking, listBookings, viewBooking } from "@/lib/deposit/bookings";
import { MAX_DEPOSIT_CENTS, MIN_DEPOSIT_CENTS } from "@/lib/deposit/rules";
import { currentVisitor, ensureVisitor } from "@/lib/deposit/visitor";
import { readJson, route } from "@/lib/http";

const Body = z.object({
  item: z.string().trim().min(2).max(80),
  renter: z.string().trim().min(1).max(60),
  depositCents: z.number().int().min(MIN_DEPOSIT_CENTS).max(MAX_DEPOSIT_CENTS),
});

export const GET = route(async (req) => ({ bookings: listBookings(await currentVisitor(), { tests: req.nextUrl.searchParams.has("tests") }) }));

export const POST = route(async (req) => {
  const input = await readJson(req, Body);
  return viewBooking(createBooking({ ...input, visitorId: await ensureVisitor() }));
});
