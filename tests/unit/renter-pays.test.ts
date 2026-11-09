import { beforeEach, describe, expect, it } from "vitest";
import { createBooking, requireBooking, saveBooking } from "@/lib/deposit/bookings";
import { createDepositOrder, placeHold } from "@/lib/deposit/deposit";
import { renterView } from "@/lib/deposit/renter";
import { paypal } from "./deposit-fixtures";

beforeEach(async () => {
  await paypal().reset();
});

const draft = (depositCents = 30_000) => createBooking({ item: "Harbor loft, weekend of Nov 27", renter: "Test Renter", depositCents });

describe("the renter places the hold from their own page", () => {
  it("the order is for the booking's deposit, and the hold is recorded only once PayPal returns it", async () => {
    const booking = draft();
    expect(renterView(booking.renterToken).hold).toBeNull();
    const { orderId } = await createDepositOrder(booking.renterToken);
    const order = await paypal().orders.get(orderId);
    expect(order.intent).toBe("AUTHORIZE");
    expect(order.purchase_units![0].amount.value).toBe("300.00");
    expect(requireBooking(booking.id).status).toBe("draft");

    await paypal().simulateBuyerApproval(orderId);
    const held = await placeHold(booking.renterToken, orderId);
    expect(held.status).toBe("held");
    expect(held.authorizedCents).toBe(30_000);
    // The host's conversation rail shows when the hold was placed.
    expect(Date.parse(held.heldAt!)).toBeGreaterThan(Date.now() - 60_000);
    expect((await paypal().payments.getAuthorization(held.authorizationId!)).status).toBe("CREATED");
    expect(renterView(booking.renterToken).hold).toEqual({ authorizedCents: 30_000, expiresAt: held.holdExpiresAt });
  });

  it("refuses an order that isn't this booking's", async () => {
    const mine = draft();
    const other = draft();
    await createDepositOrder(mine.renterToken);
    const { orderId } = await createDepositOrder(other.renterToken);
    await paypal().simulateBuyerApproval(orderId);
    await expect(placeHold(mine.renterToken, orderId)).rejects.toMatchObject({ status: 409 });
    expect(requireBooking(mine.id).status).toBe("draft");
  });

  it("can't be placed twice", async () => {
    const booking = draft();
    const { orderId } = await createDepositOrder(booking.renterToken);
    await paypal().simulateBuyerApproval(orderId);
    await placeHold(booking.renterToken, orderId);
    await expect(createDepositOrder(booking.renterToken)).rejects.toMatchObject({ status: 409 });
    await expect(placeHold(booking.renterToken, orderId)).rejects.toMatchObject({ status: 409 });
  });

  it("refuses a hold for a different amount from the deposit", async () => {
    const booking = draft();
    const { orderId } = await createDepositOrder(booking.renterToken);
    await paypal().simulateBuyerApproval(orderId);
    saveBooking({ ...requireBooking(booking.id), depositCents: 25_000 });
    await expect(placeHold(booking.renterToken, orderId)).rejects.toMatchObject({ status: 409 });
    expect(requireBooking(booking.id).status).toBe("draft");
  });

  it("an unknown renter link places nothing", async () => {
    await expect(createDepositOrder("not-a-real-token-at-all")).rejects.toMatchObject({ status: 404 });
  });
});
