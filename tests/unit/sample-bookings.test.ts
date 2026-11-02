import { beforeEach, describe, expect, it } from "vitest";
import { allBookings, requireBooking, saveBooking, TEST_RENTER } from "@/lib/deposit/bookings";
import { toDepositRow } from "@/lib/deposit/insights";
import { sampleBookingId, SAMPLES, seedSampleBookings } from "@/lib/deposit/sample-bookings";
import { collection } from "@/lib/store/collection";
import type { Booking } from "@/lib/deposit/types";
import { getPayPal } from "@/lib/paypal";
import { heldBooking } from "./deposit-fixtures";

const row = (key: string) => toDepositRow(requireBooking(sampleBookingId(key)));

describe("sample bookings", () => {
  let manifest: Record<string, string>;
  beforeEach(() => {
    collection<Booking>("bookings").replaceAll([]);
    manifest = {};
  });

  it("fills an empty dashboard with sensible, labelled, fictional rows", async () => {
    await seedSampleBookings(getPayPal(), manifest);
    const rows = allBookings().map(toDepositRow);
    expect(rows).toHaveLength(SAMPLES.length);
    expect(allBookings().every((b) => b.sample && b.renter !== TEST_RENTER)).toBe(true);
    expect(new Set(rows.map((r) => r.stage))).toEqual(new Set(["On hold", "Host deciding", "Settled"]));
    expect(row("lakeside-oct")).toMatchObject({ stage: "Settled", charged: 150, released: 150, hostChanged: "No", contested: "No" });
    expect(row("harbor")).toMatchObject({ charged: 210, released: 190, aiProposed: 150, hostChange: 60, hostChanged: "Yes" });
    expect(row("riverside")).toMatchObject({ charged: 90, released: 260, hostChanged: "Yes", contested: "Yes" });
    expect(row("hilltop")).toMatchObject({ charged: 0, released: 250, aiProposed: 0, hostChanged: "No" });
    expect(row("lakeside")).toMatchObject({ stage: "Host deciding", held: 300, charged: 0 });
    expect(row("pine-ridge")).toMatchObject({ stage: "On hold", held: 250, aiProposed: null });
  });

  it("reads settled amounts back from PayPal", async () => {
    const pp = getPayPal();
    await seedSampleBookings(pp, manifest);
    const { settlement, authorizationId } = requireBooking(sampleBookingId("harbor"));
    expect((await pp.payments.getCapture(settlement!.captureId!)).amount.value).toBe("210.00");
    expect((await pp.payments.getAuthorization(authorizationId!)).status).toBe("VOIDED");
    expect(settlement?.authorizationStatus).toBe("VOIDED");
  });

  it("leaves real holds open on the bookings a visitor can still finish", async () => {
    const pp = getPayPal();
    await seedSampleBookings(pp, manifest);
    for (const key of ["lakeside", "pine-ridge"]) {
      const { authorizationId, orderId, holdExpiresAt } = requireBooking(sampleBookingId(key));
      expect((await pp.payments.getAuthorization(authorizationId!)).status).toBe("CREATED");
      expect(orderId).toBeTruthy();
      expect(Date.parse(holdExpiresAt!)).toBeGreaterThan(Date.now());
    }
  });

  it("adds nothing on a second run and keeps what a visitor changed", async () => {
    await seedSampleBookings(getPayPal(), manifest);
    const changed = saveBooking({ ...requireBooking(sampleBookingId("lakeside")), status: "contested" });
    expect(await seedSampleBookings(getPayPal(), manifest)).toEqual({ added: 0 });
    expect(requireBooking(changed.id).status).toBe("contested");
  });

  it("after a redeploy wipes the disk, reuses the same PayPal objects with no new money moved", async () => {
    const pp = getPayPal();
    await seedSampleBookings(pp, manifest);
    const first = requireBooking(sampleBookingId("harbor"));
    const ids = { ...manifest };
    collection<Booking>("bookings").replaceAll([]);
    expect(await seedSampleBookings(pp, manifest)).toEqual({ added: SAMPLES.length });
    expect(manifest).toEqual(ids);
    expect(requireBooking(first.id).settlement?.captureId).toBe(first.settlement?.captureId);
    expect(row("harbor").charged).toBe(210);
  });

  it("places a fresh hold when a visitor used up an open sample before the redeploy", async () => {
    const pp = getPayPal();
    await seedSampleBookings(pp, manifest);
    const used = requireBooking(sampleBookingId("lakeside")).authorizationId!;
    await pp.payments.voidAuthorization(used);
    collection<Booking>("bookings").replaceAll([]);
    await seedSampleBookings(pp, manifest);
    const fresh = requireBooking(sampleBookingId("lakeside")).authorizationId!;
    expect(fresh).not.toBe(used);
    expect((await pp.payments.getAuthorization(fresh)).status).toBe("CREATED");
  });

  it("keeps test rows out of what a visitor sees", async () => {
    await seedSampleBookings(getPayPal(), manifest);
    const test = await heldBooking();
    expect(test.renter).toBe(TEST_RENTER);
    expect(allBookings().map((b) => b.id)).not.toContain(test.id);
    expect(allBookings({ tests: true }).map((b) => b.id)).toContain(test.id);
  });
});
