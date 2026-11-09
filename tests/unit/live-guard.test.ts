import { afterEach, describe, expect, it, vi } from "vitest";
import type { Page } from "@playwright/test";
import { LiveGuard, NOT_LIVE } from "../../demo/live-guard";

function fakePage(texts: string[]) {
  const frames = texts.map((text, i) => ({ url: () => (i ? `https://example.test/frame${i}` : "http://localhost/page"), evaluate: async () => text }));
  return { frames: () => frames, mainFrame: () => frames[0], isClosed: () => false } as unknown as Page;
}

describe("DEMO_REQUIRE_LIVE", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("matches mock and simulated text, not words that only contain them", () => {
    for (const t of ["PayPal mock", "AI mock", "Simulated AI result", "Simulated PayPal checkout", "mock PayPal", "MOCK"]) expect(NOT_LIVE.test(t), t).toBe(true);
    for (const t of ["PayPal sandbox", "Photos: claude-sonnet-5-5", "mockingbird", "hummock", "Captured $250.00"]) expect(NOT_LIVE.test(t), t).toBe(false);
  });

  it("fails a scene when the page or any frame in it shows mock text", async () => {
    vi.stubEnv("DEMO_REQUIRE_LIVE", "1");
    await expect(new LiveGuard(fakePage(["Bookings\nPayPal sandbox"])).check("booking")).resolves.toBeUndefined();
    await expect(new LiveGuard(fakePage(["Bookings\nPayPal mock\nAI mock"])).check("booking")).rejects.toThrow(/"PayPal mock" \(booking, page\)/);
    await expect(new LiveGuard(fakePage(["Your deposit", "Simulated PayPal checkout"])).check("hold")).rejects.toThrow(/Simulated PayPal checkout.*frame https:\/\/example\.test\/frame1/);
  });

  it("does nothing without it", async () => {
    vi.stubEnv("DEMO_REQUIRE_LIVE", "");
    const guard = new LiveGuard(fakePage(["PayPal mock"]));
    expect(guard.on).toBe(false);
    await expect(guard.check("booking")).resolves.toBeUndefined();
  });
});
