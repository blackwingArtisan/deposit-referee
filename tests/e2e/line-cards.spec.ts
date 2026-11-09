/**
 * Line cards: on the host's proposal and on Claude's second look, each money line is a card like
 * the renter's: a cropped thumbnail of the mark with its box, a price chip, one line of reason and
 * the amount. No text under 14 px in them. Screenshots at 1440 and 390 wide. Mock AI: the renter
 * contests the stain with their dated check-in close-up, which the mock reads as already there.
 */
import { expect, test, type Locator, type Page } from "@playwright/test";
import { expectNoSidewaysScroll, openAsRenter, toProposal } from "./booking-flow";

/** Visible text under 14 px inside `root`, as "12px: words". Folded "Why?" text has no box, so it isn't counted. */
const smallText = (root: Locator) =>
  root.evaluate((el) => {
    const out: string[] = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent?.trim();
      const parent = node.parentElement;
      if (!text || !parent || parent.closest(".sr-only")) continue;
      const box = parent.getBoundingClientRect();
      if (!box.width || !box.height || !parent.checkVisibility({ contentVisibilityAuto: true, visibilityProperty: true })) continue;
      const size = parseFloat(getComputedStyle(parent).fontSize);
      if (size < 14) out.push(`${size}px: ${text.slice(0, 50)}`);
    }
    return out;
  });

/** Each card has the mark cropped with its box showing, inside the tile. */
const expectThumb = async (card: Locator) => {
  const thumb = card.getByTestId("mark-thumb");
  await expect(thumb).toBeVisible();
  const box = thumb.getByTestId("damage-box");
  await expect(box).toBeVisible();
  const [t, b] = [await thumb.boundingBox(), await box.boundingBox()];
  // The crop is zoomed on the mark: its box sits inside the tile and fills a fair part of it.
  expect(b!.x + b!.width / 2).toBeGreaterThan(t!.x);
  expect(b!.x + b!.width / 2).toBeLessThan(t!.x + t!.width);
  expect(b!.y + b!.height / 2).toBeGreaterThan(t!.y);
  expect(b!.y + b!.height / 2).toBeLessThan(t!.y + t!.height);
  expect(Math.max(b!.width / t!.width, b!.height / t!.height)).toBeGreaterThan(0.3);
};

const shots = async (page: Page, target: Locator, name: string, checkText = true) => {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await expectNoSidewaysScroll(page);
    if (checkText) expect(await smallText(target), `no text under 14 px in ${name} at ${width}`).toEqual([]);
    await target.scrollIntoViewIfNeeded();
    await target.screenshot({ path: `screenshots/line-cards-${name}-${width}.png` });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
};

test("the host's proposal and the second look show each line as a card: the mark cropped, a price chip, one line of reason, the amount", async ({ page, request }) => {
  test.setTimeout(300_000);
  const flow = await toProposal(page, request, { checkOut: "two", item: "Lakeside cabin, weekend of Feb 12" });
  const booking = await flow.booking();
  const lines = booking.proposal!.lines;

  // The proposal: one card per line, each with its mark, chip and amount.
  const itemized = page.getByTestId("itemized-charge");
  const cards = itemized.getByTestId("charge-line");
  await expect(cards).toHaveCount(lines.length);
  for (const [i, line] of lines.entries()) {
    const card = cards.nth(i);
    if (line.box) await expectThumb(card);
    await expect(card).toContainText(`${i + 1}. ${line.description.split(/(?<=\.)\s/)[0]}`);
    if (line.price) await expect(card.getByTestId("price-row")).toBeVisible();
    await expect(card.getByTestId(`line-amount-${line.id}`)).toHaveValue((line.amountCents / 100).toFixed(2));
  }
  await shots(page, itemized, "proposal");

  test.skip(flow.live || lines.length < 2, "The second look's card is checked on the mock's two marks");
  const stain = lines.find((l) => l.price?.type === "stain")!;
  const other = lines.find((l) => l.id !== stain.id)!;
  const renter = await openAsRenter(page, booking);
  // The renter's cards, for comparison (their page is unchanged here).
  await shots(renter, renter.getByTestId("renter-lines"), "renter", false);
  await renter.getByTestId(`line-accept-${other.id}`).click();
  await renter.getByTestId(`line-contest-${stain.id}`).click();
  await renter.getByTestId(`evidence-upload-${stain.id}`).setInputFiles("public/demo-photos/renter-check-in-stain.jpg");
  await renter.getByTestId("contest-note").fill("The stain was there when we arrived.");
  await renter.getByTestId("contest").click();
  await expect(renter.getByTestId("renter-contested")).toBeVisible();
  await expect(page.getByTestId("approval-prompt")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("approve-button").click();

  // The second look: the mark (greyed, it was already there) beside the renter's photo, and the amount falling.
  const look = page.getByTestId("second-look");
  await expect(look).toHaveAttribute("data-status", "ready", { timeout: 60_000 });
  const row = look.getByTestId("second-look-line");
  await expect(row).toHaveCount(1);
  await expectThumb(row);
  await expect(row.getByTestId("damage-box")).toHaveAttribute("data-state", "dropped");
  await expect(row.getByRole("img", { name: "Renter's photo" })).toBeVisible();
  await expect(row.getByTestId("second-look-verdict")).toHaveText("Already there: seen in the renter's photo");
  await expect(row.getByTestId("line-reason")).not.toBeEmpty();
  await expect(row.getByTestId("price-row")).toBeVisible();
  await expect(row.getByTestId("second-look-amount")).toHaveText(/\$100\.00\s*\$0\.00/);
  await shots(page, look, "second-look");
  await renter.context().close();
});
