/**
 * The host's dashboard, over real deposit data. With NEXT_PUBLIC_SPONSOR_UI=1 it's AG Studio;
 * with the switch off it's the plain grid and no AG Studio code reaches the browser.
 */
import { expect, test, type Locator, type Page } from "@playwright/test";
import { expectNoSidewaysScroll, kitStatus, toProposal } from "./booking-flow";

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
