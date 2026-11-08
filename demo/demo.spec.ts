/**
 * The demo video (npm run demo:record): a booking, the renter placing the hold from their own page
 * on a phone, Claude comparing the photos, the renter accepting one item and contesting the other,
 * the approval card, the split capture, every PayPal call, and an end card read back from PayPal.
 * A caption is on screen in every frame. Saves a .webm to videos/. For PayPal's real card form,
 * record on the sandbox: DEMO_BASE_URL=https://deposit-referee.onrender.com records the hosted
 * site with live AI; DEMO_PAYPAL_MODE=sandbox records a local one. Mock PayPal shows a stand-in.
 */
import { expect, test, type FrameLocator, type Page } from "@playwright/test";
import { caption, closePhone, DemoClock, highlight, openPhone, titleCard, zoomOn } from "./captions";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const whole = (cents: number) => `$${(cents / 100).toFixed(cents % 100 ? 2 : 0)}`;
/** A caption that stays up until the next one replaces it, so no frame is left without one. */
const STAY = 10 * 60_000;
const say = (page: Page, text: string, readMs = 0) => caption(page, text, { ms: STAY, wait: false }).then(() => sleep(readMs));

async function tap(page: Page, testId: string) {
  const target = page.getByTestId(testId).first();
  await target.scrollIntoViewIfNeeded();
  await highlight(page, target, 900);
  await target.click();
}

/** How long the approval card stays on screen before the host clicks Approve. */
const APPROVAL_HOLD_MS = 4_000;
/** The most the card form (or the mock's stand-in window) may be on screen. */
const FORM_MAX_MS = 6_000;

/**
 * The renter fills PayPal's own card form (an iframe inside the renter's page), with PayPal's
 * sandbox test card. Returns when the form opened, so the caller can time it on screen.
 */
async function payInPayPal(phone: FrameLocator): Promise<number> {
  // PayPal's button can take a moment to wire up after it draws, so click until its form opens.
  const frames = phone.locator('iframe[src*="/smart/card-fields"]');
  const button = phone.getByTestId("paypal-guest-button").locator("paypal-basic-card-button");
  await button.waitFor({ state: "visible", timeout: 30_000 });
  await sleep(1_500);
  for (let i = 0; i < 4 && !(await frames.count()); i++) {
    await button.click({ timeout: 30_000 });
    await frames.first().waitFor({ state: "attached", timeout: 5_000 }).catch(() => {});
  }
  const form = phone.frameLocator('iframe[src*="/smart/card-fields"]');
  await form.getByLabel("Email").waitFor({ state: "visible", timeout: 30_000 });
  const opened = Date.now();
  await form.getByLabel("Email").fill("renter@example.com");
  await form.getByLabel("Card number").fill("4111111111111111");
  await form.getByLabel("Expires").fill("12/30");
  await form.getByLabel("CSC").fill("123");
  await form.getByLabel("First name").fill("Alex");
  await form.getByLabel("Last name").fill("Rivera");
  await form.getByLabel("Street address").fill("1 Main St");
  await form.getByLabel("City").fill("Austin");
  await form.getByLabel("State").selectOption("TX");
  await form.getByLabel(/ZIP/i).fill("78701");
  const mobile = form.getByLabel(/Mobile|Phone/i).first();
  if (await mobile.isVisible().catch(() => false)) await mobile.fill("5125550100");
  await form.getByRole("button", { name: /^Pay \$/ }).click();
  return opened;
}

test("demo", async ({ page, request }) => {
  const clock = new DemoClock(148);
  // Mock mode starts clean and seeds here. On the sandbox the config has already seeded, and the
  // hosted site seeds itself on start; these routes are mock-only, so there they do nothing.
  await request.post("/api/dev/reset");
  await request.post("/api/dev/seed");
  const status = await (await request.get("/api/kit/status")).json();
  const sandbox = status.paypal.mode === "sandbox";

  // Open: the problem.
  await page.goto("/");
  await expect(page.getByTestId("landing-headline")).toBeVisible();
  await say(page, "More than half of hosts have had a guest damage their place. Rent from your own site, and nobody settles it.", 4200);
  clock.check("open");

  // 1. The booking.
  await page.goto("/bookings");
  await say(page, "The host books the cabin and asks for a $300 deposit.");
  await page.getByLabel("What's being rented").pressSequentially("Cedar cabin, weekend of Nov 13", { delay: 16 });
  await page.getByLabel("Renter").pressSequentially("Alex Rivera", { delay: 22 });
  await tap(page, "create-booking");
  await page.waitForURL(/\/bookings\/bk_/);
  const id = new URL(page.url()).pathname.split("/").pop()!;
  clock.check("booking");

  // 2. The host waits; the renter places the hold from their own page, on their phone.
  await expect(page.getByTestId("waiting-headline")).toBeVisible();
  await highlight(page, page.getByTestId("waiting-for-hold"), 1400);
  await say(page, "The host's page waits for the renter's hold. The host never sees a card form.", 2200);
  const { renterToken } = await (await page.request.get(`/api/bookings/${id}`)).json();
  const renter = await openPhone(page, `/renter/${renterToken}`);
  await expect(renter.getByTestId("renter-headline")).toHaveText("Place your $300 deposit hold", { timeout: 20_000 });
  await say(page, "The renter opens their link and places a $300 hold with PayPal. Nothing is charged.", 2000);
  // PayPal's card form (or the mock's stand-in) is on screen for at most 6 seconds.
  let formOpened: number;
  if (sandbox) {
    await say(page, "PayPal's own card form, with PayPal's sandbox test card.");
    formOpened = await payInPayPal(renter);
  } else {
    await renter.getByTestId("simulate-paypal-approval").click();
    await expect(renter.getByTestId("mock-approve")).toBeVisible();
    formOpened = Date.now();
    await say(page, "PayPal's own card form, with PayPal's sandbox test card.", 3_500);
    await renter.getByTestId("mock-approve").click();
  }
  const held = renter.getByTestId("renter-hold-headline");
  await expect(held).toHaveText("$300 authorized, nothing charged", { timeout: 45_000 });
  const formMs = Date.now() - formOpened;
  console.log(`[demo] card form on screen ${(formMs / 1000).toFixed(1)}s`);
  expect.soft(formMs, "the card form is on screen at most 6 s").toBeLessThanOrEqual(FORM_MAX_MS);
  await say(page, "$300 authorized, nothing charged.", 1800);
  await closePhone(page);
  const authId = page.getByTestId("hold-authorization-id");
  await expect(authId).toHaveText(/\w{10,}/, { timeout: 45_000 });
  const authorizationId = (await authId.textContent())!.trim();
  await authId.scrollIntoViewIfNeeded();
  await highlight(page, authId, 2600);
  await say(page, `The host's page picks it up: PayPal authorization ${authorizationId}, guaranteed 3 days, capturable until day 29.`, 3800);
  clock.check("hold");

  // 3. The comparison, captioned while Claude works.
  await say(page, "After the stay, the host adds the check-in and check-out photos.");
  await tap(page, "demo-photo-check_in");
  await expect(page.getByTestId("demo-photo-two")).toBeEnabled();
  await tap(page, "demo-photo-two");
  await expect(page.getByTestId("photo-source")).toHaveCount(2);
  await tap(page, "run-review");
  await say(page, status.ai.mode === "live" ? "Claude Sonnet 5.5 compares the two photos and boxes only what's new. Each step shows as it happens." : "Claude compares the two photos and boxes only what's new. Each step shows as it happens.");
  await expect(page.getByTestId("review")).toBeVisible({ timeout: 90_000 });
  await say(page, "Two new marks: a gouge in the floor and a stain on the rug.");
  await zoomOn(page, page.getByTestId("damage-box").first(), { scale: 2.4, ms: 2600 });
  const proposal = page.getByTestId("ai-proposal");
  await say(page, "The settlement agent prices each one from the price table, proposes, and stops.");
  await expect(proposal).toBeVisible({ timeout: 90_000 });
  await page.screenshot({ path: "docs/screenshot.png", style: "#__demo_caption { display: none !important; } body { padding-bottom: 0 !important; }" });
  const view = await (await page.request.get(`/api/bookings/${id}`)).json();
  const lines = view.proposal.lines as { id: string; amountCents: number }[];
  const [accepted, ...contestedLines] = lines;
  const acceptedCents = accepted.amountCents;
  const contestedCents = contestedLines.reduce((sum, l) => sum + l.amountCents, 0);
  await proposal.scrollIntoViewIfNeeded();
  await highlight(page, proposal, 1800);
  await say(page, `${whole(acceptedCents)} for the gouge, ${whole(contestedCents)} for the stain. It has no tool that can move money.`, 3600);
  clock.check("proposal");

  // 4. The renter, on their phone: accepts the gouge, contests the stain.
  const phone = await openPhone(page, `/renter/${view.renterToken}`);
  await expect(phone.getByTestId("renter-headline")).toBeVisible({ timeout: 20_000 });
  await say(page, "The renter gets a link with the same photos and reasons.", 2400);
  await phone.getByTestId(`contest-line-${accepted.id}`).scrollIntoViewIfNeeded();
  await say(page, "They accept the gouge and contest the stain: it was there when they arrived.");
  await phone.getByTestId(`contest-line-${accepted.id}`).uncheck();
  await phone.getByTestId("contest-note").pressSequentially("The rug stain was there when I arrived.", { delay: 14 });
  await phone.getByTestId("contest").click();
  await expect(phone.getByTestId("renter-contested")).toBeVisible();
  await sleep(1800);
  await closePhone(page);
  clock.check("contest");

  // 5. The split capture: the accepted part now, the contested part from the same hold later.
  const prompt = page.getByTestId("approval-prompt");
  await say(page, `The ${whole(acceptedCents)} they accepted can be charged now. Nothing moves until the host approves.`);
  await expect(prompt).toBeVisible({ timeout: 30_000 });
  // The approval card is held on screen for 4 seconds: each line, the renter's answer and the Guard's reason.
  await prompt.evaluate((el) => el.scrollIntoView({ block: "center" }));
  const cardShown = Date.now();
  await highlight(page, prompt, 1600);
  await say(page, `Each line with its price row and the renter's answer. ${await prompt.getByTestId("approval-money").textContent()}.`);
  await sleep(Math.max(0, APPROVAL_HOLD_MS - (Date.now() - cardShown)));
  await highlight(page, prompt.getByTestId("approve-button"), 900);
  console.log(`[demo] approval card held ${((Date.now() - cardShown) / 1000).toFixed(1)}s`);
  await prompt.getByTestId("approve-button").click();
  await say(page, `Approved. PayPal captures the ${whole(acceptedCents)} the renter accepted.`);
  const part = page.getByTestId("part-capture");
  await expect(part).toContainText(`${whole(acceptedCents)}`, { timeout: 60_000 });
  await part.scrollIntoViewIfNeeded();
  await highlight(page, part, 2400);
  await say(page, `Captured with final_capture false, so the contested ${whole(contestedCents)} stays on the same PayPal hold.`, 3800);
  clock.check("part");

  const chargeCents = Math.min(2_000, contestedCents);
  const [first, ...rest] = (await (await page.request.get(`/api/bookings/${id}`)).json()).proposal.lines as { id: string }[];
  for (const line of rest) await page.getByTestId(`line-amount-${line.id}`).fill("0.00");
  const amount = page.getByTestId(`line-amount-${first.id}`);
  await amount.scrollIntoViewIfNeeded();
  await say(page, `The host reads the renter's note and settles the stain at ${whole(chargeCents)}.`);
  await amount.click({ clickCount: 3 });
  await amount.pressSequentially((chargeCents / 100).toFixed(2), { delay: 80 });
  const reason = page.getByTestId("host-reason");
  if (await reason.isVisible().catch(() => false)) await reason.pressSequentially("Half: most of the stain came out.", { delay: 14 });
  await tap(page, "request-approval");
  await expect(prompt).toBeVisible({ timeout: 30_000 });
  await say(page, "A second capture from the same hold, then PayPal voids the rest.");
  await highlight(page, prompt.getByTestId("approve-button"), 800);
  await prompt.getByTestId("approve-button").click();
  const totalCents = acceptedCents + chargeCents;
  const ruling = page.getByTestId("ruling-headline");
  await expect(ruling).toContainText(`${whole(totalCents)} captured`, { timeout: 60_000 });
  await sleep(500);
  await ruling.scrollIntoViewIfNeeded();
  await highlight(page, ruling, 2200);
  await sleep(1200);
  clock.check("ruling");

  // 6. Every PayPal call, with its status and debug_id.
  const toggle = page.getByTestId("paypal-calls-toggle");
  await toggle.scrollIntoViewIfNeeded();
  await toggle.click();
  const calls = page.getByTestId("paypal-calls");
  await expect(calls).toContainText(/authoriz/i);
  await expect(calls).toContainText(/void/i);
  await say(page, "Every PayPal call on this booking: the authorization, the captures and the void, each with its status and debug_id.");
  // The list is longer than the screen: first the authorization, then the captures and the void.
  const row = (title: string) => calls.locator("li[data-paypal-call]").filter({ hasText: title });
  const authorize = row("Authorize order").first();
  await authorize.evaluate((el) => el.scrollIntoView({ block: "start" }));
  await highlight(page, authorize, 1000);
  await sleep(500);
  const voided = row("Void authorization").last();
  await voided.evaluate((el) => el.scrollIntoView({ block: "end" }));
  await highlight(page, row("Capture authorization").last(), 1100);
  await highlight(page, voided, 1400);
  await sleep(600);
  clock.check("calls");

  // 7. The end card, from the amounts PayPal returned.
  const done = await (await page.request.get(`/api/bookings/${id}`)).json();
  const captured = whole(done.settlement.capturedCents);
  const released = whole(done.settlement.releasedCents);
  await say(page, "Deposit Referee: two photos, a fair charge, and PayPal holds the rest.");
  await titleCard(page, `${captured} captured, ${released} released, read back from PayPal`, "Deposit Referee", 4200);
  clock.check("end");
});

test.afterEach(async ({ page }, info) => {
  const video = page.video();
  await page.close();
  if (video) {
    const name = `videos/demo-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.webm`;
    await video.saveAs(name);
    console.log(`[demo] saved ${name} (${info.duration / 1000 | 0}s)`);
  }
});
