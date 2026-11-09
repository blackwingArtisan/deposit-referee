/**
 * Once the agent has proposed, the finished steps fold to one line each and the decision leads:
 * the approval card is the first thing under the page header, on a laptop and on a phone. The
 * sample photos and the limit test sit behind one "Demo tools" disclosure.
 */
import { expect, test, type Page } from "@playwright/test";
import { expectNoSidewaysScroll, openDemoTools, renterAccepts, toProposal } from "./booking-flow";

const SIZES = [
  { width: 1440, height: 900, name: "desktop" },
  { width: 390, height: 844, name: "phone" },
];

async function top(page: Page, testId: string) {
  return (await page.getByTestId(testId).boundingBox())!.y;
}

test("with a proposal, the finished steps fold to one line and the approval card comes first", async ({ page, request }) => {
  const flow = await toProposal(page, request, { item: "Lakeside cabin, weekend of Dec 4" });

  // Demo tools: closed until asked, and while the host decides it holds the limit test, not the photos.
  const tools = page.getByTestId("demo-tools");
  await expect(tools).not.toHaveAttribute("open");
  await expect(page.getByTestId("limit-test")).toBeHidden();
  await openDemoTools(page);
  await expect(page.getByTestId("limit-test")).toBeVisible();
  await expect(tools.getByTestId("demo-photo-check_in")).toHaveCount(0);
  await expect(page.getByTestId("for-judges")).toHaveCount(1);

  await renterAccepts(page, await flow.booking());
  await page.reload();
  await page.getByTestId("request-approval").click();
  const prompt = page.getByTestId("approval-prompt");
  await expect(prompt).toBeVisible({ timeout: 30_000 });

  for (const size of SIZES) {
    await page.setViewportSize({ width: size.width, height: size.height });
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(page.getByTestId("fold-hold-summary")).toContainText("$300 authorized on PayPal, nothing charged");
    for (const step of ["hold", "photos", "compare"]) {
      const summary = page.getByTestId(`fold-${step}`).locator(":scope > summary");
      await expect(summary).toBeVisible();
      // One line each.
      expect((await summary.boundingBox())!.height, `${step} on ${size.name}`).toBeLessThanOrEqual(40);
    }
    // The approval card sits above the folded steps, straight under the page header and its money headline, and starts on screen.
    const header = (await page.getByTestId("host-headline").boundingBox())!;
    const card = await top(page, "approval-prompt");
    expect(card).toBeLessThan(await top(page, "fold-hold"));
    expect(card - (header.y + header.height), `gap under the header on ${size.name}`).toBeLessThan(140);
    expect(card).toBeLessThan(size.height - 200);
    await expectNoSidewaysScroll(page);
    await page.screenshot({ path: `screenshots/booking-fold-${size.name}.png` });
  }

  // A folded step opens on a click, with everything it showed before.
  await page.getByTestId("fold-photos").locator(":scope > summary").click();
  await expect(page.getByTestId("photo-source")).toHaveCount(2);
  await expect(page.getByTestId("photo-source").first()).toBeVisible();
});
