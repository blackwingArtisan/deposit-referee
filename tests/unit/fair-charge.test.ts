import { beforeEach, describe, expect, it } from "vitest";
import { appConfig } from "@/app.config";
import { runSettlementAgent } from "@/agents/settlement";
import { proposeSettlement } from "@/agents/tools/propose-settlement";
import { runTool } from "@/lib/agent/execute";
import { Guard } from "@/lib/agent/guard";
import { requireBooking, saveBooking } from "@/lib/deposit/bookings";
import { DEMO_FAINT_CHECK_OUT, DEMO_PHOTOS } from "@/lib/deposit/photos";
import { DAMAGE_SIZES, DAMAGE_TYPES, PRICE_TABLE, priceOf, rowLabel } from "@/lib/deposit/prices";
import { MOCK_FAINT_CHARGE_CHECK, MOCK_VERDICT, reviewPhotos, toReview, type Verdict } from "@/lib/deposit/review";
import { getPayPal } from "@/lib/paypal";
import answers from "./blind-test-answers.json";
import { heldBooking, paypal } from "./deposit-fixtures";

const meta = { mocked: true, costUsd: 0 };
const [gouge] = MOCK_VERDICT.findings;
const toolContext = () => ({ runId: `test_${Math.random()}`, actor: "agent:test", channel: "test", guard: new Guard({ paypal: getPayPal(), policy: appConfig.agentPolicy }) });

beforeEach(async () => {
  await paypal().reset();
});

describe("the price table", () => {
  it("has a whole-dollar price for every kind and size, rising with size", () => {
    for (const type of DAMAGE_TYPES) {
      const row = DAMAGE_SIZES.map((size) => PRICE_TABLE[type][size]);
      expect(row.every((cents) => Number.isSafeInteger(cents) && cents > 0 && cents % 100 === 0)).toBe(true);
      expect([...row].sort((a, b) => a - b)).toEqual(row);
    }
  });

  it("prices the demo gouge at the README's $150", () => {
    expect(toReview(MOCK_VERDICT, 30_000, meta).items[0]).toMatchObject({ chargeCents: 15_000, price: { type: "scratch", size: "large" } });
    expect(rowLabel({ type: "scratch", size: "large" })).toBe("Scratch or gouge, large");
  });
});

describe("a faint mark is never charged", () => {
  it("sends the round-4 answer, which called the faint scuff new damage, to worth a look", async () => {
    const review = toReview(MOCK_FAINT_CHARGE_CHECK, 30_000, meta);
    expect(review).toMatchObject({ newDamage: false, items: [], suggestedCents: 0 });
    expect(review.worthALook).toHaveLength(1);
  });

  it("doesn't charge a clear mark the model is unsure is new, or any mark on a low-confidence answer", () => {
    expect(toReview({ ...MOCK_VERDICT, findings: [{ ...gouge, certainty: "low" }] }, 30_000, meta).items).toEqual([]);
    expect(toReview({ ...MOCK_VERDICT, confidence: "low" }, 30_000, meta).items).toEqual([]);
    expect(toReview({ ...MOCK_VERDICT, confidence: "low" }, 30_000, meta).worthALook).toHaveLength(1);
  });

  it("runs end to end on the faint demo photo: noticed, nothing charged, a full release proposed", async () => {
    const held = await heldBooking(30_000);
    const withFaint = saveBooking({ ...held, photos: { check_in: DEMO_PHOTOS.check_in, check_out: DEMO_FAINT_CHECK_OUT } });
    saveBooking({ ...withFaint, status: "reviewed", review: await reviewPhotos(withFaint) });
    const booking = await runSettlementAgent(held.id, "test");
    expect(booking.review).toMatchObject({ newDamage: false, items: [] });
    expect(booking.review!.worthALook).toHaveLength(1);
    expect(booking.proposal).toMatchObject({ kind: "release", aiCents: 0, lines: [] });
  });
});

describe("the same damage costs the same", () => {
  it("gives one price whatever words or box the model uses", () => {
    const a = toReview(MOCK_VERDICT, 30_000, meta);
    const b = toReview({ ...MOCK_VERDICT, findings: [{ ...gouge, description: "A long gouge in a floor board.", box: { x: 0.1, y: 0.1, w: 0.3, h: 0.2 } }] }, 30_000, meta);
    expect(a.items[0].chargeCents).toBe(b.items[0].chargeCents);
  });

  it("takes the amount from the table, not from anything the agent sends", async () => {
    const held = await heldBooking(30_000);
    saveBooking({ ...held, status: "reviewed", review: toReview(MOCK_VERDICT, 30_000, meta) });
    const result = await runTool(proposeSettlement, { booking_id: held.id, decision: "charge", amount_cents: 999, items: [{ finding: 0, amount_cents: 999, note: "New gouge" }], rationale: "The gouge is new at check-out." }, toolContext());
    expect(result.isError).toBe(false);
    const { proposal } = requireBooking(held.id);
    expect(proposal).toMatchObject({ aiCents: 15_000, lines: [{ amountCents: 15_000, aiCents: 15_000, price: { type: "scratch", size: "large" } }] });
  });

  it("trims the last line in code when the table total is more than the hold", async () => {
    const held = await heldBooking(20_000);
    const two: Verdict = { ...MOCK_VERDICT, findings: [gouge, { ...gouge, damage_type: "hole", size: "small", box: { x: 0.1, y: 0.1, w: 0.1, h: 0.1 } }] };
    saveBooking({ ...held, status: "reviewed", review: toReview(two, 20_000, meta) });
    const booking = await runSettlementAgent(held.id, "test");
    expect(booking.proposal!.lines.map((l) => l.amountCents)).toEqual([15_000, 5_000]);
    expect(booking.proposal!.aiCents).toBe(20_000);
  });
});

describe("the blind test's saved answers, replayed through today's code", () => {
  it("gives every pair the same outcome it had: charged, worth a look or clean", () => {
    for (const answer of answers) {
      const review = toReview(answer.verdict as Verdict, 50_000, meta);
      expect({ pair: answer.pair, charged: review.items.length, looks: review.worthALook!.length }).toEqual({ pair: answer.pair, ...answer.saved });
      for (const item of review.items) expect(item.chargeCents).toBe(priceOf(item.price!));
    }
  });
});
