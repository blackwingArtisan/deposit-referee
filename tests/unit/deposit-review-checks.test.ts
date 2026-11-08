import { beforeEach, describe, expect, it, vi } from "vitest";
import { compareImages } from "@/lib/ai";
import { DEMO_PHOTOS } from "@/lib/deposit/photos";
import { MOCK_NO_DAMAGE, MOCK_VERDICT, reviewPhotos } from "@/lib/deposit/review";
import type { Booking } from "@/lib/deposit/types";

vi.mock("@/lib/ai", async (original) => ({ ...(await original<typeof import("@/lib/ai")>()), compareImages: vi.fn() }));

const call = vi.mocked(compareImages);
const booking = { id: "bk_checks", authorizedCents: 30_000, photos: DEMO_PHOTOS } as unknown as Booking;
const look = { description: "Faint scuff", box: { x: 0.2, y: 0.3, w: 0.1, h: 0.1 }, charge_cents: 7_500 };
const answer = (data: unknown, costUsd: number) => ({ data, mocked: false, model: "claude-sonnet-5-5", costUsd }) as never;

beforeEach(() => {
  call.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("the two AI checks", () => {
  it("asks the charge check about charges only, and stops there when it charges", async () => {
    call.mockResolvedValueOnce(answer(MOCK_VERDICT, 0.01));
    const review = await reviewPhotos(booking);
    expect(call).toHaveBeenCalledTimes(1);
    expect(call.mock.calls[0][0].question).not.toMatch(/worth.a.look/i);
    expect(review.suggestedCents).toBe(MOCK_VERDICT.findings[0].charge_cents);
    expect(review.worthALook).toEqual([]);
  });

  it("looks for marks only after nothing was charged, and adds up both costs", async () => {
    call.mockResolvedValueOnce(answer(MOCK_NO_DAMAGE, 0.01)).mockResolvedValueOnce(answer({ worth_a_look: [look] }, 0.02));
    const review = await reviewPhotos(booking);
    expect(call).toHaveBeenCalledTimes(2);
    expect(review).toMatchObject({ newDamage: false, items: [], suggestedCents: 0, costUsd: 0.03 });
    expect(review.worthALook).toEqual([{ description: "Faint scuff", box: look.box, chargeCents: 7_500 }]);
  });

  it("runs the second check when the first says damage but prices it at zero", async () => {
    const zero = { ...MOCK_VERDICT, findings: [{ ...MOCK_VERDICT.findings[0], charge_cents: 0 }] };
    call.mockResolvedValueOnce(answer(zero, 0.01)).mockResolvedValueOnce(answer({ worth_a_look: [look] }, 0.02));
    const review = await reviewPhotos(booking);
    expect(call).toHaveBeenCalledTimes(2);
    expect(review).toMatchObject({ newDamage: false, items: [], suggestedCents: 0 });
  });

  it("keeps the charge check's answer when the second check fails", async () => {
    call.mockResolvedValueOnce(answer(MOCK_NO_DAMAGE, 0.01)).mockRejectedValueOnce(new Error("rate limited"));
    const review = await reviewPhotos(booking);
    expect(review).toMatchObject({ newDamage: false, suggestedCents: 0, costUsd: 0.01, worthALook: [] });
  });
});
