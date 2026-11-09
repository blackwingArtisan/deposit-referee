/**
 * Plain screens: the host's page, the renter's page and the second-look card each lead with one
 * money headline per state, and the explanations fold behind "Why?". One booking walks every state
 * after the hold (the hold states are checked in booking-flow.ts): proposed, contested with one item
 * charged, a line Claude couldn't tell, the counter, the renter's answer, approval and settled.
 * Screenshots at 390 and 1440 wide. Mock AI: the renter sends back the host's own check-out shot,
 * which the mock can't tell from the stain.
 */
import { expect, test, type Page } from "@playwright/test";
import { expectNoSidewaysScroll, openAsRenter, toProposal, unfold } from "./booking-flow";

const shots = async (page: Page, name: string) => {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await expectNoSidewaysScroll(page);
    await page.screenshot({ path: `screenshots/plain-${name}-${width}.png`, fullPage: width === 390 });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
};

/** Exactly one headline of each kind on the page, with this text. */
const oneHeadline = async (page: Page, testId: string, text: string | RegExp) => {
  await expect(page.getByTestId(testId)).toHaveCount(1);
  await expect(page.getByTestId(testId)).toHaveText(text, { timeout: 30_000 });
};

test("one money headline per state on the host's page, the renter's page and the second look; the rest folds behind Why?", async ({ page, request }) => {
  test.setTimeout(420_000);
  const flow = await toProposal(page, request, { checkOut: "two", item: "Lakeside cabin, weekend of Feb 5" });
  test.skip(flow.live, "This walk relies on the mock reading the host's own check-out shot as unsure");
  const booking = await flow.booking();
  const scratch = booking.proposal!.lines.find((l) => l.price?.type !== "stain")!;
  const stain = booking.proposal!.lines.find((l) => l.price?.type === "stain")!;

  // Proposed.
  await oneHeadline(page, "host-headline", "Proposed: charge $250.00, release $50.00");
  await unfold(page, "hold");
  await expect(page.getByTestId("hold-length")).toBeHidden();
  await page.getByTestId("hold-why-toggle").click();
  await expect(page.getByTestId("hold-length")).toBeVisible();
  await shots(page, "host-proposed");

  const renter = await openAsRenter(page, booking);
  await oneHeadline(renter, "renter-headline", "Proposed charge: $250.00. $50.00 goes back to you.");
  await shots(renter, "renter-proposed");

  // Contested: the renter accepts the scratch and contests the stain with the host's own shot.
  await renter.getByTestId(`line-accept-${scratch.id}`).click();
  await renter.getByTestId(`line-contest-${stain.id}`).click();
  await renter.getByTestId(`evidence-upload-${stain.id}`).setInputFiles("public/demo-photos/cabin-check-out-two.jpg");
  await renter.getByTestId("contest-note").fill("The stain was there when we arrived.");
  await renter.getByTestId("contest").click();
  await expect(renter.getByTestId("renter-contested")).toBeVisible();
  await expect(renter.getByTestId("renter-contested-why")).not.toHaveAttribute("open");
  await oneHeadline(page, "host-headline", "Your approval: capture $150.00, keep $150.00 on hold");
  await expect(page.getByTestId("approve-button")).toHaveText("Approve: capture $150.00");
  await page.getByTestId("approve-button").click();
  await oneHeadline(renter, "renter-headline", "$150.00 charged for what you accepted. $100.00 you contested is with the host.");

  // The second look can't tell: the host decides.
  const card = page.getByTestId("second-look");
  await expect(card).toHaveAttribute("data-status", "ready", { timeout: 60_000 });
  await oneHeadline(page, "host-headline", "$150.00 charged · Decide: keep or drop $100.00");
  await oneHeadline(page, "second-look-headline", "Claude can't tell on $100.00: you decide");
  await expect(card.getByTestId("second-look-reasoning")).toBeHidden();
  await card.getByTestId("second-look-why-toggle").click();
  await expect(card.getByTestId("second-look-reasoning")).toBeVisible();
  await shots(page, "host-second-look-flagged");

  // Dropped: the counter is ready, then with the renter.
  await card.getByTestId("flag-drop").click();
  await oneHeadline(page, "second-look-headline", "Contested $100.00 → $0.00");
  await oneHeadline(page, "host-headline", "$150.00 charged · Counter ready: $100.00 → $0.00");
  await expect(card.getByTestId("send-counter")).toBeEnabled({ timeout: 30_000 });
  await card.getByTestId("send-counter").click();
  await oneHeadline(page, "host-headline", "$150.00 charged · Counter with the renter: $0.00");
  await oneHeadline(renter, "renter-headline", "Counter: $0.00 for what you contested");
  await shots(renter, "renter-counter");
  await renter.getByTestId("accept-counter").click();

  // Approval, then settled: the ruling's headline is the one on screen.
  await oneHeadline(page, "host-headline", "Your approval: release $150.00");
  await expect(page.getByTestId("approve-button")).toHaveText("Approve: release $150.00");
  await shots(page, "host-approval");
  await page.getByTestId("approve-button").click();
  await expect(page.getByTestId("ruling-headline")).toHaveText("$150 captured, $150 released", { timeout: 60_000 });
  await expect(page.getByTestId("host-headline")).toHaveClass(/sr-only/);
  await expect(page.getByTestId("host-headline")).toHaveText("$150.00 captured, $150.00 released");
  await expect(page.getByTestId("ruling-rationale")).toBeHidden();
  await shots(page, "host-settled");
  await expect(renter.getByTestId("renter-headline")).toHaveText("$150 charged, $150 released", { timeout: 15_000 });
  await shots(renter, "renter-settled");
  await renter.context().close();
});
