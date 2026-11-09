/**
 * The host's dashboard, over real deposit data. With NEXT_PUBLIC_SPONSOR_UI=1 it's AG Studio;
 * with the switch off it's the plain grid and no AG Studio code reaches the browser.
 */
import { expect, test, type Locator, type Page } from "@playwright/test";
import { expectCallsSurviveReload, expectNoSidewaysScroll, kitStatus, toProposal } from "./booking-flow";

const SPONSOR_UI = process.env.NEXT_PUBLIC_SPONSOR_UI === "1";

/** Every script the page loaded, so the test can look inside them. */
function collectScripts(page: Page) {
  const scripts: Promise<string>[] = [];
  page.on("response", (response) => {
    if (response.request().resourceType() === "script") scripts.push(response.text().catch(() => ""));
  });
  return scripts;
}

test("the dashboard shows real deposit data", async ({ page, request }) => {
  test.skip((await (await request.get("/api/kit/status")).json()).ai.mode === "live", "Keeps a live run cheap");
  // A property of its own, so its numbers don't add up with an earlier run's.
  const property = `Cabin ${Date.now() % 100_000}`;
  const flow = await toProposal(page, request, { item: `${property}, weekend of Dec 4` });
  const { rows } = await (await request.get("/api/insights?tests=1")).json();
  expect(rows).toEqual(expect.arrayContaining([expect.objectContaining({ bookingId: flow.id, property, held: 300, aiProposed: 150 })]));

  const scripts = collectScripts(page);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto("/insights?tests=1");

  if (SPONSOR_UI) {
    const studio = page.getByTestId("studio-host");
    await expect(studio).toBeVisible({ timeout: 30_000 });
    await expect(studio.getByText("Held now")).toBeVisible({ timeout: 30_000 });
    await expect(studio.getByText(property).first()).toBeVisible({ timeout: 30_000 });
    await expect(studio.locator("canvas")).toHaveCount(2, { timeout: 30_000 });
    await expect(studio.getByText("Page Filters")).toBeVisible();
    await expect(studio.getByRole("row", { name: new RegExp(property) })).toContainText("$150.00");
    await page.getByTestId("studio-mode").click();
    await expect(page.getByTestId("studio-mode")).toHaveText("Done");
    await page.getByTestId("studio-mode").click();
    await page.screenshot({ path: "screenshots/insights-studio.png", fullPage: true });
  } else {
    const plain = page.getByTestId("plain-dashboard");
    await expect(plain).toBeVisible();
    await expect(plain.getByText(property).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("studio-host")).toHaveCount(0);
    await page.waitForLoadState("networkidle");
    const code = (await Promise.all(scripts)).join("\n").toLowerCase();
    expect(code.length).toBeGreaterThan(1000);
    expect(code).not.toContain("ag-studio");
    await page.screenshot({ path: "screenshots/insights-plain.png", fullPage: true });
  }
  await expectNoSidewaysScroll(page);
  // With no key yet, AG Studio's starred licence banner is the only error allowed.
  expect(errors.filter((message) => !message.startsWith("*"))).toEqual([]);
});

test("visitors see labelled sample bookings and no test rows", async ({ page, request }) => {
  const { sandbox, live } = await kitStatus(request);
  test.skip(sandbox || live, "The seed route is mock only, and sandbox samples are checked by the seed itself");
  await toProposal(page, request);
  expect((await request.post("/api/dev/seed")).ok()).toBe(true);

  await page.goto("/bookings");
  await expect(page.getByText("Harbor loft, two nights")).toBeVisible();
  await expect(page.getByText("Sample", { exact: true })).toHaveCount(6);
  await expect(page.getByRole("link", { name: /weekend of Nov 6/ })).toHaveCount(0);

  await page.goto("/insights");
  await expect(page.getByTestId("sample-note")).toContainText("6 bookings here are samples");
  await expect(page.getByText("Harbor loft").first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Test Renter")).toHaveCount(0);

  await page.goto("/bookings/bk_sample_riverside");
  await expect(page.getByTestId("sample-note")).toContainText("sample booking");
  await expect(page.getByTestId("ruling-headline")).toContainText("$90 captured");
});

test("Customize: a host can filter the dashboard and rebuild it by dragging", async ({ page, request }) => {
  test.skip(!SPONSOR_UI, "AG Studio only");
  const REPORT_KEY = "deposit-referee:studio-report:v1";
  await request.post("/api/dev/seed");
  await page.goto("/insights");
  const studio = page.getByTestId("studio-host");
  const row = (name: string) => studio.getByRole("row", { name: new RegExp(name) });
  await expect(row("Riverside studio")).toHaveCount(1, { timeout: 30_000 });

  // Filter on the right, in view mode: every widget follows it.
  const property = studio.locator(".ag-studio-filter-card", { hasText: "Property" }).first();
  const search = property.locator(".ag-filter-filter input").first();
  const filterBy = async (text: string) => {
    // The card closes once a filter is applied.
    if (!(await search.isVisible())) await property.locator(".ag-studio-filter-card-expand").click();
    await search.fill(text);
  };
  await filterBy("Harbor");
  await expect(row("Riverside studio")).toHaveCount(0);
  await expect(row("Harbor loft")).toContainText("$210.00");
  await expect(studio.locator(".ag-studio-layout-widget", { hasText: "Released" }).first()).toContainText("$190.00");
  await filterBy("");
  await expect(row("Riverside studio")).toHaveCount(1);

  const drag = async (from: Locator, to: Locator, toEdge?: "below") => {
    const start = (await from.boundingBox())!;
    const end = (await to.boundingBox())!;
    await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
    await page.mouse.down();
    await page.mouse.move(start.x - 40, start.y + 10, { steps: 6 });
    await page.mouse.move(end.x + end.width / 2, toEdge ? end.y + end.height + 30 : end.y + end.height / 2, { steps: 14 });
    await page.waitForTimeout(400);
    await page.mouse.up();
  };
  const report = async () => JSON.parse((await page.evaluate((key) => localStorage.getItem(key), REPORT_KEY)) ?? "{}");
  const widgets = studio.locator(".ag-studio-layout-widget");

  await page.getByTestId("studio-mode").click();
  await expect(page.getByTestId("studio-mode")).toHaveText("Done");
  const before = await widgets.count();

  // Drag a field from the Data panel onto a chart.
  await drag(studio.locator(".ag-studio-data-panel-field", { hasText: "Month" }).first(), studio.locator(".ag-studio-layout-widget", { hasText: "Money by property" }).first());
  await expect.poll(async () => JSON.stringify((await report()).pages?.[0].widgets["by-property"].dataMapping)).toContain("deposits.month");

  // Drag a new widget from the Compose panel onto the page.
  await drag(studio.locator(".ag-studio-setup-panel-widgets-item", { hasText: "KPI" }).first(), studio.locator(".ag-studio-layout-widget", { hasText: "Every deposit" }).first(), "below");
  await expect(widgets).toHaveCount(before + 1);
  await expect.poll(async () => Object.keys((await report()).pages?.[0].widgets ?? {}).length).toBe(before + 1);

  // Done, and it survives a reload in this browser.
  await page.getByTestId("studio-mode").click();
  await expect(page.getByTestId("studio-mode")).toHaveText("Customize");
  await page.screenshot({ path: "screenshots/insights-studio-customized.png", fullPage: true });
  await page.reload();
  await expect(row("Riverside studio")).toHaveCount(1, { timeout: 30_000 });
  await expect(widgets).toHaveCount(before + 1);
  expect(JSON.stringify((await report()).pages[0].widgets["by-property"].dataMapping)).toContain("deposits.month");
});

test("lists carry no renter links, and the ledger holds only this app's PayPal records", async ({ request }) => {
  const created = await (await request.post("/api/bookings", { data: { item: "Token check, weekend of Oct 30", renter: "Test Renter", depositCents: 10_000 } })).json();
  expect(created.renterToken).toBeTruthy();
  const list = await (await request.get("/api/bookings?tests=1")).text();
  expect(list).toContain(created.id);
  expect(list).not.toContain("renterToken");
  expect(list).not.toContain(created.renterToken);

  const { entries } = (await (await request.get("/api/paypal/ledger")).json()) as { entries: { kind: string; description?: string }[] };
  // A renter's dispute on one of this app's captures is one of its records too.
  expect(entries.filter((e) => !["order", "authorization", "capture", "dispute"].includes(e.kind))).toEqual([]);
  expect(entries.filter((e) => /Lumen|Riverbend|Northfold|Gift card/.test(e.description ?? ""))).toEqual([]);
});

test("a first visit lands on the researched problem, labelled samples with their PayPal calls, and the blind test", async ({ page, request }) => {
  await page.goto("/");
  await expect(page.getByTestId("landing-headline")).toHaveText("More than half of hosts have had a guest damage their place.");
  // Why PayPal, in one line in the hero.
  await expect(page.getByTestId("paypal-reason")).toHaveText("Why PayPal: one hold takes several captures, for up to 29 days, and the rest is released.");
  await expect(page.getByTestId("headline-sources").getByRole("link")).toHaveCount(2);
  await expect(page.getByTestId("pain-point")).toHaveCount(4);
  for (const point of await page.getByTestId("pain-point").all()) expect(await point.getByRole("link").count()).toBeGreaterThan(0);
  await expect(page.getByText(/only PayPal|unique to PayPal/i)).toHaveCount(0);
  await expect(page.getByTestId("deposit-preview")).toContainText("Proposed $150.00 of the $300.00 hold");
  // The blind test and the rule for marks the AI isn't sure of are on the landing page too.
  await expect(page.getByTestId("landing-blind-headline")).toHaveText("10 new photo pairs, 0 false charges");
  await expect(page.getByTestId("landing-blind-row")).toHaveCount(3);
  await expect(page.getByTestId("landing-look-rule")).toContainText("Worth a look, nothing charged");
  await expect(page.getByTestId("landing-look-rule")).toContainText("never charged unless you add it");
  // How this differs: every named tool links to its own page, and the three differences are stated.
  const tools = page.getByTestId("differs-tool");
  await expect(tools).toHaveCount(7);
  for (const name of ["Witnessed", "RentSolve AI", "CheckEasy", "VerifyAI", "Truvi", "Waivo", "Obligo"]) await expect(tools.filter({ hasText: name })).toHaveCount(1);
  for (const tool of await tools.all()) expect(await tool.getByRole("link").getAttribute("href")).toMatch(/^https:\/\//);
  await expect(page.getByTestId("differs-ours")).toHaveText([/The hold stays on PayPal/, /Several captures on one hold/, /The renter contests line by line/]);
  await expectNoSidewaysScroll(page);
  const wide = page.viewportSize();
  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoSidewaysScroll(page);
  if (wide) await page.setViewportSize(wide);

  await page.goto("/insights");
  const panel = page.getByTestId("blind-test");
  await expect(panel).toContainText("10 new photo pairs, 0 false charges.");
  await expect(panel).toContainText("0 charged, 0 flagged");

  // The samples are there on a fresh site, including a booking with no damage and the whole deposit released.
  // On mock the seed route loads them; the hosted site seeds them on every start; a local sandbox run doesn't.
  const { sandbox } = await kitStatus(request);
  if (sandbox && !process.env.E2E_BASE_URL) return;
  if (!sandbox) expect((await request.post("/api/dev/seed")).ok()).toBe(true);
  await page.goto("/bookings/bk_sample_hilltop");
  await expect(page.getByTestId("sample-note")).toContainText("sample booking");
  await expect(page.getByTestId("ruling-headline")).toContainText("$0 captured, $250 released");
  await page.goto("/bookings/bk_sample_harbor");
  await expect(page.getByTestId("ruling-headline")).toContainText("$210 captured");
  await expectCallsSurviveReload(page, 2);
});

test("a sample's PayPal calls are counted on the first load, never shown as (0) while they load", async ({ page, request }) => {
  // On mock the seed route loads the samples; the hosted site seeds them on every start; a local sandbox run doesn't.
  const { sandbox } = await kitStatus(request);
  test.skip(sandbox && !process.env.E2E_BASE_URL, "No samples on a local sandbox run");
  if (!sandbox) expect((await request.post("/api/dev/seed")).ok()).toBe(true);
  // A slow answer for the booking's saved calls, like a site waking from sleep.
  await page.route("**/api/bookings/*/activity", async (route) => {
    await new Promise((r) => setTimeout(r, 3_000));
    await route.continue();
  });
  await page.goto("/bookings/bk_sample_harbor");
  await expect(page.getByTestId("ruling-headline")).toContainText("$210 captured");
  const toggle = page.getByTestId("paypal-calls-toggle");
  await expect(page.getByTestId("paypal-calls-loading")).toBeVisible();
  await expect(toggle).not.toContainText("(0)");
  await expect(toggle).toContainText(/PayPal calls \(([2-9]|\d{2,})\)/, { timeout: 20_000 });
});

test("each visitor sees the samples and their own bookings, not another visitor's", async ({ page, browser, request }) => {
  const { sandbox } = await kitStatus(request);
  if (!sandbox) expect((await request.post("/api/dev/seed")).ok()).toBe(true);
  const item = `Visitor check ${Date.now() % 100_000}, weekend of Dec 18`;
  await page.goto("/bookings");
  await page.getByLabel("What's being rented").fill(item);
  await page.getByLabel("Renter").fill("Alex Rivera");
  await page.getByLabel("Deposit").fill("200.00");
  await page.getByTestId("create-booking").click();
  await page.waitForURL(/\/bookings\/bk_/);
  const link = page.url();
  await page.goto("/bookings");
  await expect(page.getByText(item)).toBeVisible();

  const other = await browser.newContext({ baseURL: new URL(link).origin });
  const stranger = await other.newPage();
  await stranger.goto("/bookings");
  await expect(stranger.getByTestId("create-booking")).toBeVisible();
  if (!sandbox || process.env.E2E_BASE_URL) await expect(stranger.getByText("Sample", { exact: true }).first()).toBeVisible({ timeout: 15_000 });
  await expect(stranger.getByText(item)).toHaveCount(0);
  // The booking's own link still opens for anyone who has it.
  await stranger.goto(link);
  await expect(stranger.getByText(item).first()).toBeVisible();
  await other.close();
});
