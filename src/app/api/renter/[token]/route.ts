import { markRenterOpened, renterView } from "@/lib/deposit/renter";
import { route } from "@/lib/http";

export const GET = route<RouteContext<"/api/renter/[token]">>(async (_req, ctx) => {
  const { token } = await ctx.params;
  markRenterOpened(token);
  return renterView(token);
});
