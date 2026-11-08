import { z } from "zod";
import { addRenterPhoto } from "@/lib/deposit/renter";
import { readJson, route } from "@/lib/http";

const Body = z.object({
  slot: z.enum(["check_in", "check_out"]),
  /** A browser data: URL. Leave it out to use the demo close-up for check-in. */
  dataUrl: z.string().optional(),
});

/** The renter's own photo, added before the host compares the photos, so the comparison weighs it. */
export const POST = route<RouteContext<"/api/renter/[token]/photos">>(async (req, ctx) => {
  const { slot, dataUrl } = await readJson(req, Body);
  return addRenterPhoto((await ctx.params).token, slot, dataUrl);
});
