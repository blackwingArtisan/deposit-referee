import { describe, expect, it } from "vitest";
import { addHostLink, findHostLink, HOST_LINK_MINUTES, HOST_LINKS_KEPT, spendHostLink } from "@/lib/deposit/host-key";
import type { Booking } from "@/lib/deposit/types";

const base = { id: "bk_test", hostSecret: "s".repeat(43) } as Booking;
const T = Date.parse("2026-11-08T20:00:00Z");

describe("one-time host links", () => {
  it("keeps only a hash of the code, and finds the booking by the code", () => {
    const { booking, code, expiresAt } = addHostLink(base, T);
    expect(code).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(JSON.stringify(booking)).not.toContain(code);
    expect(Date.parse(expiresAt) - T).toBe(HOST_LINK_MINUTES * 60_000);
    const found = findHostLink([{ id: "bk_other" } as Booking, booking], code, T + 1000);
    expect(found?.booking.id).toBe("bk_test");
    expect(found?.state).toBe("ok");
    expect(findHostLink([booking], code.slice(0, -1) + (code.endsWith("A") ? "B" : "A"), T)).toBeUndefined();
  });

  it("works once", () => {
    const { booking, code } = addHostLink(base, T);
    const found = findHostLink([booking], code, T)!;
    const spent = spendHostLink(found.booking, found.link, T + 5000);
    expect(findHostLink([spent], code, T + 6000)?.state).toBe("used");
  });

  it("expires after its window", () => {
    const { booking, code } = addHostLink(base, T);
    expect(findHostLink([booking], code, T + HOST_LINK_MINUTES * 60_000 - 1)?.state).toBe("ok");
    expect(findHostLink([booking], code, T + HOST_LINK_MINUTES * 60_000)?.state).toBe("expired");
  });

  it("keeps the last few links and spends only the one used", () => {
    let booking = base;
    const codes: string[] = [];
    for (let i = 0; i < HOST_LINKS_KEPT + 2; i++) {
      const made = addHostLink(booking, T + i);
      booking = made.booking;
      codes.push(made.code);
    }
    expect(booking.hostLinks).toHaveLength(HOST_LINKS_KEPT);
    expect(findHostLink([booking], codes[0], T)).toBeUndefined();
    const last = findHostLink([booking], codes.at(-1)!, T)!;
    const spent = spendHostLink(booking, last.link, T);
    expect(findHostLink([spent], codes.at(-2)!, T)?.state).toBe("ok");
  });
});
