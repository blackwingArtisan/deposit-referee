import { route } from "@/lib/http";
import { getMockPayPal, ledger } from "@/lib/paypal";
import { timeline } from "@/lib/events/bus";

/** Mock mode only: wipe mock PayPal state, the ledger and the timeline buffer. */
export const POST = route(
  async () => {
    getMockPayPal()!.reset();
    ledger.clear();
    timeline.clear();
    return { ok: true };
  },
  { mockOnly: true },
);
