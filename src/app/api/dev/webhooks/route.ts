import { ownPaypalIds } from "@/lib/deposit/bookings";
import { isOwnWebhook } from "@/lib/deposit/own-records";
import { route } from "@/lib/http";
import { getMockPayPal } from "@/lib/paypal";

/** Mock mode only: webhook events the mock has emitted for this app's bookings (newest last). */
export const GET = route(async () => {
  const ids = ownPaypalIds();
  return { events: getMockPayPal()!.events().filter((e) => isOwnWebhook(e, ids)) };
}, { mockOnly: true });
