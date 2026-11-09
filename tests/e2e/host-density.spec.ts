/**
 * Host density: the host's booking page leads with one line per item and folds the rest behind
 * "Why?" or "Show reasoning"; the setup badges are one small chip; on a phone the landing page's
 * tables fold. Screenshots at 1440 and 390 wide. Logs the visible words on the host's page.
 */
import { expect, test, type Page } from "@playwright/test";
import { expectNoSidewaysScroll, toProposal } from "./booking-flow";

const visibleChars = (page: Page) => page.locator("main").evaluate((el) => (el as HTMLElement).innerText.replace(/\s+/g, " ").length);

test("the host's page: one line per item, the reasoning folded, one setup chip", async ({ page, request }) => {
  test.setTimeout(240_000);
  const flow = await toProposal(page, request, { item: "Lakeside cabin, weekend of Feb 5" });
  const booking = await flow.booking();

  // Each item is one line of words plus its price row; the rest of the description folds.
  const titles = page.getByTestId("review").getByTestId("damage-item-title");
  await expect(titles).toHaveCount(booking.review!.items.length);
  for (const title of await titles.all()) {
    const box = (await title.boundingBox())!;
    expect(box.height, "one line per item").toBeLessThan(26);
  }
  // Claude's reasoning and the agent's rationale are one click away, not on the page.
  await expect(page.getByTestId("review-reasoning")).toBeHidden();
  await page.getByTestId("review-why-toggle").click();
  await expect(page.getByTestId("review-reasoning")).toBeVisible();
  await page.getByTestId("review-why-toggle").click();
  await expect(page.getByTestId("proposal-rationale")).toBeHidden();
  await expect(page.getByTestId("proposal-rationale")).toHaveText(booking.proposal!.rationale);
  await page.getByTestId("proposal-why-toggle").click();
  await expect(page.getByTestId("proposal-rationale")).toBeVisible();
  await page.getByTestId("proposal-why-toggle").click();

  // The finished wait list is one line; its steps fold.
  await expect(page.getByTestId("wait-story")).toBeVisible();
  await expect(page.getByTestId("wait-step-hold")).toBeHidden();

  // The setup is one chip; its details open on a click.
  await expect(page.getByTestId("mode-chip").filter({ visible: true })).toHaveCount(1);
  await expect(page.getByTestId("mode-details").filter({ visible: true })).toHaveCount(0);
  await expect(page.getByTestId("mode-chip").filter({ visible: true })).toHaveText(/^(Sandbox|PayPal mock) · (live Claude|AI mock)$/);
  console.log(`Host page at the proposal (${flow.live ? "live" : "mock"} AI): ${await visibleChars(page)} visible characters in main`);

  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await expectNoSidewaysScroll(page);
    await page.screenshot({ path: `screenshots/density-host-proposal-${width}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByTestId("mode-chip").filter({ visible: true }).click();
  await expect(page.getByTestId("mode-details").filter({ visible: true })).toContainText(/PayPal (sandbox|mock)/);
  await page.screenshot({ path: "screenshots/density-mode-chip-1440.png" });
});

test("on a phone the landing page folds its tables; wider, they're open", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  for (const fold of ["landing-blind-fold", "differs-tools-fold"]) {
    await expect(page.getByTestId(fold)).not.toHaveAttribute("open");
    await expect(page.getByTestId(`${fold}-toggle`)).toBeVisible();
  }
  await expect(page.getByTestId("landing-blind-row").first()).toBeHidden();
  await expect(page.getByTestId("differs-tool").first()).toBeHidden();
  await expectNoSidewaysScroll(page);
  const screens = await page.evaluate(() => document.documentElement.scrollHeight / window.innerHeight);
  console.log(`Phone landing: ${screens.toFixed(1)} screens tall`);
  await page.screenshot({ path: "screenshots/density-landing-390.png", fullPage: true });
  await page.getByTestId("landing-blind-fold-toggle").click();
  await expect(page.getByTestId("landing-blind-row")).toHaveCount(3);
  await expect(page.getByTestId("landing-blind-row").first()).toBeVisible();

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  for (const fold of ["landing-blind-fold", "differs-tools-fold"]) {
    await expect(page.getByTestId(fold)).toHaveAttribute("open", "");
    await expect(page.getByTestId(`${fold}-toggle`)).toBeHidden();
  }
  await expect(page.getByTestId("differs-tool").first()).toBeVisible();
  await page.screenshot({ path: "screenshots/density-landing-1440.png", fullPage: true });
});
