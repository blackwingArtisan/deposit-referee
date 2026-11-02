/**
 * The host's dashboard, over real deposit data. With NEXT_PUBLIC_SPONSOR_UI=1 it's AG Studio;
 * with the switch off it's the plain grid and no AG Studio code reaches the browser.
 */
import { expect, test, type Page } from "@playwright/test";
import { toProposal } from "./booking-flow";

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
  const flow = await toProposal(page, request, { item: "Dashboard Cabin, weekend of Dec 4" });
  const { rows } = await (await request.get("/api/insights")).json();
  expect(rows).toEqual(expect.arrayContaining([expect.objectContaining({ bookingId: flow.id, property: "Dashboard Cabin", held: 300, aiProposed: 150 })]));

  const scripts = collectScripts(page);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/insights");

  if (SPONSOR_UI) {
    const studio = page.getByTestId("studio-host");
    await expect(studio).toBeVisible({ timeout: 30_000 });
    await expect(studio.getByText("Held now")).toBeVisible({ timeout: 30_000 });
    await expect(studio.getByText("Dashboard Cabin").first()).toBeVisible({ timeout: 30_000 });
    await page.getByTestId("studio-mode").click();
    await expect(page.getByTestId("studio-mode")).toHaveText("Done");
    await page.getByTestId("studio-mode").click();
    await page.screenshot({ path: "screenshots/insights-studio.png", fullPage: true });
  } else {
    const plain = page.getByTestId("plain-dashboard");
    await expect(plain).toBeVisible();
    await expect(plain.getByText("Dashboard Cabin").first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("studio-host")).toHaveCount(0);
    await page.waitForLoadState("networkidle");
    const code = (await Promise.all(scripts)).join("\n").toLowerCase();
    expect(code.length).toBeGreaterThan(1000);
    expect(code).not.toContain("ag-studio");
    await page.screenshot({ path: "screenshots/insights-plain.png", fullPage: true });
  }
  expect(errors).toEqual([]);
});
