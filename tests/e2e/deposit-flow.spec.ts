/**
 * The whole deposit story in a real browser. `npm run test:e2e` runs it on mock PayPal;
 * `npm run test:e2e:sandbox` runs it on the real PayPal sandbox and then re-reads the objects
 * straight from PayPal. In sandbox the deposit is paid with PayPal's test card (DEMO_TEST_CARD=1)
 * because the wallet button needs a buyer login. AI is mocked unless E2E_AI_MODE=live.
 */
import { expect, test } from "@playwright/test";
import { readPayPalObjects, tryCapture } from "./paypal-reread";
import type { BookingView } from "../../src/lib/deposit/types";

const DEPOSIT_CENTS = 20_000;
const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const headline = (cents: number) => `$${cents % 100 === 0 ? cents / 100 : (cents / 100).toFixed(2)}`;

test("host holds a deposit, AI finds the damage, host approves, the rest is released", async ({ page, request }) => {
  const status = await (await request.get("/api/kit/status")).json();
  const sandbox = status.paypal.mode === "sandbox";
  const live = status.ai.mode === "live";

  await page.goto("/bookings");
  await page.getByLabel("What's being rented").fill("Lakeside cabin, weekend of Nov 6");
  await page.getByLabel("Renter").fill("Test Renter");
  await page.getByLabel("Deposit").fill("200.00");
  await page.getByTestId("create-booking").click();
  await page.waitForURL(/\/bookings\/bk_/);
  const id = new URL(page.url()).pathname.split("/").pop()!;
  const booking = async () => (await (await request.get(`/api/bookings/${id}`)).json()) as BookingView;

  // The renter places the deposit: money held, not taken.
  await page.getByTestId(sandbox ? "sandbox-test-card" : "simulate-paypal-approval").click();
  if (!sandbox) await page.getByTestId("mock-approve").click();
  const hold = page.getByTestId("hold-panel");
  await expect(hold).toContainText("$200 on hold. Nothing has been charged.", { timeout: 30_000 });
  await expect(hold).toContainText("PayPal holds last 29 days");

  // Both photos, each with its source.
  await page.getByTestId("demo-photo-check_in").click();
  await expect(page.getByTestId("demo-photo-check_out")).toBeEnabled();
  await page.getByTestId("demo-photo-check_out").click();
  await expect(page.getByTestId("photo-source")).toHaveCount(2);
  await expect(page.getByTestId("photo-source").first()).toContainText("Greg Zaal, CC0 1.0");
  await expect(page.getByTestId("photo-source").nth(1)).toContainText("added digitally");

  // AI comparison, then the box drawn from its output.
  await page.getByTestId("run-review").click();
  await expect(page.getByTestId("review")).toBeVisible({ timeout: 90_000 });
  const reviewed = await booking();
  const review = reviewed.review!;
  expect(review.mocked).toBe(!live);
  expect(review.items.length).toBeGreaterThan(0);
  const box = page.getByTestId("damage-box").first();
  await expect(box).toBeVisible();
  const drawn = review.items[0].box!;
  expect(await box.evaluate((el) => (el as HTMLElement).style.left)).toBe(`${drawn.x * 100}%`);

  // The AI suggests; the charge box starts there, as an exact amount.
  const chargeCents = review.suggestedCents;
  const releaseCents = DEPOSIT_CENTS - chargeCents;
  expect(chargeCents).toBeGreaterThan(0);
  expect(chargeCents).toBeLessThan(DEPOSIT_CENTS);
  await expect(page.getByTestId("ai-suggestion")).toContainText(`The AI suggests ${dollars(chargeCents)}. You decide.`);
  await expect(page.getByTestId("charge-preview")).toContainText(`Charge exactly ${dollars(chargeCents)} and release ${dollars(releaseCents)}`);
  await page.getByTestId("request-approval").click();

  // The gate: nothing moves until the host approves.
  const prompt = page.getByTestId("approval-prompt");
  await expect(prompt).toBeVisible({ timeout: 30_000 });
  await expect(prompt).toContainText(`Charge exactly ${dollars(chargeCents)} from the $200.00 hold and release ${dollars(releaseCents)} to the renter`);
  await expect(page.getByTestId("approve-button")).toHaveCount(1);
  if (sandbox) expect((await readPayPalObjects(reviewed.orderId!, reviewed.authorizationId!)).authorization.status).toBe("CREATED");
  await page.screenshot({ path: "screenshots/deposit-approval.png", fullPage: true });
  await page.getByTestId("approve-button").click();

  // The result.
  const ruling = page.getByTestId("ruling");
  await expect(ruling).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("ruling-headline")).toHaveText(`${headline(chargeCents)} captured, ${headline(releaseCents)} released`);
  await expect(ruling.getByTestId("damage-box").first()).toBeVisible();
  await expect(ruling.locator("img").nth(1)).toHaveJSProperty("complete", true);
  await expect(page.getByText("Approved", { exact: true })).toBeHidden({ timeout: 15_000 }); // the toast covers the PayPal ids
  await page.screenshot({ path: `screenshots/deposit-result-${live ? "live-ai" : "mock-ai"}.png`, fullPage: true });

  const done = await booking();
  expect(done.status).toBe("settled");
  expect(done.settlement).toMatchObject({ capturedCents: chargeCents, releasedCents: releaseCents });

  const audit = await (await request.get("/api/audit")).json();
  expect(audit.integrity.ok).toBe(true);
  const actions = audit.entries.filter((e: { tool?: string }) => e.tool === "capture_deposit").map((e: { action: string }) => e.action);
  expect(actions).toEqual(expect.arrayContaining(["approval.requested", "approval.approved", "tool.executed"]));

  if (sandbox) {
    // Straight from PayPal, not through the app.
    const { order, authorization, capture } = await readPayPalObjects(done.orderId!, done.authorizationId!, done.settlement!.captureId!);
    expect(order.intent).toBe("AUTHORIZE");
    expect(authorization.status).toBe("VOIDED");
    expect(authorization.amount.value).toBe("200.00");
    expect(capture!.status).toBe("COMPLETED");
    expect(capture!.amount.value).toBe((chargeCents / 100).toFixed(2));
    expect(capture!.final_capture).toBe(false);
    const captures = order.purchase_units[0].payments.captures;
    expect(captures.map((c) => c.id)).toEqual([capture!.id]);
    const further = await tryCapture(done.authorizationId!, "1.00");
    expect(further.status).toBe(422);
    expect(further.issue).toBe("AUTHORIZATION_VOIDED");
    console.log(`PayPal re-read: order ${order.id} ${order.status}; authorization ${authorization.id} ${authorization.status} ${authorization.amount.value}; capture ${capture!.id} ${capture!.status} ${capture!.amount.value}; further $1.00 capture refused: ${further.status} ${further.issue}`);
  }
  console.log(`AI: mocked=${review.mocked} model=${review.model ?? "none"} cost=$${review.costUsd.toFixed(4)} box=${JSON.stringify(drawn)}`);
});
