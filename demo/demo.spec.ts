/**
 * The demo video (npm run demo:record): two photos and an argument, a PayPal hold, Claude boxing
 * the scratch, the renter contesting on their phone, the host lowering the charge with a reason,
 * one over-limit refusal, and the money moving. Saves a .webm to videos/.
 */
import { expect, test, type Page } from "@playwright/test";
import { caption, closePhone, DemoClock, highlight, openPhone, zoomOn } from "./captions";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const whole = (cents: number) => `$${(cents / 100).toFixed(cents % 100 ? 2 : 0)}`;

async function tap(page: Page, testId: string) {
  const target = page.getByTestId(testId).first();
  await target.scrollIntoViewIfNeeded();
  await highlight(page, target, 900);
  await target.click();
}

test("demo", async ({ page, request }) => {
  const clock = new DemoClock(170);
  // Mock mode starts clean and seeds here. On the sandbox the config has already seeded.
  await request.post("/api/dev/reset");
  await request.post("/api/dev/seed");
  const status = await (await request.get("/api/kit/status")).json();
  const sandbox = status.paypal.mode === "sandbox";

  // Open: the two photos and the argument.
  await page.goto("/");
  await expect(page.getByTestId("deposit-preview")).toBeVisible();
  await caption(page, "A cabin rented out directly. No platform, no AirCover. A guest checks out, and there's a new scratch.");
  await highlight(page, page.getByTestId("deposit-preview").locator("figure").nth(1), 2200);
  await caption(page, "The guest says it was already there. Here the $300 stays on a PayPal hold, and only what the host approves is captured.");
  clock.check("open");

  // The hold.
  await page.goto("/bookings");
  await caption(page, "The host books the stay and asks for a $300 deposit.", { wait: false });
  await page.getByLabel("What's being rented").pressSequentially("Cedar cabin, weekend of Oct 31", { delay: 18 });
  await page.getByLabel("Renter").pressSequentially("Alex Rivera", { delay: 25 });
  await tap(page, "create-booking");
  await page.waitForURL(/\/bookings\/bk_/);
  const id = new URL(page.url()).pathname.split("/").pop()!;
  await caption(page, `The guest approves a PayPal hold${sandbox ? " on the sandbox" : ""}. The money is held, not taken.`, { wait: false });
  await tap(page, sandbox ? "sandbox-test-card" : "simulate-paypal-approval");
  if (!sandbox) {
    await sleep(700);
    await page.getByTestId("mock-approve").click();
  }
  const hold = page.getByTestId("hold-panel");
  await expect(hold).toContainText("$300 on hold. Nothing has been charged.", { timeout: 30_000 });
  await highlight(page, hold, 2000);
  await caption(page, "Guaranteed by PayPal for 3 days, capturable until day 29. Nothing has been charged.", { ms: 3600 });
  clock.check("hold");

  // Claude draws the box.
  await caption(page, "After the stay, the host adds the check-in and check-out photos.", { wait: false });
  await tap(page, "demo-photo-check_in");
  await expect(page.getByTestId("demo-photo-check_out")).toBeEnabled();
  await tap(page, "demo-photo-check_out");
  await expect(page.getByTestId("photo-source")).toHaveCount(2);
  await tap(page, "run-review");
  await caption(page, status.ai.mode === "live" ? "Claude Sonnet 5.5 compares the two photos. Nobody has to describe the damage." : "AI compares the two photos. Nobody has to describe the damage.", { ms: 9000, wait: false });
  await expect(page.getByTestId("review")).toBeVisible({ timeout: 90_000 });
  const box = page.getByTestId("damage-box").first();
  await caption(page, "It draws a box on the new scratch.", { ms: 4200, wait: false });
  await zoomOn(page, box, { scale: 2.6, ms: 3400 });
  await page.getByTestId("review-engine").scrollIntoViewIfNeeded();
  await highlight(page, page.getByTestId("review-engine"), 1600);
  const proposal = page.getByTestId("ai-proposal");
  await expect(proposal).toBeVisible({ timeout: 90_000 });
  // The README picture: both photos and the AI's finding, with the caption band left out.
  await page.screenshot({ path: "docs/screenshot.png", style: "#__demo_caption { display: none !important; } body { padding-bottom: 0 !important; }" });
  const view = await (await request.get(`/api/bookings/${id}`)).json();
  const aiCents: number = view.proposal.aiCents;
  await proposal.scrollIntoViewIfNeeded();
  await highlight(page, proposal, 1800);
  await caption(page, `The agent proposes charging ${whole(aiCents)}, then stops. It has no tool that can move money.`);
  clock.check("proposal");

  // The renter, on their phone.
  const phone = await openPhone(page, `/renter/${view.renterToken}`);
  await expect(phone.getByTestId("renter-headline")).toBeVisible({ timeout: 20_000 });
  await caption(page, "The guest gets a link with the same photos and reasons.", { ms: 3200 });
  const note = phone.getByTestId("contest-note");
  await note.scrollIntoViewIfNeeded();
  await caption(page, `They think ${whole(aiCents)} is too much, so they contest. That stops the charge.`, { wait: false });
  await note.pressSequentially("The scratch is real, but it's one board. That's too much.", { delay: 14 });
  await phone.getByTestId("contest").click();
  await expect(phone.getByTestId("renter-contested")).toBeVisible();
  await sleep(1800);
  await closePhone(page);
  clock.check("contest");

  // The host lowers the charge, with a reason.
  await expect(page.getByTestId("renter-note")).toBeVisible({ timeout: 10_000 });
  await page.getByTestId("renter-note").scrollIntoViewIfNeeded();
  await highlight(page, page.getByTestId("renter-note"), 1600);
  await caption(page, "The host reads the note. After a contest the charge can only stay the same or go down.", { ms: 3800 });
  const [first, ...rest] = view.proposal.lines as { id: string }[];
  for (const line of rest) await page.getByTestId(`line-amount-${line.id}`).fill("0.00");
  const amount = page.getByTestId(`line-amount-${first.id}`);
  await amount.scrollIntoViewIfNeeded();
  await caption(page, `They lower ${whole(aiCents)} to $90, and say why.`, { wait: false });
  await amount.click({ clickCount: 3 });
  await amount.pressSequentially("90.00", { delay: 90 });
  await page.getByTestId("host-reason").pressSequentially("Only one board needs sanding and refinishing.", { delay: 16 });
  await expect(page.getByTestId("charge-preview")).toContainText("Charge exactly $90.00 and release $210.00");
  clock.check("lowered");

  // One over-limit refusal.
  await page.getByTestId("for-judges").locator("summary").click();
  await caption(page, "What if an agent tries to take $300.01?", { wait: false });
  await tap(page, "limit-test");
  await expect(page.getByText("Refused: $300.01 is more than the hold")).toBeVisible({ timeout: 20_000 });
  await caption(page, "Refused by the app's code, before PayPal. No money moved.", { ms: 2600 });
  clock.check("limit");

  // The money moves, only after the host approves.
  await tap(page, "request-approval");
  const prompt = page.getByTestId("approval-prompt");
  await expect(prompt).toBeVisible({ timeout: 30_000 });
  await caption(page, "Nothing moves until the host approves this exact amount.", { ms: 2600 });
  await highlight(page, prompt.getByTestId("approve-button"), 800);
  await prompt.getByTestId("approve-button").click();
  const ruling = page.getByTestId("ruling-headline");
  await expect(ruling).toContainText("$90 captured", { timeout: 60_000 });
  await expect(ruling).toContainText("$210 released");
  await caption(page, `$90 captured, $210 released, re-read from PayPal${sandbox ? "'s sandbox" : ""}.`, { ms: 4200 });
  clock.check("ruling");

  // Close: the host's record.
  await page.goto("/insights");
  const row = page.getByRole("row").filter({ hasText: "Cedar cabin" }).last();
  await expect(row).toBeVisible({ timeout: 30_000 });
  await caption(page, `Every deposit in one place: what the AI said, what the host charged.`, { wait: false });
  await highlight(page, row, 2600);
  await sleep(2600);
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
