/**
 * DEMO VIDEO TEMPLATE (npm run demo:record). Drives a scripted flow, captions each step, and
 * saves a .webm to videos/. Replace the scenes with your app's story; keep it under ~2:50.
 */
import { expect, test } from "@playwright/test";
import { caption, DemoClock, highlight, titleCard } from "./captions";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("demo", async ({ page, request }) => {
  const clock = new DemoClock(170);
  await request.post("/api/dev/reset");

  // Scene 1: the pitch
  await page.goto("/");
  await titleCard(page, "PayPal Agent Kit", "AI agents that move money safely, with a human in the loop");
  await caption(page, "Merchants lose hours settling partial shipments by hand.");
  await page.mouse.wheel(0, 700);
  await caption(page, "This agent does it with PayPal: every step is visible, capped and auditable.");
  clock.check("pitch");

  // Scene 2: buyer approves a hold
  await page.goto("/example");
  await caption(page, "A customer orders three items for $120 and pays with PayPal.", { wait: false });
  // Sandbox (PAYPAL_MODE=sandbox) pays with PayPal's test card; the real button needs a buyer login.
  const sandbox = (await (await request.get("/api/kit/status")).json()).paypal.mode === "sandbox";
  const pay = page.getByTestId(sandbox ? "sandbox-test-card" : "simulate-paypal-approval");
  await pay.waitFor();
  await highlight(page, pay);
  await pay.click();
  if (!sandbox) {
    await sleep(900);
    await page.getByTestId("mock-approve").click();
  }
  await expect(page.getByTestId("authorization-panel")).toContainText("Created");
  await caption(page, "PayPal authorizes a $120 hold. Nothing is charged yet.");
  clock.check("authorized");

  // Scene 3: the agent settles it
  await caption(page, "Only two items ship. We ask the settlement agent to handle it.", { wait: false });
  await highlight(page, page.getByTestId("run-agent"));
  await page.getByTestId("run-agent").click();
  const prompt = page.getByTestId("approval-prompt");
  await expect(prompt).toBeVisible({ timeout: 90_000 });
  await caption(page, "It wants to capture $80. That is above our $50 limit, so it waits for a human.");
  await highlight(page, prompt.getByTestId("approve-button"));
  await prompt.getByTestId("approve-button").click();
  await expect(page.getByTestId("authorization-panel")).toContainText("Voided", { timeout: 90_000 });
  await caption(page, "Approved: $80 captured, and the remaining $40 hold released to the buyer.");
  clock.check("settled");

  // Scene 4: proof
  await page.getByText("PayPal ledger").scrollIntoViewIfNeeded();
  await caption(page, "Every PayPal call, webhook and decision is recorded.");
  await page.goto("/activity");
  await caption(page, "The audit log is hash-chained, so any edit is detectable.");
  await titleCard(page, "PayPal Agent Kit", "Built with PayPal Orders, Payments and Agent Toolkit + Claude", 2800);
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
