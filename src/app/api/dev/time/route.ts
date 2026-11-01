import { z } from "zod";
import { readJson, route } from "@/lib/http";
import { getMockPayPal } from "@/lib/paypal";

/** Mock mode only: move the mock clock (e.g. past the 3-day honor period). Body: { days } or { ms }. */
export const POST = route(
  async (req) => {
    const b = await readJson(req, z.object({ days: z.number().optional(), ms: z.number().optional() }));
    const ms = b.ms ?? (b.days ?? 0) * 864e5;
    const mock = getMockPayPal()!;
    mock.advanceTime(ms);
    return { now: new Date(mock.now()).toISOString() };
  },
  { mockOnly: true },
);
