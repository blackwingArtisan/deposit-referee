import { runLimitTest } from "@/agents/settlement";
import { requireBooking, viewBooking } from "@/lib/deposit/bookings";
import { RuleError } from "@/lib/deposit/rules";
import { getContext } from "@/lib/events/bus";
import { HttpError, route } from "@/lib/http";

/** Asks for too much on purpose, through the real tools. Every step is refused and shows on the timeline. */
export const POST = route<RouteContext<"/api/bookings/[id]/limit-test">>(async (_req, ctx) => {
  const { id } = await ctx.params;
  try {
    await runLimitTest(id, getContext().channel);
  } catch (e) {
    throw e instanceof RuleError ? new HttpError(409, e.message, "conflict") : e;
  }
  return viewBooking(requireBooking(id));
});
