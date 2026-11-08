/**
 * The whole deposit story in a real browser. `npm run test:e2e` runs it on mock PayPal;
 * `npm run test:e2e:sandbox` runs it on the real PayPal sandbox and then re-reads the objects
 * straight from PayPal. In sandbox the deposit is paid with PayPal's test card (DEMO_TEST_CARD=1)
 * because the wallet button needs a buyer login. AI is mocked unless E2E_AI_MODE=live.
 */
import { expect, test, type Page } from "@playwright/test";
import { dollars, expectCallsSurviveReload, expectNoSidewaysScroll, headline, openAsRenter, renterAccepts, renterContests, setCharge, toPhotos, toProposal, type Flow } from "./booking-flow";
import { readPayPalObjects, tryCapture } from "./paypal-reread";
import { priceOf } from "../../src/lib/deposit/prices";

const DEPOSIT_CENTS = 30_000;

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

async function approveCharge(page: Page, flow: Flow, chargeCents: number, screenshot: string) {
  const releaseCents = DEPOSIT_CENTS - chargeCents;
  await expect(page.getByTestId("charge-preview")).toContainText(`Charge exactly ${dollars(chargeCents)} and release ${dollars(releaseCents)}`);
  await page.getByTestId("request-approval").click();

  // The gate: nothing moves until the host approves.
  const prompt = page.getByTestId("approval-prompt");
  await expect(prompt).toBeVisible({ timeout: 30_000 });
  await expect(prompt).toContainText(`Charge exactly ${dollars(chargeCents)} from the $300.00 hold and release ${dollars(releaseCents)} to the renter`);
  await expect(page.getByTestId("approve-button")).toHaveCount(1);
  await expect(page.getByTestId("approve-button")).toBeInViewport();
  await expectNoSidewaysScroll(page);
  await expectHoldUntouched(flow);
  await page.screenshot({ path: `screenshots/${screenshot}-approval.png`, fullPage: true });
  await page.getByTestId("approve-button").click();

  // The result.
  const ruling = page.getByTestId("ruling");
  await expect(ruling).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("ruling-headline")).toHaveText(`${headline(chargeCents)} captured, ${headline(releaseCents)} released`);
  await expect(ruling.getByTestId("damage-box").first()).toBeVisible();
  // The result opens at its headline, wherever the host clicked Approve.
  await expect(page.getByTestId("ruling-headline")).toBeInViewport();
  // Opening the calls with the headline scrolled away brings it back into view.
  await scrollHeadlineAway(page);
  // The void on the timeline shows what was released, not the whole hold.
  await page.getByTestId("paypal-calls-toggle").click();
  await expect(page.getByTestId("timeline-step").filter({ hasText: "void_authorization" })).toContainText(dollars(releaseCents));
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
  for (const path of ["/api/paypal/orders", "/api/paypal/captures/X/refund", "/api/paypal/authorizations/X/capture", "/api/paypal/authorizations/X/void", "/api/agent/runs"]) {
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
  await page.getByTestId("simulate-paypal-approval").click();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByText("PayPal was closed before the hold was approved")).toBeVisible();
  await expect(page.getByText("Nothing is held and nothing was charged.")).toBeVisible();
  await expect(page.getByText("Waiting for deposit")).toBeVisible();
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
  await expectHoldUntouched(flow);
  await page.getByTestId("approve-button").click();

  await expect(page.getByTestId("ruling-headline")).toHaveText("$0 captured, $300 released", { timeout: 60_000 });
  const done = await flow.booking();
  expect(done.settlement).toMatchObject({ kind: "release", capturedCents: 0, releasedCents: 30_000, authorizationStatus: "VOIDED" });
  await page.screenshot({ path: `screenshots/deposit-release-${flow.mode}-${flow.live ? "live-ai" : "mock-ai"}.png`, fullPage: true });

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
  await expect(renter.getByTestId("damage-box")).toHaveCount(1);
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

  await page.getByTestId("for-judges").locator("summary").click();
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
  test.skip(lines.length < 2, `The review found ${lines.length} chargeable item(s) on the two-marks photo, so there is nothing to split`);
  const [accepted, ...contestedLines] = lines;
  const acceptedCents = accepted.amountCents;
  const contestedCents = contestedLines.reduce((sum, line) => sum + line.amountCents, 0);

  // The renter unticks the item they agree with and contests the rest.
  const renter = await openAsRenter(page, reviewed);
  await renter.getByTestId(`contest-line-${accepted.id}`).uncheck();
  await renter.getByTestId("contest-note").fill("The stain was there when I arrived.");
  await expect(renter.getByTestId("contest")).toHaveText(`Contest ${contestedLines.length} of ${lines.length} items`);
  await renter.getByTestId("contest").click();
  await expect(renter.getByTestId("renter-contested")).toContainText(`You accepted ${dollars(acceptedCents)} and contested ${dollars(contestedCents)}`);

  // The accepted part goes straight to the approval gate, on its own.
  const prompt = page.getByTestId("approval-prompt");
  await expect(prompt).toBeVisible({ timeout: 30_000 });
  await expect(prompt).toContainText(`Charge exactly ${dollars(acceptedCents)} now for the items the renter accepted. The ${dollars(contestedCents)} they contested stays on the $300.00 hold until you settle it`);
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
  await expect(renter.getByText("Upload a JPEG, PNG or WebP photo.")).toBeVisible();
  await renter.getByTestId("renter-demo-check_in").click();
  await expect(renter.getByAltText("Renter's check-in photo")).toBeVisible();
  await expectNoSidewaysScroll(renter);

  await page.reload();
  await expect(page.getByTestId("renter-photo-check_in")).toBeVisible();
  await page.getByTestId("run-review").click();
  await expect(page.getByTestId("review")).toBeVisible({ timeout: 90_000 });
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
