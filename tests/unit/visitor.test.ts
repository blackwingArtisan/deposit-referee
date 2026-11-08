import { beforeEach, describe, expect, it } from "vitest";
import { bookingsFor, createBooking, listBookings, saveBooking, viewBooking } from "@/lib/deposit/bookings";
import { collection } from "@/lib/store/collection";
import type { Booking } from "@/lib/deposit/types";

describe("each visitor's lists show the samples and their own bookings", () => {
  beforeEach(() => collection<Booking>("bookings").replaceAll([]));

  it("one visitor's bookings don't show in another's list or dashboard", () => {
    const mine = createBooking({ item: "Cedar cabin", renter: "Alex Rivera", depositCents: 30_000, visitorId: "visitor-aaaa" });
    const theirs = createBooking({ item: "Camera kit", renter: "Sam Lee", depositCents: 20_000, visitorId: "visitor-bbbb" });
    const older = createBooking({ item: "<b>QA</b> **bold**", renter: "Someone", depositCents: 10_000 });
    const sample = saveBooking({ ...createBooking({ item: "Harbor loft", renter: "Sam Whitfield", depositCents: 40_000 }), sample: true });

    expect(bookingsFor("visitor-aaaa").map((b) => b.id).sort()).toEqual([mine.id, sample.id].sort());
    expect(bookingsFor("visitor-bbbb").map((b) => b.id).sort()).toEqual([theirs.id, sample.id].sort());
    expect(bookingsFor(undefined).map((b) => b.id)).toEqual([sample.id]);
    expect(bookingsFor(undefined, { tests: true }).map((b) => b.id)).toEqual(expect.arrayContaining([mine.id, theirs.id, older.id, sample.id]));
  });

  it("the visitor id never leaves the server", () => {
    const mine = createBooking({ item: "Cedar cabin", renter: "Alex Rivera", depositCents: 30_000, visitorId: "visitor-aaaa" });
    expect(JSON.stringify(viewBooking(mine))).not.toContain("visitor-aaaa");
    expect(JSON.stringify(listBookings("visitor-aaaa"))).not.toContain("visitor-aaaa");
  });
});
