import { beforeEach, describe, expect, it } from "vitest";
import { listBookings, ownPaypalIds } from "@/lib/deposit/bookings";
import { aiVersusHost, usd } from "@/lib/deposit/insights";
import { isOwnLedgerEntry, isOwnWebhook } from "@/lib/deposit/own-records";
import { heldBooking, paypal } from "./deposit-fixtures";

beforeEach(async () => {
  await paypal().reset();
});

describe("the bookings list", () => {
  it("never carries a renter's link", async () => {
    const booking = await heldBooking();
    expect(booking.renterToken).toBeTruthy();
    const list = listBookings(undefined, { tests: true });
    expect(list.map((b) => b.id)).toContain(booking.id);
    expect(JSON.stringify(list)).not.toContain(booking.renterToken);
    for (const item of list) expect(item).not.toHaveProperty("renterToken");
  });
});

describe("only this app's PayPal records", () => {
  it("keeps a booking's order, authorization and capture, and drops anything else", async () => {
    const booking = await heldBooking();
    const ids = ownPaypalIds();
    expect(ids.has(booking.orderId!)).toBe(true);
    expect(ids.has(booking.authorizationId!)).toBe(true);

    const entries = [
      { paypalId: booking.orderId! },
      { paypalId: booking.authorizationId!, orderId: booking.orderId },
      { paypalId: "CAP-1", parentId: booking.authorizationId },
      { paypalId: "ORDER-GIFT-CARD" },
      { paypalId: "INV2-AAAA" },
      { paypalId: "PAYOUT-BATCH" },
    ];
    expect(entries.filter((e) => isOwnLedgerEntry(e, ids)).map((e) => e.paypalId)).toEqual([booking.orderId, booking.authorizationId, "CAP-1"]);
  });

  it("keeps webhooks that name a booking's ids and drops invoices and payouts", async () => {
    const booking = await heldBooking();
    const ids = ownPaypalIds();
    expect(isOwnWebhook({ resource: { id: "CAP-9", links: [{ href: `https://x/v2/payments/authorizations/${booking.authorizationId}` }] } }, ids)).toBe(true);
    expect(isOwnWebhook({ resource: { id: "INV2-AAAA", detail: { invoice_number: "0007" } } }, ids)).toBe(false);
  });
});

describe("the dashboard's numbers", () => {
  it("prints a cut with a real minus sign", () => {
    expect(usd(-60)).toBe("−$60.00");
    expect(usd(90)).toBe("$90.00");
  });

  it("says what the AI said and what the host charged", () => {
    expect(aiVersusHost({ aiProposed: 150, hostChange: -60, stage: "Settled" })).toBe("AI said $150.00, you charged $90.00 (−$60.00)");
    expect(aiVersusHost({ aiProposed: 150, hostChange: 60, stage: "Host deciding" })).toBe("AI said $150.00, you set $210.00 (+$60.00)");
    expect(aiVersusHost({ aiProposed: 150, hostChange: 0, stage: "Settled" })).toBe("Kept the AI's $150.00");
    expect(aiVersusHost({ aiProposed: null, hostChange: 0, stage: "On hold" })).toBe("");
  });
});
