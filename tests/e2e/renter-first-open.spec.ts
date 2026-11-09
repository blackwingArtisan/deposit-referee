/**
 * The renter's first open, on a phone, by someone who has never seen the app: three lines say what
 * is held, what is proposed and what to do by when; one card per item with Accept and Contest. They
 * finish without opening any help (the details disclosure stays shut). The host's page mirrors each
 * step in the conversation rail, and after settlement both sides see the same ruling.
 */
import { expect, test, type Page } from "@playwright/test";
import { dollars, expectNoSidewaysScroll, headline, toProposal } from "./booking-flow";

const DEPOSIT_CENTS = 30_000;
const PHONE = { width: 390, height: 844 };

const shot = (name: string, flow: { mode: string; live: boolean }) => `screenshots/${name}-${flow.mode}-${flow.live ? "live-ai" : "mock-ai"}.png`;

async function railTexts(page: Page) {
  return page.getByTestId("conversation-rail").getByTestId("rail-text").allTextContents();
}

test("first open: a renter accepts one item and contests the other from the phone, with no help opened, and both sides end on the same ruling", { tag: "@live-ai" }, async ({ page, request }) => {
  const flow = await toProposal(page, request, { checkOut: "two", item: "Lakeside cabin, weekend of Jan 8" });
  const reviewed = await flow.booking();
  const lines = reviewed.proposal!.lines;
  // By what each line is, never by position (live AI lists the marks in either order): the renter
  // accepts the other mark and contests the stain, as their note says.
  const isStain = (line: (typeof lines)[number]) => (line.price ? line.price.type === "stain" : /stain/i.test(line.description));
  const contested = lines.filter(isStain);
  const accepted = lines.find((line) => !isStain(line))!;
  test.skip(!contested.length || !accepted || lines.length !== contested.length + 1, `The review found ${lines.map((l) => l.price?.type ?? "unpriced").join(", ") || "nothing"} on the two-marks photo, not the stain and one other mark, so there is nothing to split`);
  const chargeCents = lines.reduce((sum, l) => sum + l.amountCents, 0);

  // The host's rail before the renter opens anything: the hold, and an answer due.
  const rail = page.getByTestId("conversation-rail");
  await expect(rail).toBeVisible();
  await expect.poll(() => railTexts(page)).toEqual(["Placed the $300 hold", "Answer due"]);

  // The renter's phone.
  const context = await page.context().browser()!.newContext({ baseURL: new URL(page.url()).origin, viewport: PHONE, isMobile: true, hasTouch: true });
  const renter = await context.newPage();
  await renter.goto(`/renter/${reviewed.renterToken}`);
  const details = renter.getByTestId("renter-details");
  const noHelpOpened = async () => {
    await expect(details).not.toHaveAttribute("open");
    await expect(renter.locator("details[open]")).toHaveCount(0);
  };

  // Three lines at the top, in words a first-time renter reads.
  const summary = renter.getByTestId("renter-summary");
  await expect(summary.locator("li")).toHaveCount(3);
  await expect(renter.getByTestId("renter-summary-hold")).toHaveText("$300 is on hold with PayPal, not charged.");
  await expect(renter.getByTestId("renter-summary-proposal")).toHaveText(`The host proposes ${dollars(chargeCents)} for ${lines.length} marks.`);
  await expect(renter.getByTestId("renter-summary-action")).toHaveText(/^Accept or contest each one by .+\.$/);

  // One card per item: the photo with its box, the amount, the price row, Accept and Contest.
  for (const [i, line] of lines.entries()) {
    const card = renter.getByTestId(`renter-line-${line.id}`);
    await expect(card).toBeVisible();
    await expect(card.getByTestId("damage-box")).toHaveCount(1);
    await expect(card.getByTestId("damage-box")).toHaveAttribute("aria-label", new RegExp(`^Damage ${i + 1}:`));
    await expect(card.getByTestId(`renter-line-amount-${line.id}`)).toHaveText(dollars(line.amountCents));
    if (line.price) await expect(card.getByTestId("price-row")).toBeVisible();
    await expect(card.getByTestId(`line-accept-${line.id}`)).toBeVisible();
    await expect(card.getByTestId(`line-contest-${line.id}`)).toBeVisible();
  }
  // Until they pick, the one button there is to accept everything.
  await expect(renter.getByTestId("accept")).toHaveText(`Accept all: ${dollars(chargeCents)}`);
  await expect(renter.getByTestId("contest-note")).toHaveCount(0);
  await noHelpOpened();
  await expectNoSidewaysScroll(renter);
  await renter.screenshot({ path: shot("renter-first-open-phone", flow), fullPage: true });

  // The host sees the renter has opened it.
  await expect.poll(() => railTexts(page), { timeout: 15_000 }).toContain("Opened the proposal");

  // Accept the other mark, contest the stain: the note box and the photo picker appear only now.
  await renter.getByTestId(`line-accept-${accepted.id}`).click();
  await expect(renter.getByTestId(`line-accept-${accepted.id}`)).toHaveAttribute("aria-pressed", "true");
  await renter.getByTestId(`line-contest-${contested[0].id}`).click();
  await expect(renter.getByTestId(`evidence-upload-${contested[0].id}`)).toBeAttached();
  await expect(renter.getByTestId(`evidence-upload-${accepted.id}`)).toHaveCount(0);
  for (const line of contested.slice(1)) await renter.getByTestId(`line-contest-${line.id}`).click();
  await expect(renter.getByTestId("accept")).toHaveCount(0);
  await expect(renter.getByTestId("contest")).toBeDisabled();
  await expect(renter.getByTestId("contest-why")).toHaveText("Write a note to the host to contest.");
  await renter.getByTestId("contest-note").fill("The stain was there when we arrived.");
  await expect(renter.getByTestId("contest")).toHaveText(`Contest ${contested.length} of ${lines.length} items`);
  await renter.screenshot({ path: shot("renter-first-open-answer-phone", flow), fullPage: true });
  await renter.getByTestId("contest").click();
  await expect(renter.getByTestId("renter-contested")).toBeVisible();
  await expect(renter.getByTestId(`renter-line-answer-${accepted.id}`)).toHaveText("You accepted");
  await expect(renter.getByTestId(`renter-line-answer-${contested[0].id}`)).toHaveText("You contested");
  await expect(renter.getByTestId("renter-summary-action")).toHaveText("You answered. The host decides what you contested.");
  await noHelpOpened();

  // The host's rail, in order, as one exchange with the phone.
  await expect.poll(() => railTexts(page), { timeout: 15_000 }).toEqual(expect.arrayContaining(["Placed the $300 hold", "Opened the proposal", expect.stringMatching(/ accepted$/), expect.stringMatching(/ contested$/)]));
  const texts = await railTexts(page);
  expect(texts.indexOf("Opened the proposal")).toBeGreaterThan(texts.indexOf("Placed the $300 hold"));
  expect(texts.findIndex((t) => / contested$/.test(t))).toBeGreaterThan(texts.indexOf("Opened the proposal"));
  await expect(rail.locator('[data-testid="rail-entry"][data-who="renter"]').first()).toBeVisible();
  await expectNoSidewaysScroll(page);
  await page.screenshot({ path: shot("host-conversation-rail-desktop", flow), fullPage: true });

  // The host approves the accepted part; Claude takes its second look.
  await expect(page.getByTestId("approval-prompt")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("approve-button").click();
  await expect(page.getByTestId("part-capture")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("second-look")).toHaveAttribute("data-status", "ready", { timeout: 120_000 });
  const look = (await flow.booking()).secondLook!;
  if (look.lines.every((l) => l.toCents >= l.fromCents)) {
    // A note with no photo changed nothing: the card and the rail say so, and the host decides.
    await expect(page.getByTestId("second-look-unchanged")).toContainText("The second look changes nothing.");
    await expect(page.getByTestId("send-counter")).toHaveCount(0);
    await expect.poll(() => railTexts(page), { timeout: 15_000 }).toEqual(expect.arrayContaining([expect.stringMatching(/ captured for what they accepted$/), expect.stringMatching(/^Second look: .* stands$/), "No new offer: the second look changed nothing"]));
    await page.getByTestId("request-approval").click();
  } else {
    // The second look lowered something: the host sends the counter, and the renter accepts it on the phone.
    await expect(page.getByTestId("send-counter")).toBeEnabled({ timeout: 90_000 });
    await page.getByTestId("send-counter").click();
    await expect.poll(() => railTexts(page), { timeout: 15_000 }).toEqual(expect.arrayContaining([expect.stringMatching(/ captured for what they accepted$/), expect.stringMatching(/^Second look: /), expect.stringMatching(/^Counter sent: /)]));
    await expect(renter.getByTestId("accept-counter")).toBeVisible({ timeout: 15_000 });
    await renter.getByTestId("accept-counter").click();
  }
  // The host approves what's left.
  await expect(page.getByTestId("approval-prompt")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("approve-button").click();
  await expect(page.getByTestId("ruling-headline")).toBeVisible({ timeout: 60_000 });
  const done = await flow.booking();
  const captured = done.settlement!.capturedCents!;
  const ruling = `${headline(captured)} captured, ${headline(DEPOSIT_CENTS - captured)} released`;
  await expect(page.getByTestId("ruling-headline")).toHaveText(ruling);

  // The same ruling on the renter's phone: the same headline, the same PayPal ids, the photos, the pack.
  await expect(renter.getByTestId("ruling-headline")).toHaveText(ruling, { timeout: 15_000 });
  await expect(renter.getByTestId("ruling-shared")).toHaveText("The host sees this same page.");
  await expect(page.getByTestId("ruling-shared")).toHaveText(`${done.renter} sees this same page on their link.`);
  for (const id of [done.orderId!, done.authorizationId!, done.partCapture!.captureId!, ...(done.settlement!.captureId ? [done.settlement!.captureId] : [])]) {
    await expect(renter.getByTestId("ruling")).toContainText(id);
    await expect(page.getByTestId("ruling")).toContainText(id);
  }
  await expect(renter.getByTestId("money-strip")).toHaveAttribute("aria-label", (await page.getByTestId("money-strip").getAttribute("aria-label"))!);
  await expect(renter.getByTestId("ruling-second-look")).toBeVisible();
  const pack = await renter.request.get(`/api/renter/${reviewed.renterToken}/evidence`);
  expect(pack.status()).toBe(200);
  expect(pack.headers()["content-type"]).toBe("application/pdf");
  await expect(renter.getByTestId("ruling-pack")).toBeVisible();
  await expectNoSidewaysScroll(renter);
  await renter.screenshot({ path: shot("shared-ruling-phone", flow), fullPage: true });
  await page.screenshot({ path: shot("shared-ruling-desktop", flow), fullPage: true });

  // The same renter page on a laptop.
  await renter.setViewportSize({ width: 1280, height: 900 });
  await renter.screenshot({ path: shot("shared-ruling-renter-desktop", flow), fullPage: true });
  await context.close();
});

test("first open on a laptop: the three lines and the item cards fit, and one item is one card", async ({ page, request }) => {
  const flow = await toProposal(page, request, { item: "Harbor loft, weekend of Jan 15" });
  const booking = await flow.booking();
  const context = await page.context().browser()!.newContext({ baseURL: new URL(page.url()).origin, viewport: { width: 1280, height: 900 } });
  const renter = await context.newPage();
  await renter.goto(`/renter/${booking.renterToken}`);
  const lines = booking.proposal!.lines;
  await expect(renter.getByTestId("renter-summary").locator("li")).toHaveCount(3);
  await expect(renter.locator('[data-testid^="renter-line-"][data-choice]')).toHaveCount(lines.length);
  if (lines.length === 1) {
    await expect(renter.getByTestId("renter-summary-action")).toHaveText(/^Accept or contest it by .+\.$/);
    await expect(renter.getByTestId("accept")).toHaveText(`Accept ${dollars(lines[0].amountCents)}`);
  }
  await expect(renter.getByTestId("renter-details")).not.toHaveAttribute("open");
  await expectNoSidewaysScroll(renter);
  await renter.screenshot({ path: shot("renter-first-open-desktop", flow), fullPage: true });
  // Accepting takes one tap and no help.
  await renter.getByTestId("accept").click();
  await expect(renter.getByTestId("renter-accepted")).toBeVisible();
  await expect(renter.locator("details[open]")).toHaveCount(0);
  await context.close();
});
