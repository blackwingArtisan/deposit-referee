/**
 * The whole deposit story in a real browser. `npm run test:e2e` runs it on mock PayPal;
 * `npm run test:e2e:sandbox` runs it on the real PayPal sandbox and then re-reads the objects
 * straight from PayPal. In sandbox the deposit is paid with PayPal's test card (DEMO_TEST_CARD=1)
 * because the wallet button needs a buyer login. AI is mocked unless E2E_AI_MODE=live.
 */
import fs from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { dollars, expectCallsSurviveReload, expectMoneyStrip, expectNoSidewaysScroll, headline, kitStatus, openAsRenter, openDemoTools, renterAccepts, renterContests, setCharge, toPhotos, toProposal, unfold, type Flow } from "./booking-flow";
import { readPayPalObjects, tryCapture } from "./paypal-reread";
import { priceOf } from "../../src/lib/deposit/prices";
import { photoDateLabel } from "../../src/lib/deposit/second-look-rules";
import type { ChargeLine } from "../../src/lib/deposit/types";

const DEPOSIT_CENTS = 30_000;

/** The stain line, by its price-table row (or its words): live AI lists the two marks in either order. */
const isStain = (line: ChargeLine) => (line.price ? line.price.type === "stain" : /stain/i.test(line.description));

/** Holds at the approval card, then proves no capture was asked of PayPal before the click. */
async function expectNoCaptureBeforeApproval(page: Page, flow: Flow) {
  await page.waitForTimeout(4_000);
  const booking = await flow.booking();
  expect(booking.status).toBe("awaiting_approval");
  expect(booking.settlement?.captureId).toBeUndefined();
  const { events } = (await (await page.request.get(`/api/bookings/${booking.id}/activity`)).json()) as { events: { paypal?: { operation: string; path: string } }[] };
  const calls = events.flatMap((e) => (e.paypal ? [e.paypal] : []));
  expect(calls.length).toBeGreaterThan(0);
  expect(calls.filter((c) => /capture|void/i.test(`${c.operation} ${c.path}`))).toEqual([]);
  await expectHoldUntouched(flow);
}

async function expectHoldUntouched(flow: Flow) {
  const { orderId, authorizationId } = await flow.booking();
  if (!flow.sandbox) return;
  const { authorization, order } = await readPayPalObjects(orderId!, authorizationId!);
  expect(authorization.status).toBe("CREATED");
  expect(order.purchase_units[0].payments.captures ?? []).toEqual([]);
  console.log(`PayPal re-read: authorization ${authorization.id} still ${authorization.status}, nothing captured`);
}

/**
 * Scrolls so the calls toggle is at the top of the screen and the headline just above it, out of
 * view, as on a tall page with real AI text. The padding makes a mock page tall enough to do that.
 */
async function scrollHeadlineAway(page: Page) {
  await page.getByTestId("paypal-calls-toggle").evaluate((el) => {
    document.body.style.paddingBottom = "3000px";
    window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 2);
  });
  await expect(page.getByTestId("ruling-headline")).not.toBeInViewport();
}

/** The host downloads the evidence pack from the screen: a PDF with every capture id on it. */
async function downloadEvidence(page: Page, captureIds: string[]) {
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("evidence-download").click()]);
  const { id } = await (await page.request.get(page.url().replace(/\/bookings\//, "/api/bookings/"))).json();
  expect(download.suggestedFilename()).toBe(`deposit-evidence-${id}.pdf`);
  const pdf = fs.readFileSync((await download.path())!).toString("latin1");
  expect(pdf.startsWith("%PDF-1.4")).toBe(true);
  for (const captureId of captureIds) expect(pdf).toContain(captureId);
  expect(pdf).toContain("Price table:");
  expect(pdf).toMatch(/\/Filter \/DCTDecode/);
  return pdf;
}

async function approveCharge(page: Page, flow: Flow, chargeCents: number, screenshot: string) {
  const releaseCents = DEPOSIT_CENTS - chargeCents;
  await expect(page.getByTestId("charge-preview")).toContainText(`Charge exactly ${dollars(chargeCents)} and release ${dollars(releaseCents)}`);
  await page.getByTestId("request-approval").click();

  // The gate: nothing moves until the host approves.
  const prompt = page.getByTestId("approval-prompt");
  await expect(prompt).toBeVisible({ timeout: 30_000 });
  await expect(prompt).toContainText(`Charge exactly ${dollars(chargeCents)} from the $300.00 hold and release ${dollars(releaseCents)} to the renter`);
  // A full card in the main column: each line with its price row, the renter's answer, the money, and the Guard's reason.
  const lines = (await flow.booking()).proposal!.lines;
  await expect(prompt.getByTestId("approval-line")).toHaveCount(lines.length);
  for (const [i, line] of lines.entries()) {
    const row = prompt.getByTestId("approval-line").nth(i);
    await expect(row).toContainText(line.description);
    await expect(row).toContainText(dollars(line.amountCents));
    await expect(row.getByTestId("price-row")).toBeVisible();
  }
  await expect(prompt.getByTestId("approval-renter-answer")).toBeVisible();
  await expect(prompt.getByTestId("approval-money")).toHaveText(`Capture ${dollars(chargeCents)} · release ${dollars(releaseCents)}`);
  await expect(prompt.getByTestId("approval-guard-reason")).not.toBeEmpty();
  expect((await prompt.boundingBox())!.width).toBeGreaterThan(((await page.getByTestId("fold-hold").boundingBox())!.width) * 0.9);
  await expect(page.getByTestId("approve-button")).toHaveCount(1);
  await expect(page.getByTestId("approve-button")).toBeInViewport();
  await expectNoSidewaysScroll(page);
  await expectNoCaptureBeforeApproval(page, flow);
  await page.screenshot({ path: `screenshots/${screenshot}-approval.png`, fullPage: true });
  await page.getByTestId("approve-button").click();

  // The result.
  const ruling = page.getByTestId("ruling");
  await expect(ruling).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("ruling-headline")).toHaveText(`${headline(chargeCents)} captured, ${headline(releaseCents)} released`);
  await expectMoneyStrip(page, flow, [`${headline(chargeCents + releaseCents)} held`, `${headline(chargeCents)} captured`, `${headline(releaseCents)} released`]);
  await expect(ruling.getByTestId("damage-box").first()).toBeVisible();
  // The result opens at its headline, wherever the host clicked Approve.
  await expect(page.getByTestId("ruling-headline")).toBeInViewport();
  // Opening the calls with the headline scrolled away brings it back into view.
  await scrollHeadlineAway(page);
  // The void on the timeline shows what was released, not the whole hold.
  await page.getByTestId("paypal-calls-toggle").click();
  await expect(page.locator('[data-testid="timeline-step"][data-kind="tool"]').filter({ hasText: "void_authorization" })).toContainText(dollars(releaseCents));
  // Each call names its tool: the hold is read with the Agent Toolkit's get_order, and where the
  // Toolkit has no tool (capture from a hold, void) the strip says so plainly.
  const calls = page.getByTestId("paypal-calls");
  await expect(calls.locator('[data-testid="paypal-via"][data-toolkit="get_order"]').first()).toBeAttached();
  const paypalRow = (title: string) => calls.locator('[data-testid="timeline-step"][data-kind="paypal"]').filter({ hasText: title });
  await expect(paypalRow("Capture authorization").getByTestId("paypal-via-gap")).toContainText("has no tool to capture from a hold");
  await expect(paypalRow("Void authorization").getByTestId("paypal-via")).toContainText("Tool · void_authorization");
  await expect(calls.getByTestId("paypal-via-gap").filter({ hasText: "has no tool to void a hold" }).first()).toBeVisible();
  await expect(ruling.locator("img").nth(1)).toHaveJSProperty("complete", true);
  await expect(page.getByTestId("ruling-headline")).toBeInViewport();
  await expectNoSidewaysScroll(page);
  await expect(page.getByText("Approved", { exact: true })).toBeHidden({ timeout: 15_000 }); // the toast covers the PayPal ids
  await page.screenshot({ path: `screenshots/${screenshot}-${flow.mode}-${flow.live ? "live-ai" : "mock-ai"}.png`, fullPage: true });

  const done = await flow.booking();
  expect(done.status).toBe("settled");
  // Order, hold, capture and release are all still listed after a reload, and in a fresh browser.
  expect(await expectCallsSurviveReload(page, 4)).toBeGreaterThanOrEqual(4);
  expect(done.settlement).toMatchObject({ capturedCents: chargeCents, releasedCents: releaseCents });

  if (flow.sandbox) {
    // Straight from PayPal, not through the app.
    const { order, authorization, capture } = await readPayPalObjects(done.orderId!, done.authorizationId!, done.settlement!.captureId!);
    expect(order.intent).toBe("AUTHORIZE");
    expect(authorization.status).toBe("VOIDED");
    expect(authorization.amount.value).toBe("300.00");
    expect(capture!.status).toBe("COMPLETED");
    expect(capture!.amount.value).toBe((chargeCents / 100).toFixed(2));
    expect(capture!.final_capture).toBe(false);
    expect(order.purchase_units[0].payments.captures.map((c) => c.id)).toEqual([capture!.id]);
    const further = await tryCapture(done.authorizationId!, "1.00");
    expect(further.status).toBe(422);
    expect(further.issue).toBe("AUTHORIZATION_VOIDED");
    console.log(`PayPal re-read: order ${order.id} ${order.status}; authorization ${authorization.id} ${authorization.status} ${authorization.amount.value}; capture ${capture!.id} ${capture!.status} ${capture!.amount.value}; further $1.00 capture refused: ${further.status} ${further.issue}`);
  }
}

test("the agent proposes and stops, the renter accepts, the host approves", async ({ page, request }) => {
  // Money only moves through the Guard: the kit's open PayPal routes, demo pages and agent route are gone.
  for (const path of ["/example", "/dashboard"]) expect((await page.request.get(path)).status()).toBe(404);
  for (const path of ["/api/paypal/orders", "/api/paypal/captures/X/refund", "/api/paypal/authorizations/X/capture", "/api/paypal/authorizations/X/void", "/api/agent/runs", "/api/ai/summarize"]) {
    expect((await page.request.post(path, { data: {} })).status()).toBe(404);
  }

  const flow = await toProposal(page, request, { item: "Lakeside cabin, weekend of Nov 6", checkCalls: true, payWith: "card-form" });
  await expectCallsSurviveReload(page, 2);
  const reviewed = await flow.booking();
  const { review, proposal } = reviewed;
  expect(review!.mocked).toBe(!flow.live);
  expect(proposal!.simulated).toBe(!flow.live);
  expect(proposal!.kind).toBe("charge");
  expect(review!.items.length).toBeGreaterThan(0);
  await unfold(page, "photos");
  const box = page.getByTestId("damage-box").first();
  await expect(box).toBeVisible();
  const drawn = review!.items[0].box!;
  expect(await box.evaluate((el) => (el as HTMLElement).style.left)).toBe(`${drawn.x * 100}%`);

  // The amount comes from the price table, and the screen says which row.
  // Real AI can find several marks: each is priced from its row, and together they stop at the hold.
  let room = DEPOSIT_CENTS;
  for (const line of proposal!.lines) {
    expect(line.price, "every AI line names its price-table row").toBeTruthy();
    expect(line.amountCents).toBe(Math.min(priceOf(line.price!), room));
    room -= line.amountCents;
  }
  await expect(page.getByTestId("price-row").first()).toContainText("Price table:");
  if (!flow.live) await expect(page.getByTestId("price-row").first()).toContainText("Price table: Scratch or gouge, large, $150");

  // It stopped: no approval is waiting, and the host can't send it until the renter has had their say.
  expect(reviewed.status).toBe("proposed");
  expect(reviewed.approval).toBeNull();
  await expect(page.getByTestId("request-approval")).toBeDisabled();
  await expect(page.getByTestId("renter-status")).toContainText("to accept or contest");
  await expectHoldUntouched(flow);

  // The renter sees the proposal and its evidence, and answers.
  const renter = await renterAccepts(page, reviewed);
  await expect(renter.getByTestId("renter-rationale")).toContainText(proposal!.rationale.slice(0, 30));
  await expect(renter.getByTestId("damage-box").first()).toBeVisible();
  await expect(page.getByTestId("renter-status")).toContainText("accepted", { timeout: 10_000 });
  await expect(page.getByTestId("request-approval")).toBeEnabled();
  await expectCallsSurviveReload(page, 2);

  // A real AI total can reach the whole hold, so the host picks a charge that leaves something to release.
  const ai = proposal!.aiCents;
  const capped = ai >= DEPOSIT_CENTS;
  if (capped) await setCharge(page, reviewed, "150.00");
  await approveCharge(page, flow, capped ? 15_000 : ai, "deposit-result");

  // On a phone too, opening the PayPal calls keeps the result in view.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await scrollHeadlineAway(page);
  await page.getByTestId("paypal-calls-toggle").click();
  await expect(page.getByTestId("timeline-step").first()).toBeVisible();
  await expect(page.getByTestId("ruling-headline")).toBeInViewport();
  await expectNoSidewaysScroll(page);
  await page.setViewportSize({ width: 1440, height: 1000 });

  const done = await flow.booking();
  // The evidence pack, ready before any dispute: the photos, price rows, the renter's answer and PayPal's ids.
  await expect(page.getByTestId("evidence-panel")).toBeVisible();
  const pdf = await downloadEvidence(page, [done.settlement!.captureId!]);
  expect(pdf).toContain(done.authorizationId!);
  expect(pdf).toContain("accepted it");
  await expect(renter.getByTestId("renter-headline")).toContainText("released", { timeout: 10_000 });
  const audit = await (await request.get("/api/audit")).json();
  expect(audit.integrity.ok).toBe(true);
  const entries = audit.entries as { tool?: string; action: string; actor: string; runId?: string }[];
  const actions = entries.filter((e) => e.tool === "capture_deposit" && e.runId === done.settlement!.runId).map((e) => e.action);
  expect(actions).toEqual(expect.arrayContaining(["approval.requested", "approval.approved", "tool.executed"]));
  console.log(`AI: mocked=${review!.mocked} model=${review!.model ?? "none"} vision cost=$${review!.costUsd.toFixed(4)} box=${JSON.stringify(drawn)} proposal=${proposal!.engine} ${proposal!.kind} ${ai}`);
  await renter.context().close();
});

test("closing PayPal before approving says so, and nothing is held", async ({ page, request }) => {
  test.skip((await (await request.get("/api/kit/status")).json()).paypal.mode !== "mock", "PayPal's own window is closed by the renter, not the test");
  await page.goto("/bookings");
  await page.getByLabel("What's being rented").fill("Harbor loft, weekend of Nov 27");
  await page.getByLabel("Renter").fill("Test Renter");
  await page.getByLabel("Deposit").fill("300.00");
  await page.getByTestId("create-booking").click();
  await page.waitForURL(/\/bookings\/bk_/);
  const id = new URL(page.url()).pathname.split("/").pop()!;
  const renter = await openAsRenter(page, await (await page.request.get(`/api/bookings/${id}`)).json());
  await renter.getByTestId("simulate-paypal-approval").click();
  await renter.getByRole("button", { name: "Cancel" }).click();
  await expect(renter.getByText("PayPal was closed before the hold was approved")).toBeVisible();
  await expect(renter.getByText("Nothing is held and nothing was charged.")).toBeVisible();
  await expect(renter.getByTestId("renter-headline")).toHaveText("Place your $300 deposit hold");
  await renter.context().close();
  await expect(page.getByTestId("waiting-headline")).toHaveText(/Waiting for the renter.s hold/);
  expect((await (await page.request.get(`/api/bookings/${id}`)).json()).status).toBe("draft");
});

test("the host changes the AI's number on an uploaded photo", async ({ page, request }) => {
  test.skip((await (await request.get("/api/kit/status")).json()).ai.mode === "live", "Keeps a live run cheap");
  const flow = await toProposal(page, request, { checkOut: "upload", item: "Harbor loft, weekend of Nov 13" });
  const booking = await flow.booking();
  const renter = await renterAccepts(page, booking);
  await expect(page.getByTestId("request-approval")).toBeEnabled({ timeout: 10_000 });

  // Going up needs the renter again.
  await setCharge(page, booking, "200.00");
  await expect(page.getByTestId("request-approval")).toHaveCount(0);
  await page.getByTestId("save-lines").click();
  await expect(page.getByTestId("request-approval")).toBeDisabled({ timeout: 10_000 });
  await renter.reload();
  await renter.getByTestId("accept").click();
  await expect(renter.getByTestId("renter-accepted")).toBeVisible();
  await expect(page.getByTestId("request-approval")).toBeEnabled({ timeout: 10_000 });

  // Going down doesn't.
  await page.getByTestId("line-amount-ai-0").fill("35.00");
  await approveCharge(page, flow, 3_500, "deposit-host-charge");
  await expect(page.getByTestId("ruling")).toContainText("What was charged");
  await renter.context().close();
});

test("the host declines: no money moves and the booking stays open for a new decision", async ({ page, request }) => {
  test.skip((await (await request.get("/api/kit/status")).json()).ai.mode === "live", "Keeps a live run cheap");
  const flow = await toProposal(page, request, { item: "Harbor loft, weekend of Nov 20" });
  const booking = await flow.booking();
  const renter = await renterAccepts(page, booking);
  await expect(page.getByTestId("request-approval")).toBeEnabled({ timeout: 10_000 });

  await page.getByTestId("request-approval").click();
  await expect(page.getByTestId("approval-prompt")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("approval-prompt").getByRole("button", { name: "Decline" }).click();

  await expect(page.getByText("You declined this. No money moved")).toBeVisible({ timeout: 15_000 });
  expect((await flow.booking()).status).toBe("proposed");
  await expectHoldUntouched(flow);

  // A new decision: a smaller charge goes through.
  await page.getByTestId("line-amount-ai-0").fill("60.00");
  await approveCharge(page, flow, 6_000, "deposit-after-decline");
  await renter.context().close();
});

test("the renter contests before the capture and it comes back to the host", async ({ page, request }) => {
  test.skip((await (await request.get("/api/kit/status")).json()).ai.mode === "live", "Keeps a live run cheap");
  const flow = await toProposal(page, request, { item: "Hilltop cottage, weekend of Nov 6" });
  const booking = await flow.booking();
  const renter = await openAsRenter(page, booking);
  await expect(renter.getByTestId("renter-headline")).toContainText("Proposed charge");
  await renterContests(renter, "That scratch was there when I arrived.");

  await expect(page.getByTestId("renter-note")).toContainText("That scratch was there when I arrived.", { timeout: 10_000 });
  expect((await flow.booking()).status).toBe("contested");
  await expectHoldUntouched(flow);
  await expectCallsSurviveReload(page, 2);

  // The charge can't go up now. The host hears the renter out and lowers it.
  await page.getByTestId("line-amount-ai-0").fill("400.00");
  await expect(page.getByTestId("charge-preview")).toContainText("more than the $300.00 hold");
  await page.getByTestId("line-amount-ai-0").fill("40.00");
  await approveCharge(page, flow, 4_000, "deposit-contested");
  await expect(renter.getByTestId("renter-headline")).toContainText("$40 charged", { timeout: 10_000 });
  await renter.context().close();
});

test("a contest while approval is waiting stops the capture", async ({ page, request }) => {
  test.skip((await (await request.get("/api/kit/status")).json()).ai.mode === "live", "Keeps a live run cheap");
  const flow = await toProposal(page, request, { item: "Hilltop cottage, weekend of Nov 13" });
  const booking = await flow.booking();
  const renter = await renterAccepts(page, booking);
  await expect(page.getByTestId("request-approval")).toBeEnabled({ timeout: 10_000 });
  await page.getByTestId("request-approval").click();
  await expect(page.getByTestId("approval-prompt")).toBeVisible({ timeout: 30_000 });

  await renter.reload();
  await renterContests(renter, "Changed my mind after seeing the photo.");

  await expect(page.getByTestId("approval-prompt")).toHaveCount(0, { timeout: 15_000 });
  await expect(page.getByTestId("renter-note")).toContainText("Changed my mind");
  await expect(page.getByText("The renter contested before the capture")).toBeVisible();
  expect((await flow.booking()).status).toBe("contested");
  await expectHoldUntouched(flow);
  await renter.context().close();
});

test("no damage: the agent proposes a full release and the hold is voided", async ({ page, request }) => {
  const flow = await toProposal(page, request, { checkOut: "clean", item: "Lakeside cabin, weekend of Nov 13" });
  const reviewed = await flow.booking();
  expect(reviewed.review!.newDamage).toBe(false);
  expect(reviewed.proposal).toMatchObject({ kind: "release", aiCents: 0, lines: [] });
  await expect(page.getByTestId("ai-proposal")).toContainText("releasing the whole $300.00");

  await page.getByTestId("request-release").click();
  const prompt = page.getByTestId("approval-prompt");
  await expect(prompt).toBeVisible({ timeout: 30_000 });
  await expect(prompt).toContainText("Release the whole $300.00");
  await expect(prompt.getByTestId("approval-money")).toHaveText("Capture $0.00 · release $300.00");
  await expect(prompt.getByTestId("approval-renter-answer")).toContainText("doesn’t need to answer");
  await expectHoldUntouched(flow);
  await page.getByTestId("approve-button").click();

  await expect(page.getByTestId("ruling-headline")).toHaveText("$0 captured, $300 released", { timeout: 60_000 });
  await expectMoneyStrip(page, flow, ["$300 held", "$0 captured", "$300 released"]);
  const done = await flow.booking();
  expect(done.settlement).toMatchObject({ kind: "release", capturedCents: 0, releasedCents: 30_000, authorizationStatus: "VOIDED" });
  await page.screenshot({ path: `screenshots/deposit-release-${flow.mode}-${flow.live ? "live-ai" : "mock-ai"}.png`, fullPage: true });
  // Nothing was charged, so there is no evidence pack to offer.
  await expect(page.getByTestId("evidence-panel")).toHaveCount(0);
  expect((await page.request.get(`/api/bookings/${flow.id}/evidence`)).status()).toBe(409);

  if (flow.sandbox) {
    const { order, authorization } = await readPayPalObjects(done.orderId!, done.authorizationId!);
    expect(authorization.status).toBe("VOIDED");
    expect(authorization.amount.value).toBe("300.00");
    expect(order.purchase_units[0].payments.captures ?? []).toEqual([]);
    const further = await tryCapture(done.authorizationId!, "1.00");
    expect(further.status).toBe(422);
    expect(further.issue).toBe("AUTHORIZATION_VOIDED");
    console.log(`PayPal re-read: order ${order.id} ${order.status}; authorization ${authorization.id} ${authorization.status} ${authorization.amount.value}; nothing captured; further $1.00 capture refused: ${further.status} ${further.issue}`);
  }
  console.log(`AI: mocked=${done.review!.mocked} vision cost=$${done.review!.costUsd.toFixed(4)} proposal=${done.proposal!.engine}`);
});

test("worth a look: the host adds a mark the AI wouldn't charge, and it goes through the renter and approval", async ({ page, request }) => {
  const flow = await toProposal(page, request, { checkOut: "faint", item: "Lakeside cabin, weekend of Nov 20" });
  const reviewed = await flow.booking();
  const look = reviewed.review!.worthALook![0];
  expect(look, "the AI should have flagged the faint mark").toBeTruthy();

  // Shown to the host with its box, and nothing is charged for it.
  expect(reviewed.proposal).toMatchObject({ kind: "release", aiCents: 0, lines: [] });
  await expect(page.getByTestId("ai-proposal")).toContainText("releasing the whole $300.00");
  await expect(page.getByTestId("worth-a-look")).toContainText("Nothing here is charged unless you add it");
  await expect(page.getByTestId("look-box")).toHaveCount(1);
  await expect(page.getByTestId("damage-box")).toHaveCount(0);
  // A faint mark is never charged, and if the host adds it, the price still comes from the table.
  expect(reviewed.review!.items).toEqual([]);
  expect(look.chargeCents).toBe(priceOf(look.price!));
  await expect(page.getByTestId("worth-a-look").getByTestId("price-row")).toContainText("Price table:");
  await expectNoSidewaysScroll(page);
  await page.screenshot({ path: `screenshots/deposit-worth-a-look-${flow.live ? "live-ai" : "mock-ai"}.png`, fullPage: true });
  await expectHoldUntouched(flow);

  // One tap puts it on the charge, with its box, and nothing moves yet.
  await page.getByTestId("look-add-0").click();
  await expect(page.getByTestId("look-0")).toContainText("On the charge");
  await expect(page.getByTestId("line-amount-look-0")).toHaveValue((look.chargeCents / 100).toFixed(2));
  await expect(page.getByTestId("request-approval")).toBeDisabled();
  const added = await flow.booking();
  expect(added.proposal!.lines[0]).toMatchObject({ id: "look-0", box: look.box, amountCents: look.chargeCents });
  expect(added.proposal!.lines[0].aiCents).toBeUndefined();
  await expectHoldUntouched(flow);

  // The renter sees it, with its box, and has to answer first.
  const renter = await renterAccepts(page, added);
  await expect(renter.getByTestId("renter-headline")).toContainText(`Proposed charge: ${dollars(look.chargeCents)}`);
  // One card for the one item, with its box; the full photos wait under the details fold.
  await expect(renter.getByTestId("renter-lines").getByTestId("damage-box")).toHaveCount(1);
  await expect(renter.getByTestId("damage-items")).toContainText("The host added it");
  await expect(page.getByTestId("request-approval")).toBeEnabled({ timeout: 10_000 });

  // Then the same approval gate as any other charge.
  await approveCharge(page, flow, look.chargeCents, "deposit-worth-a-look-charged");
  await expect(page.getByTestId("ruling")).toContainText("What was charged");
  await renter.context().close();
});

test("a script that asks for too much is refused by code", async ({ page, request }) => {
  test.skip((await (await request.get("/api/kit/status")).json()).ai.mode === "live", "Keeps a live run cheap");
  const flow = await toProposal(page, request, { item: "Harbor loft, weekend of Nov 27" });
  const before = await flow.booking();

  await openDemoTools(page);
  await page.getByTestId("limit-test").click();
  await expect(page.getByText("Refused: $300.01 is more than the hold")).toBeVisible({ timeout: 20_000 });

  const after = await flow.booking();
  expect(after.status).toBe("proposed");
  expect(after.proposal!.aiCents).toBe(before.proposal!.aiCents);
  await expectHoldUntouched(flow);

  const audit = await (await request.get("/api/audit")).json();
  const log = (audit.entries as { seq: number; actor: string; action: string; tool?: string }[])
    .filter((e) => e.actor === "agent:limit-test")
    .sort((a, b) => a.seq - b.seq)
    .slice(-2);
  expect(log.filter((e) => e.action === "tool.failed").map((e) => e.tool)).toEqual(["capture_deposit"]);
  expect(log.filter((e) => e.action === "tool.executed")).toEqual([]);
  await page.screenshot({ path: `screenshots/deposit-limit-test-${flow.mode}.png`, fullPage: true });
});

test("split: the renter accepts one item and contests the other; the accepted part is charged now, the rest later", async ({ page, request }) => {
  const flow = await toProposal(page, request, { checkOut: "two", item: "Lakeside cabin, weekend of Nov 27" });
  const reviewed = await flow.booking();
  const lines = reviewed.proposal!.lines;
  // By what each line is, not where it is listed: the renter contests the stain, as their note says.
  const contestedLines = lines.filter(isStain);
  const accepted = lines.find((line) => !isStain(line))!;
  test.skip(!contestedLines.length || !accepted || lines.length !== contestedLines.length + 1, `The review found ${lines.map((l) => l.price?.type ?? "unpriced").join(", ") || "nothing"} on the two-marks photo, not the stain and one other mark, so there is nothing to split`);
  const acceptedCents = accepted.amountCents;
  const contestedCents = contestedLines.reduce((sum, line) => sum + line.amountCents, 0);

  // The renter unticks the item they agree with and contests the rest.
  const renter = await openAsRenter(page, reviewed);
  await renter.getByTestId(`line-accept-${accepted.id}`).click();
  for (const line of contestedLines) await renter.getByTestId(`line-contest-${line.id}`).click();
  await renter.getByTestId("contest-note").fill("The stain was there when I arrived.");
  await expect(renter.getByTestId("contest")).toHaveText(`Contest ${contestedLines.length} of ${lines.length} items`);
  await renter.getByTestId("contest").click();
  await expect(renter.getByTestId("renter-contested")).toContainText(`You accepted ${dollars(acceptedCents)} and contested ${dollars(contestedCents)}`);

  // The accepted part goes straight to the approval gate, on its own.
  const prompt = page.getByTestId("approval-prompt");
  await expect(prompt).toBeVisible({ timeout: 30_000 });
  await expect(prompt).toContainText(`Charge exactly ${dollars(acceptedCents)} now for the items the renter accepted. The ${dollars(contestedCents)} they contested stays on the $300.00 hold until you settle it`);
  await expect(prompt.getByTestId("approval-line")).toHaveCount(1);
  await expect(prompt.getByTestId("approval-line-answer")).toHaveText(["Renter accepts"]);
  await expect(prompt.getByTestId("approval-money")).toHaveText(`Capture ${dollars(acceptedCents)} · keep ${dollars(30_000 - acceptedCents)} on hold`);
  await expectHoldUntouched(flow);
  await page.getByTestId("approve-button").click();
  await expect(page.getByTestId("part-capture")).toContainText(`${dollars(acceptedCents)} charged now`, { timeout: 60_000 });
  await expect(renter.getByTestId("renter-part-charged")).toContainText(dollars(acceptedCents), { timeout: 15_000 });
  const part = (await flow.booking()).partCapture!;
  expect(part).toMatchObject({ capturedCents: acceptedCents, finalCapture: false });
  await expect(page.getByTestId("part-capture-id")).toHaveText(part.captureId!);
  // The part capture is on this booking's PayPal calls, and they survive a reload.
  await expectCallsSurviveReload(page, 4);
  if (flow.sandbox) {
    const { authorization, capture } = await readPayPalObjects(reviewed.orderId!, reviewed.authorizationId!, part.captureId!);
    expect(authorization.status).toBe("PARTIALLY_CAPTURED");
    expect(capture!.amount.value).toBe((acceptedCents / 100).toFixed(2));
    expect(capture!.final_capture).toBe(false);
    console.log(`PayPal re-read: authorization ${authorization.id} ${authorization.status}; accepted-items capture ${capture!.id} ${capture!.status} ${capture!.amount.value} final_capture=${capture!.final_capture}`);
  }

  // Later, the host settles the contested part from the same hold.
  const chargeCents = Math.min(4_000, contestedCents);
  const heldCents = DEPOSIT_CENTS - acceptedCents;
  await setCharge(page, await flow.booking(), dollars(chargeCents).slice(1));
  await expect(page.getByTestId("charge-preview")).toContainText(`Charge exactly ${dollars(chargeCents)} and release ${dollars(heldCents - chargeCents)}`);
  await page.getByTestId("request-approval").click();
  await expect(prompt).toContainText(`Charge exactly ${dollars(chargeCents)} of the contested ${dollars(contestedCents)} and release ${dollars(heldCents - chargeCents)} to the renter (${dollars(acceptedCents)} was already charged for the items they accepted)`, { timeout: 30_000 });
  await page.getByTestId("approve-button").click();

  const totalCents = acceptedCents + chargeCents;
  await expect(page.getByTestId("ruling-headline")).toHaveText(`${headline(totalCents)} captured, ${headline(DEPOSIT_CENTS - totalCents)} released`, { timeout: 60_000 });
  await expect(page.getByTestId("ruling")).toContainText("Two charges from one hold");
  await expect(page.getByTestId("ruling")).toContainText(part.captureId!);
  // The money in one line: the hold, both captures and the release, as PayPal returned them.
  await expectMoneyStrip(page, flow, [`${headline(DEPOSIT_CENTS)} held`, `${headline(acceptedCents)} captured`, `${headline(chargeCents)} captured`, `${headline(DEPOSIT_CENTS - totalCents)} released`]);
  await page.getByTestId("paypal-calls-toggle").click();
  await expect(page.getByTestId("ruling-headline")).toBeInViewport();
  await expectNoSidewaysScroll(page);
  await expect(renter.getByTestId("renter-headline")).toContainText(`${headline(totalCents)} charged`, { timeout: 15_000 });
  await page.screenshot({ path: `screenshots/deposit-split-${flow.mode}-${flow.live ? "live-ai" : "mock-ai"}.png`, fullPage: true });

  const done = await flow.booking();
  expect(done.settlement).toMatchObject({ capturedCents: totalCents, releasedCents: DEPOSIT_CENTS - totalCents, authorizationStatus: "VOIDED" });
  if (flow.sandbox) {
    // Both captures, straight from PayPal.
    const first = await readPayPalObjects(done.orderId!, done.authorizationId!, part.captureId!);
    const { order, authorization, capture } = await readPayPalObjects(done.orderId!, done.authorizationId!, done.settlement!.captureId!);
    // PayPal doesn't promise an order for the order's captures, so compare them as a set.
    const byId = (rows: string[][]) => [...rows].sort((x, y) => x[0].localeCompare(y[0]));
    expect(byId(order.purchase_units[0].payments.captures.map((c) => [c.id, c.amount.value]))).toEqual(
      byId([
        [part.captureId!, (acceptedCents / 100).toFixed(2)],
        [capture!.id, (chargeCents / 100).toFixed(2)],
      ]),
    );
    // And each capture on its own, by id.
    expect(first.capture!.amount.value).toBe((acceptedCents / 100).toFixed(2));
    expect(first.capture!.final_capture).toBe(false);
    expect(capture!.amount.value).toBe((chargeCents / 100).toFixed(2));
    expect(first.capture!.status).toBe("COMPLETED");
    expect(capture!.status).toBe("COMPLETED");
    expect(authorization.status).toBe("VOIDED");
    const further = await tryCapture(done.authorizationId!, "1.00");
    expect(further.status).toBe(422);
    console.log(`PayPal re-read (split): order ${order.id} ${order.status}; capture ${first.capture!.id} ${first.capture!.status} ${first.capture!.amount.value} (accepted items); capture ${capture!.id} ${capture!.status} ${capture!.amount.value} (contested part); authorization ${authorization.id} ${authorization.status}; further $1.00 capture refused: ${further.status} ${further.issue}`);
  }
  await renter.context().close();
});

test("renter photos: the renter's own check-in close-up is weighed, and each finding names its photo", { tag: "@live-ai" }, async ({ page, request }) => {
  const flow = await toPhotos(page, request, { checkOut: "two", item: "Lakeside cabin, weekend of Dec 4" });
  const held = await flow.booking();
  await expect(page.getByTestId("renter-photo-invite")).toBeVisible();

  // Before the host compares, the renter adds their own photo from their page.
  const renter = await openAsRenter(page, held);
  await expect(renter.getByTestId("renter-photos")).toContainText("Add them before the host compares the photos");
  await renter.getByTestId("renter-upload-check_in").setInputFiles({ name: "note.jpg", mimeType: "image/jpeg", buffer: Buffer.from("not really a photo") });
  // The browser refuses it before it is sent; the server would too.
  await expect(renter.getByText(/Choose a JPEG, PNG or WebP photo\.|Upload a JPEG, PNG or WebP photo\./)).toBeVisible();
  await renter.getByTestId("renter-demo-check_in").click();
  await expect(renter.getByAltText("Renter's check-in photo")).toBeVisible();
  await expectNoSidewaysScroll(renter);

  await page.reload();
  await expect(page.getByTestId("renter-photo-check_in")).toBeVisible();
  await page.getByTestId("run-review").click();
  await expect(page.getByTestId("ai-proposal")).toBeVisible({ timeout: 90_000 });
  await unfold(page, "compare");
  await expect(page.getByTestId("review")).toBeVisible();
  await expect(page.getByTestId("review-renter-photos")).toContainText("renter’s own check-in photo");
  const reviewed = await flow.booking();
  expect(reviewed.review!.renterPhotos).toEqual(["check_in"]);
  // Every finding names the photo it was seen in.
  const items = reviewed.review!.items;
  await expect(page.getByTestId("review").getByTestId("finding-photo")).toHaveCount(items.filter((item) => item.box).length);
  for (const item of items) expect([undefined, "renter_check_out"]).toContain(item.photo);
  if (!flow.live) {
    // The renter's photo shows the stain was there on arrival, so only the gouge is charged.
    expect(items.map((item) => item.price)).toEqual([{ type: "scratch", size: "large" }]);
    await expect(page.getByTestId("review").getByTestId("finding-photo")).toHaveText(["Seen in the host's check-out photo"]);
  }
  await page.screenshot({ path: `screenshots/deposit-renter-photos-${flow.mode}-${flow.live ? "live-ai" : "mock-ai"}.png`, fullPage: true });
  console.log(`Renter photos (${flow.live ? "live AI" : "mock AI"}): ${items.length} charged: ${items.map((item) => `${item.price?.type}/${item.price?.size} on ${item.photo ?? "check_out"}`).join(", ") || "none"}; worth a look ${reviewed.review!.worthALook?.length ?? 0}; reasoning: ${reviewed.review!.reasoning}`);

  // Once compared, the renter's photos are fixed, and they see them as weighed.
  await renter.reload();
  await expect(renter.getByTestId("renter-photos")).toContainText("The comparison weighed these");
  await expect(renter.getByTestId("renter-upload-check_in")).toHaveCount(0);
  await renter.screenshot({ path: `screenshots/renter-own-photos-${flow.live ? "live-ai" : "mock-ai"}.png`, fullPage: true });
  await renter.context().close();
});

test("dispute pack: the renter disputes the charge with PayPal, and the host sends the evidence pack through the approval gate", async ({ page, request }) => {
  const { mode, live } = await kitStatus(request);
  test.skip(mode !== "mock", "On the sandbox a buyer opens a dispute from their own PayPal account; the app's handler is the same");
  test.skip(live, "Keeps a live run cheap");
  const flow = await toProposal(page, request, { item: "Lakeside cabin, weekend of Dec 4" });
  const renter = await renterAccepts(page, await flow.booking());
  await renter.context().close();
  await expect(page.getByTestId("request-approval")).toBeEnabled({ timeout: 10_000 });
  await page.getByTestId("request-approval").click();
  await page.getByTestId("approve-button").click({ timeout: 30_000 });
  await expect(page.getByTestId("ruling-headline")).toHaveText("$150 captured, $150 released", { timeout: 60_000 });
  const settled = await flow.booking();

  // Before any dispute, the host can ask PayPal directly (list_disputes): nothing there yet.
  await page.getByTestId("evidence-panel").getByTestId("check-dispute").click();
  await expect(page.getByTestId("dispute-checked")).toContainText("PayPal showed no dispute on this charge");

  // The renter opens a dispute from their PayPal account; PayPal sends CUSTOMER.DISPUTE.CREATED.
  const opened = await request.post(`/api/dev/mock/dispute/${flow.id}`, { data: { message: "The scratch was already there when I arrived." } });
  expect(opened.status()).toBe(200);
  const disputed = await flow.booking();
  expect(disputed.dispute).toMatchObject({ captureId: settled.settlement!.captureId, status: "WAITING_FOR_SELLER_RESPONSE", amountCents: 15_000 });

  await page.reload();
  const panel = page.getByTestId("dispute-panel");
  await expect(panel).toContainText("The renter opened a PayPal dispute");
  await expect(panel).toContainText("Not as described, $150.00 of the charge");
  await expect(panel).toContainText("PayPal is waiting for your evidence");
  await expect(page.getByTestId("dispute-id")).toHaveText(disputed.dispute!.disputeId);
  await expect(page.getByTestId("dispute-message")).toContainText("already there");
  await downloadEvidence(page, [settled.settlement!.captureId!]);

  // Sending it waits at the Guard's gate; PayPal has nothing until the host approves.
  await panel.getByTestId("send-evidence").click();
  const prompt = panel.getByTestId("approval-prompt");
  await expect(prompt).toContainText(`Send PayPal the evidence pack for case ${disputed.dispute!.disputeId}`, { timeout: 30_000 });
  await expect(prompt.getByTestId("approve-button")).toBeInViewport();
  expect((await flow.booking()).dispute!.status).toBe("WAITING_FOR_SELLER_RESPONSE");
  await prompt.getByTestId("approve-button").click();
  // A new case is an inquiry, where PayPal takes messages, not evidence: the pack goes attached to one.
  await expect(page.getByTestId("evidence-sent")).toContainText(`deposit-evidence-${flow.id}.pdf`, { timeout: 15_000 });
  await expect(page.getByTestId("evidence-sent")).toContainText("attached to a message");
  await expect(panel).toContainText("Waiting for the renter's reply");
  const sent = await flow.booking();
  expect(sent.dispute).toMatchObject({ status: "WAITING_FOR_BUYER_RESPONSE", stage: "INQUIRY", evidence: { fileName: `deposit-evidence-${flow.id}.pdf`, sentAs: "message" } });

  // The submission is on the audit trail with its approval, and on the booking's PayPal calls.
  const audit = await (await request.get("/api/audit")).json();
  const actions = (audit.entries as { tool?: string; action: string; runId?: string }[]).filter((e) => e.tool === "submit_dispute_evidence" && e.runId === sent.dispute!.evidence!.runId).map((e) => e.action);
  expect(actions).toEqual(expect.arrayContaining(["approval.requested", "approval.approved", "tool.executed"]));
  // The settlement agent read the dispute with the Agent Toolkit's get_dispute, a read with no approval.
  const reads = (audit.entries as { tool?: string; action: string; actor: string }[]).filter((e) => e.tool === "get_dispute" && e.action === "tool.requested" && e.actor === "settlement-agent");
  expect(reads.length).toBeGreaterThanOrEqual(2);
  await page.getByTestId("paypal-calls-toggle").click();
  await expect(page.getByTestId("timeline-step").filter({ hasText: "submit_dispute_evidence" }).first()).toBeVisible();
  await expect(page.getByTestId("paypal-calls").getByText(`Review dispute ${sent.dispute!.disputeId}`).first()).toBeVisible();
  await page.getByTestId("paypal-calls-toggle").click();
  await expectCallsSurviveReload(page, 5);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(panel).toBeVisible();
  await expectNoSidewaysScroll(page);
  await panel.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `screenshots/dispute-pack-phone.png` });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await panel.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `screenshots/dispute-pack-${flow.mode}.png`, fullPage: true });
  console.log(`Dispute pack (${flow.mode}): dispute ${sent.dispute!.disputeId} on capture ${sent.dispute!.captureId} ${sent.dispute!.status}; evidence ${sent.dispute!.evidence!.fileName}`);
});

test("safe input: bad amounts and fake photos get a plain message, photos can be replaced, and a waiting button says why", async ({ page, request }) => {

  // A bad deposit keeps the form and says what's allowed, next to the field.
  await page.goto("/bookings");
  await page.getByLabel("What's being rented").fill("Harbor loft, weekend of Dec 4");
  await page.getByLabel("Renter").fill("Test Renter");
  for (const value of ["-5", "0", "abc", "99999999"]) {
    await page.getByLabel("Deposit").fill(value);
    await page.getByTestId("create-booking").click();
    await expect(page.getByTestId("deposit-error")).toHaveText("Enter a deposit from $1 to $500, like 300.00.");
    await expect(page).toHaveURL(/\/bookings$/);
  }
  await expect(page.getByText("couldn't load")).toHaveCount(0);

  const flow = await toPhotos(page, request, { checkOut: "clean", item: "Harbor loft, weekend of Dec 11" });

  // A file with a PNG's first bytes and nothing else is refused, in the browser and again by the server.
  const fake = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("not a picture ".repeat(40))]);
  await page.getByTestId("replace-upload-check_out").setInputFiles({ name: "check-out.png", mimeType: "image/png", buffer: fake });
  await expect(page.getByText("That file isn't a readable photo. Choose a JPEG, PNG or WebP photo.")).toBeVisible();
  const refused = await page.request.post(`/api/bookings/${flow.id}/photos`, { data: { slot: "check_out", dataUrl: `data:image/png;base64,${fake.toString("base64")}` } });
  expect(refused.status()).toBe(400);
  expect((await refused.json()).error.message).toBe("That file isn't a readable photo. Choose a JPEG, PNG or WebP photo.");
  await expect(page.getByTestId("photo-source").nth(1)).toContainText("same photo");
  // The rest compares photos; a live run keeps to the checks above, which don't use the AI.
  if (flow.live) return;

  await page.getByTestId("run-review").click();
  await expect(page.getByTestId("request-release")).toBeVisible({ timeout: 60_000 });
  expect((await flow.booking()).proposal!.kind).toBe("release");

  // Before the renter answers, the host can swap a photo; the comparison starts over.
  await unfold(page, "photos");
  await expect(page.getByTestId("replace-note")).toBeVisible();
  await openDemoTools(page);
  await page.getByTestId("replace-demo-check_out").click();
  await expect(page.getByTestId("run-review")).toBeVisible({ timeout: 15_000 });
  const reset = await flow.booking();
  expect(reset.status).toBe("held");
  expect(reset.review).toBeUndefined();
  expect(reset.proposal).toBeUndefined();
  await expect(page.getByTestId("photo-source").nth(1)).toContainText("added digitally");
  await page.getByTestId("run-review").click();
  await expect(page.getByTestId("request-approval")).toBeVisible({ timeout: 60_000 });
  expect((await flow.booking()).proposal!.kind).not.toBe("release");

  // The disabled button says what it's waiting for.
  await expect(page.getByTestId("request-approval")).toBeDisabled();
  await expect(page.getByTestId("approval-why")).toContainText("Waiting for the renter to accept or contest");

  // A negative line is a message on the line, not a broken page.
  await setCharge(page, await flow.booking(), "-5");
  await expect(page.getByText("An amount can't be below zero.")).toBeVisible();
  await expect(page.getByText("couldn't load")).toHaveCount(0);
  await setCharge(page, await flow.booking(), "150.00");

  // Once the renter answers, the photos are fixed.
  const renter = await renterAccepts(page, await flow.booking());
  await page.reload();
  await expect(page.getByTestId("replace-check_out")).toHaveCount(0);
  const late = await page.request.post(`/api/bookings/${flow.id}/photos`, { data: { slot: "check_out" } });
  expect(late.status()).toBe(409);
  await expectNoSidewaysScroll(page);
  await renter.context().close();
});

test("the wait for the comparison is a live list of steps, with Claude's elapsed seconds", async ({ page, request }) => {
  test.skip((await kitStatus(request)).live, "Every live flow checks the list in toProposal; this one needs no second AI call");
  // A slow comparison, like Claude on two large photos.
  await page.route("**/api/bookings/*/review", async (route) => {
    await new Promise((r) => setTimeout(r, 4_000));
    await route.continue();
  });
  await toPhotos(page, request, { item: "Lakeside cabin, weekend of Nov 20" });
  await page.getByTestId("run-review").click();
  const story = page.getByTestId("wait-story");
  await expect(story).toBeVisible({ timeout: 2_000 });
  await expect(page.getByTestId("wait-step-hold")).toHaveAttribute("data-state", "done");
  await expect(page.getByTestId("wait-step-photos")).toHaveAttribute("data-state", "done");
  await expect(page.getByTestId("wait-step-compare")).toHaveAttribute("data-state", "active");
  await expect(page.getByTestId("wait-step-compare")).toContainText("Claude is comparing the photos");
  await expect(page.getByTestId("wait-step-price")).toHaveAttribute("data-state", "waiting");
  await expect(page.getByTestId("wait-step-proposal")).toHaveAttribute("data-state", "waiting");
  // The seconds count up while it waits.
  await expect(page.getByTestId("wait-note-compare")).toHaveText("· 2 s", { timeout: 4_000 });
  await expect(page.getByTestId("wait-elapsed")).toHaveText(/^[23] s$/);
  await expectNoSidewaysScroll(page);
  await expect(page.getByTestId("ai-proposal")).toBeVisible({ timeout: 90_000 });
  for (const step of ["hold", "photos", "compare", "price", "proposal"]) await expect(page.getByTestId(`wait-step-${step}`)).toHaveAttribute("data-state", "done");
  await expect(page.getByTestId("wait-step-compare")).toContainText("Claude compared the photos");
});

/** The host sends the agent's counter; the renter sees it on their phone and accepts. */
async function sendAndAcceptCounter(page: Page, renter: Page, shot: string, flow: Flow, fromCents: number, toCents: number) {
  await page.getByTestId("send-counter").click();
  await expect(page.getByTestId("second-look").getByTestId("counter-sent")).toBeVisible();
  await expect(renter.getByTestId("renter-counter")).toBeVisible({ timeout: 15_000 });
  await expect(renter.getByTestId("renter-headline")).toHaveText(`Counter: ${dollars(toCents)} for what you contested`);
  await expect(renter.getByTestId("renter-counter-total")).toContainText(`${dollars(fromCents)} → ${dollars(toCents)}`);
  await expectNoSidewaysScroll(renter);
  await renter.screenshot({ path: `screenshots/${shot}-renter-${flow.mode}-${flow.live ? "live-ai" : "mock-ai"}.png`, fullPage: true });
  await renter.getByTestId("accept-counter").click();
  await expect(renter.getByTestId("renter-counter-accepted")).toBeVisible();
}

/**
 * The second look, end to end: the renter accepts one mark and contests the other with a note and
 * their own photo; the host approves the accepted part; Claude re-reads each contested line against
 * the renter's evidence and code maps the verdict (never up). If that lowers anything, the agent
 * writes a counter, the host sends it and the renter accepts; if it changes nothing, the card says
 * so and the host settles the contested part as it stands. Either way the settlement goes through
 * the approval gate. Lines are picked by what they are, never by position. Tolerant of live AI: it
 * checks that no line went up and that PayPal holds exactly what the screen says.
 */
async function secondLook(page: Page, request: Parameters<typeof toProposal>[1], opts: { item: string; photo: string; shot: string; contest: "stain" | "other mark"; decide?: "keep" | "drop" }) {
  const flow = await toProposal(page, request, { checkOut: "two", item: opts.item });
  const reviewed = await flow.booking();
  const lines = reviewed.proposal!.lines;
  const stain = lines.filter(isStain);
  const others = lines.filter((line) => !isStain(line));
  test.skip(!stain.length || !others.length, `The review found ${lines.map((l) => l.price?.type ?? "unpriced").join(", ") || "nothing"} on the two-marks photo, not the stain and another mark, so there is nothing to split`);
  const contestedLines = opts.contest === "stain" ? stain : others;
  const acceptedLines = opts.contest === "stain" ? others : stain;
  const acceptedCents = acceptedLines.reduce((sum, l) => sum + l.amountCents, 0);

  // The renter, on their phone: accept one mark, contest the other with a note and a photo.
  const renter = await openAsRenter(page, reviewed);
  for (const accepted of acceptedLines) {
    await renter.getByTestId(`line-accept-${accepted.id}`).click();
    await expect(renter.getByTestId(`evidence-upload-${accepted.id}`)).toHaveCount(0);
  }
  for (const line of contestedLines) await renter.getByTestId(`line-contest-${line.id}`).click();
  await renter.getByTestId(`evidence-upload-${contestedLines[0].id}`).setInputFiles(opts.photo);
  await expect(renter.getByTestId(`evidence-preview-${contestedLines[0].id}`)).toBeVisible();
  await renter.getByTestId("contest-note").fill("The stain was there when we arrived.");
  await renter.getByTestId("contest").click();
  await expect(renter.getByTestId("renter-contested")).toBeVisible();
  await expect(renter.getByTestId("renter-second-look")).toBeVisible();
  await expectNoSidewaysScroll(renter);

  // The host approves the accepted part first: one capture, not final, so the rest stays on the hold.
  await expect(page.getByTestId("approval-prompt")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("approval-money")).toHaveText(`Capture ${dollars(acceptedCents)} · keep ${dollars(DEPOSIT_CENTS - acceptedCents)} on hold`);
  await page.getByTestId("approve-button").click();
  await expect(page.getByTestId("part-capture")).toBeVisible({ timeout: 60_000 });

  // Claude's second look, on the host's page.
  const card = page.getByTestId("second-look");
  await expect(card).toHaveAttribute("data-status", "ready", { timeout: 120_000 });
  const first = (await flow.booking()).secondLook!;
  const flagged = first.lines.filter((l) => l.flagged && !l.hostChoice);
  if (flagged.length) {
    // Claude couldn't tell: the line stays as charged, amber, with both photos, until the host decides.
    const rows = card.locator('[data-testid="second-look-line"][data-flagged="true"]');
    await expect(rows).toHaveCount(flagged.length);
    await expect(card.getByTestId("send-counter")).toHaveCount(0);
    await expect(card.getByTestId("second-look-waiting")).toBeVisible();
    for (const line of flagged) {
      const row = card.locator(`[data-testid="second-look-line"][data-flagged="true"]`).first();
      await expect(row.getByTestId("second-look-flag")).toContainText(`It stays at ${dollars(line.fromCents)} until you decide`);
      await expect(row.getByRole("img", { name: "Renter's photo" })).toBeVisible();
      await expect(row.getByTestId("damage-box").filter({ visible: true })).toHaveCount(1);
      await card.screenshot({ path: `screenshots/${opts.shot}-flagged-${flow.mode}-${flow.live ? "live-ai" : "mock-ai"}.png` });
      await row.getByTestId(opts.decide === "drop" ? "flag-drop" : "flag-keep").click();
    }
    await expect(card.locator('[data-testid="second-look-line"][data-flagged="true"]')).toHaveCount(0, { timeout: 15_000 });
  }
  const look = (await flow.booking()).secondLook!;
  expect(look.lines.map((l) => l.lineId)).toEqual(contestedLines.map((l) => l.id));
  for (const line of look.lines) {
    // The model names a verdict; code sets the amount, and it never goes up.
    expect(["new", "already_there", "smaller", "unsure"]).toContain(line.verdict);
    expect(line.toCents).toBeLessThanOrEqual(line.fromCents);
    expect(line.fromCents).toBe(contestedLines.find((l) => l.id === line.lineId)!.amountCents);
  }
  const fromCents = look.lines.reduce((sum, l) => sum + l.fromCents, 0);
  const toCents = look.lines.reduce((sum, l) => sum + l.toCents, 0);
  await expect(card.getByTestId("second-look-total")).toHaveText(new RegExp(`Total charge\\s*${dollars(acceptedCents + fromCents).replace("$", "\\$")}\\s*${dollars(acceptedCents + toCents).replace("$", "\\$")}`));
  await expect(card.getByTestId("damage-box").filter({ visible: true })).toHaveCount(look.lines.length);
  await expect(card.locator('[data-testid="damage-box"][data-state="dropped"]')).toHaveCount(look.lines.filter((l) => l.toCents === 0).length);
  const unchanged = look.lines.every((l) => l.toCents >= l.fromCents);
  if (unchanged) {
    // Nothing to offer, said plainly: no counter and no greyed-out button with no reason.
    await expect(card.getByTestId("second-look-unchanged")).toContainText(`The second look changes nothing.`);
    await expect(card.getByTestId("second-look-unchanged")).toContainText(`the charge stays ${dollars(acceptedCents + fromCents)}`);
    await expect(card.getByTestId("send-counter")).toHaveCount(0);
  } else {
    // The agent writes the counter after the lines are in; a live agent can take a while.
    await expect(card.getByTestId("counter-rationale")).not.toBeEmpty({ timeout: 90_000 });
  }
  // Both photos side by side: the host's check-out with the box, and the renter's own photo, loaded.
  await expect(card.getByRole("img", { name: "Renter's photo" })).toHaveCount(look.lines.filter((l) => l.withPhoto).length);
  await expect.poll(() => card.locator("img").evaluateAll((imgs) => imgs.every((img) => (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth > 0)), { timeout: 15_000 }).toBe(true);
  // When the renter's photo was taken, read by code from the file, under each line.
  await expect(card.getByTestId("second-look-photo-date")).toHaveText(look.lines.map(photoDateLabel).filter((t): t is string => !!t));
  await expectNoSidewaysScroll(page);
  await card.screenshot({ path: `screenshots/${opts.shot}-host-${flow.mode}-${flow.live ? "live-ai" : "mock-ai"}.png` });
  console.log(`Second look (${flow.live ? "live AI" : "mock AI"}, ${look.model ?? "mock"}): ${look.lines.map((l) => `${l.description.slice(0, 40)}… ${l.verdict} ${dollars(l.fromCents)} -> ${dollars(l.toCents)}`).join("; ")}; counter: ${look.counter ? `${look.counter.engine}: ${look.counter.rationale}` : "none, the second look changed nothing"}`);

  const heldCents = DEPOSIT_CENTS - acceptedCents;
  if (unchanged) {
    // The host settles the contested part as it stands, through the same approval gate.
    await expect(page.getByTestId("charge-preview")).toContainText(`Charge exactly ${dollars(fromCents)} and release ${dollars(heldCents - fromCents)}`);
    await page.getByTestId("request-approval").click();
  } else await sendAndAcceptCounter(page, renter, opts.shot, flow, fromCents, toCents);

  // Back at the host's approval gate: a capture of what's left, or a release if nothing is.
  const prompt = page.getByTestId("approval-prompt");
  await expect(prompt).toBeVisible({ timeout: 30_000 });
  if (!unchanged) await expect(prompt.getByTestId("approval-renter-answer")).toContainText("accepted the counter");
  await expect(prompt.getByTestId("approval-money")).toHaveText(`Capture ${dollars(toCents)} · release ${dollars(heldCents - toCents)}`);
  await page.getByTestId("approve-button").click();

  const totalCents = acceptedCents + toCents;
  await expect(page.getByTestId("ruling-headline")).toHaveText(`${headline(totalCents)} captured, ${headline(DEPOSIT_CENTS - totalCents)} released`, { timeout: 60_000 });
  await expectMoneyStrip(page, flow, [`${headline(DEPOSIT_CENTS)} held`, `${headline(acceptedCents)} captured`, ...(toCents ? [`${headline(toCents)} captured`] : []), `${headline(DEPOSIT_CENTS - totalCents)} released`]);
  await expect(renter.getByTestId("renter-headline")).toContainText(`${headline(totalCents)} charged`, { timeout: 15_000 });
  await page.screenshot({ path: `screenshots/${opts.shot}-ruling-${flow.mode}-${flow.live ? "live-ai" : "mock-ai"}.png`, fullPage: true });

  const done = await flow.booking();
  expect(done.settlement).toMatchObject({ capturedCents: totalCents, releasedCents: DEPOSIT_CENTS - totalCents, authorizationStatus: "VOIDED" });
  if (flow.sandbox) {
    // Straight from PayPal: every capture on the order, and the hold voided.
    const ids = [done.partCapture!.captureId!, ...(toCents ? [done.settlement!.captureId!] : [])];
    const { order, authorization } = await readPayPalObjects(done.orderId!, done.authorizationId!);
    const byId = (rows: string[][]) => [...rows].sort((x, y) => x[0].localeCompare(y[0]));
    expect(byId(order.purchase_units[0].payments.captures.map((c) => [c.id, c.amount.value]))).toEqual(byId([[ids[0], (acceptedCents / 100).toFixed(2)], ...(toCents ? [[ids[1], (toCents / 100).toFixed(2)]] : [])]));
    for (const id of ids) {
      const { capture } = await readPayPalObjects(done.orderId!, done.authorizationId!, id);
      expect(capture!.status).toBe("COMPLETED");
      expect(capture!.final_capture).toBe(false);
    }
    expect(authorization.status).toBe("VOIDED");
    const further = await tryCapture(done.authorizationId!, "1.00");
    expect(further.status).toBe(422);
    console.log(`PayPal re-read (second look, ${opts.shot}): order ${order.id} ${order.status}; authorization ${authorization.id} ${authorization.status} ${authorization.amount.value}; captures ${order.purchase_units[0].payments.captures.map((c) => `${c.id} ${c.amount.value}`).join(", ")}; further $1.00 capture refused: ${further.status} ${further.issue}`);
  }
  await renter.context().close();
  return { flow, look, toCents };
}

test("second look: the renter contests the stain with their check-in close-up, Claude re-reads it, and the charge can only fall", { tag: "@live-ai" }, async ({ page, request }) => {
  const { look, flow } = await secondLook(page, request, { item: "Lakeside cabin, weekend of Dec 11", photo: "public/demo-photos/renter-check-in-stain.jpg", shot: "second-look", contest: "stain" });
  if (!flow.live) {
    // The close-up shows the stain before the stay: it goes to $0, and its box greys.
    expect(look.lines.map((l) => [l.verdict, l.toCents])).toEqual([["already_there", 0]]);
  }
});

test("second look, unsure: the renter sends back the host's own check-out shot; Claude can't tell, so the host decides, and drops it", async ({ page, request }) => {
  const { look, flow } = await secondLook(page, request, { item: "Lakeside cabin, weekend of Jan 8", photo: "public/demo-photos/cabin-check-out-two.jpg", shot: "second-look-unsure", contest: "stain", decide: "drop" });
  // Not dropped by the model: the host's choice, made on the flagged line.
  if (!flow.live) expect(look.lines.map((l) => [l.verdict, l.flagged, l.hostChoice, l.toCents])).toEqual([["unsure", true, "drop", 0]]);
});

test("second look, dated after check-out: the renter's photo can't lower the line, whatever Claude reads in it", { tag: "@live-ai" }, async ({ page, request }, info) => {
  // The stain close-up, with EXIF saying it was taken two hours from now: after check-out.
  const { withExifDate } = await import("../../src/lib/deposit/exif");
  const takenAt = new Date(Date.now() + 2 * 3_600_000).toISOString();
  const file = info.outputPath("renter-photo-after-check-out.jpg");
  fs.writeFileSync(file, withExifDate(new Uint8Array(fs.readFileSync("public/demo-photos/renter-check-in-stain.jpg")), takenAt));
  const { look } = await secondLook(page, request, { item: "Lakeside cabin, weekend of Jan 15", photo: file, shot: "second-look-dated-after", contest: "stain" });
  // Code, not the model: whatever the verdict, the line stands, and the card says why.
  expect(look.lines.map((l) => [l.photoTiming, l.toCents === l.fromCents, !!l.flagged])).toEqual([["after_check_out", true, false]]);
  expect(photoDateLabel(look.lines[0])).toMatch(/after check-out, so it can't lower this line$/);
});

test("second look, smaller: a photo that shows the mark smaller lowers it a size, then two captures from one hold", async ({ page, request }) => {
  const { look, flow } = await secondLook(page, request, { item: "Lakeside cabin, weekend of Dec 18", photo: "public/demo-photos/cabin-check-in.jpg", shot: "second-look-smaller", contest: "stain" });
  if (!flow.live) expect(look.lines.map((l) => [l.verdict, l.fromCents, l.toCents])).toEqual([["smaller", 10_000, 5_000]]);
});

test("second look, unchanged: the stain close-up sent against the gouge changes nothing, and the card says so", { tag: "@live-ai" }, async ({ page, request }) => {
  const { look, flow } = await secondLook(page, request, { item: "Lakeside cabin, weekend of Dec 25", photo: "public/demo-photos/renter-check-in-stain.jpg", shot: "second-look-unchanged", contest: "other mark" });
  // The close-up shows the stain, a different spot: the gouge stands at its price.
  if (!flow.live) expect(look.lines.map((l) => [l.verdict, l.fromCents, l.toCents])).toEqual([["new", 15_000, 15_000]]);
});
