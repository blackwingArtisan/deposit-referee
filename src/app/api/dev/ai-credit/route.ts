import { z } from "zod";
import { setCreditOut } from "@/lib/deposit/credit-test";
import { readJson, route } from "@/lib/http";

const Body = z.object({ bookingId: z.string().min(1), step: z.enum(["review", "agent"]).nullable() });

/** Mock mode only: makes one AI step on one booking fail as if the account were out of credit. */
export const POST = route(
  async (req) => {
    const { bookingId, step } = await readJson(req, Body);
    setCreditOut(bookingId, step);
    return { bookingId, step };
  },
  { mockOnly: true },
);
