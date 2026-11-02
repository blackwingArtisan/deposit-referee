/**
 * The demo video (npm run demo:record): a deposit from hold to ruling, with a contest, a host
 * who changes the AI's number, and the code refusing an over-limit charge. Saves a .webm to videos/.
 */
import { expect, test, type Page } from "@playwright/test";
import { caption, DemoClock, highlight, titleCard } from "./captions";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
  const sandbox = (await (await request.get("/api/kit/status")).json()).paypal.mode === "sandbox";

  // Scene 1: the problem
  await page.goto("/");
  await titleCard(page, "Deposit Referee", "Damage deposits, settled from two photos");
  await caption(page, "When a rental comes back damaged, the host and the renter argue over the deposit.");
  await caption(page, "Here the money sits on a PayPal hold, and nothing moves until the host approves.");
  clock.check("pitch");

  // Scene 2: the renter places the deposit
  await page.goto("/bookings");
  await caption(page, "A host rents out a cabin and asks for a $300 deposit.", { wait: false });
  await page.getByLabel("What's being rented").pressSequentially("Cedar cabin, weekend of Nov 13", { delay: 25 });
  await page.getByLabel("Renter").pressSequentially("Alex Rivera", { delay: 35 });
  await tap(page, "create-booking");
  await page.waitForURL(/\/bookings\/bk_/);
  const id = new URL(page.url()).pathname.split("/").pop()!;
  await caption(page, "The renter approves a PayPal hold. The money is held, not taken.", { wait: false });
  await tap(page, sandbox ? "sandbox-test-card" : "simulate-paypal-approval");
  if (!sandbox) {
    await sleep(900);
    await page.getByTestId("mock-approve").click();
  }
  await expect(page.getByTestId("hold-panel")).toContainText("$300 on hold. Nothing has been charged.", { timeout: 30_000 });
  await caption(page, `${sandbox ? "This is a real hold on the PayPal sandbox." : "PayPal holds the money for up to 29 days."} Nothing has been charged.`);
  clock.check("hold");

  // Scene 3: the AI compares the photos and proposes
  await caption(page, "At check-out the host adds both photos.", { wait: false });
  await tap(page, "demo-photo-check_in");
  await expect(page.getByTestId("demo-photo-check_out")).toBeEnabled();
  await tap(page, "demo-photo-check_out");
  await expect(page.getByTestId("photo-source")).toHaveCount(2);
  await caption(page, "AI compares them, and the host never has to describe the damage.", { wait: false });
  await tap(page, "run-review");
  await expect(page.getByTestId("review")).toBeVisible({ timeout: 90_000 });
  await page.getByTestId("damage-box").first().evaluate((box) => box.scrollIntoView({ block: "center" }));
  await caption(page, "It boxes the new scratch in the check-out photo and gives its reasons.");
  const proposal = page.getByTestId("ai-proposal");
  await expect(proposal).toBeVisible({ timeout: 90_000 });
  // The README picture: both photos and the timeline, with the caption left out.
  await page.screenshot({ path: "docs/screenshot.png", style: "#__demo_caption { display: none !important; }" });
  await proposal.scrollIntoViewIfNeeded();
  await caption(page, "The settlement agent proposes charging $150, then stops. It has no tool that can move money.");
  clock.check("proposal");

  // Scene 4: code holds the limit, whatever is asked
  await caption(page, "What if an agent asks for too much? This test tries three ways.", { wait: false });
  await tap(page, "limit-test");
  await expect(page.getByText("Every attempt was refused")).toBeVisible({ timeout: 30_000 });
  await caption(page, "All three are refused by the app's code, not by a prompt. No money moved.");
  clock.check("limit");

  // Scene 5: the renter contests from their own page
  const { renterToken } = await (await request.get(`/api/bookings/${id}`)).json();
  await page.goto(`/renter/${renterToken}`);
  await caption(page, "The renter gets their own link, with the same photos and reasons.");
  await page.getByTestId("contest-note").scrollIntoViewIfNeeded();
  await caption(page, "They think $150 is too much, so they contest it. That stops the charge.", { wait: false });
  await page.getByTestId("contest-note").pressSequentially("The scratch is real, but it's only one board. $150 is too much.", { delay: 18 });
  await tap(page, "contest");
  await expect(page.getByTestId("renter-contested")).toBeVisible();
  clock.check("contest");

  // Scene 6: the host decides, and only then does money move
  await page.goto(`/bookings/${id}`);
  await page.getByTestId("renter-note").scrollIntoViewIfNeeded();
  await caption(page, "The host sees the note. After a contest, a charge can only stay the same or go down.");
  const amount = page.getByTestId("line-amount-ai-0");
  await amount.scrollIntoViewIfNeeded();
  await amount.fill("90.00");
  await caption(page, "They lower it to $90.", { ms: 1800 });
  await tap(page, "request-approval");
  const prompt = page.getByTestId("approval-prompt");
  await expect(prompt).toBeVisible({ timeout: 30_000 });
  await caption(page, "Even now, nothing moves until the host approves this exact amount.");
  await highlight(page, prompt.getByTestId("approve-button"), 900);
  await prompt.getByTestId("approve-button").click();
  const ruling = page.getByTestId("ruling-headline");
  await expect(ruling).toContainText("$90 captured", { timeout: 60_000 });
  await expect(ruling).toContainText("$210 released");
  await caption(page, "$90 captured and $210 released. These numbers are re-read from PayPal after the money moves.");
  clock.check("ruling");

  // Scene 7: the record
  await page.goto("/insights");
  await expect(page.getByTestId("plain-dashboard").or(page.getByTestId("studio-host"))).toBeVisible({ timeout: 30_000 });
  await caption(page, "The dashboard shows what's held, charged and released, and where the host changed the AI's number.");
  await page.goto("/activity");
  await caption(page, "Every step goes into an audit log that shows if anything was changed.");
  await titleCard(page, "Deposit Referee", "Built with PayPal Orders, Payments and Agent Toolkit, and Claude", 2800);
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
