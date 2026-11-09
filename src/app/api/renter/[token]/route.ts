import { renterView } from "@/lib/deposit/renter";
import { route } from "@/lib/http";

export const GET = route<RouteContext<"/api/renter/[token]">>(async (_req, ctx) => renterView((await ctx.params).token));
