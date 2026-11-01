import { describe, expect, it } from "vitest";
import { authorizationState } from "@/lib/agent/tools/extensions";
import type { PayPalApi } from "@/lib/paypal/api";

const AUTH = "21S59948DV9296412";
const API = "https://api.sandbox.paypal.com/v2/payments";

/** Shaped like the real sandbox: a capture inside an order has an "up" link but no supplementary_data. */
function paypalWith(captureAuth: string) {
  return {
    payments: { getAuthorization: async () => ({ id: AUTH, status: "PARTIALLY_CAPTURED", amount: { currency_code: "USD", value: "200.00" }, supplementary_data: { related_ids: { order_id: "ORDER1" } } }) },
    orders: {
      get: async () => ({
        purchase_units: [
          {
            payments: {
              captures: [{ id: "CAP1", status: "COMPLETED", amount: { currency_code: "USD", value: "150.00" }, links: [{ rel: "self", href: `${API}/captures/CAP1` }, { rel: "up", href: `${API}/authorizations/${captureAuth}` }] }],
            },
          },
        ],
      }),
    },
  } as unknown as PayPalApi;
}

describe("authorizationState", () => {
  it("finds captures on a real sandbox order through their up link", async () => {
    const state = await authorizationState(paypalWith(AUTH), AUTH);
    expect(state.captured.value).toBe("150.00");
    expect(state.remaining.value).toBe("50.00");
  });

  it("ignores captures of another authorization", async () => {
    const state = await authorizationState(paypalWith("OTHERAUTH0000000"), AUTH);
    expect(state.captured.value).toBe("0.00");
    expect(state.remaining.value).toBe("200.00");
  });
});
