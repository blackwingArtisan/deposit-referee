import { route } from "@/lib/http";
import { getMockPayPal } from "@/lib/paypal";

/** Mock mode only: webhook events the mock has emitted (newest last). */
export const GET = route(async () => ({ events: getMockPayPal()!.events() }), { mockOnly: true });
