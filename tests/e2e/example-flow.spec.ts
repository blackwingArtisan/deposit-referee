import { expect, test, type Page } from "@playwright/test";

async function approveInMockCheckout(page: Page) {
  await page.getByTestId("simulate-paypal-approval").click();
  await page.getByTestId("mock-approve").click();
  await expect(page.getByTestId("authorization-panel")).toBeVisible();
  await expect(page.getByTestId("authorization-panel")).toContainText("Created");
}

test.beforeEach(async ({ request }) => {
  await request.post("/api/dev/reset");
});

test("manual: AUTHORIZE order -> approve -> partial capture -> void the rest", async ({ page }) => {
  await page.goto("/example");
  await approveInMockCheckout(page);

  await page.getByLabel("Capture amount").fill("45.00");
  await page.getByTestId("partial-capture").click();
  await expect(page.getByTestId("authorization-panel")).toContainText("Partially captured");

  await page.getByTestId("void-rest").click();
  await expect(page.getByTestId("authorization-panel")).toContainText("Voided");

  const timeline = page.getByTestId("tool-call-timeline");
  await expect(timeline.getByText("Capture authorization")).toBeVisible();
  await expect(timeline.getByText("Void authorization")).toBeVisible();
  await expect(timeline.getByText("PAYMENT.AUTHORIZATION.VOIDED")).toBeVisible();

  const grid = page.getByTestId("data-grid").first();
  await expect(grid.getByText("Capture", { exact: true })).toBeVisible();
  await expect(grid.getByText("Voided").first()).toBeVisible();
  await page.screenshot({ path: "screenshots/example-manual.png", fullPage: true });
});

test("agent: settles the authorization through the guard with a human approval", async ({ page }) => {
  await page.goto("/example");
  await approveInMockCheckout(page);
  await page.getByTestId("run-agent").click();

  const prompt = page.getByTestId("approval-prompt");
  await expect(prompt).toBeVisible({ timeout: 90_000 });
  await page.screenshot({ path: "screenshots/example-agent-approval.png", fullPage: true });
  await prompt.getByTestId("approve-button").click();

  await expect(page.getByTestId("authorization-panel")).toContainText("Voided", { timeout: 120_000 });
  await expect(page.getByTestId("tool-call-timeline").getByText("Settlement agent finished")).toBeVisible({ timeout: 60_000 });
  await page.screenshot({ path: "screenshots/example-agent-done.png", fullPage: true });

  const audit = await (await page.request.get("/api/audit")).json();
  expect(audit.integrity.ok).toBe(true);
  const actions = audit.entries.map((e: { action: string }) => e.action);
  expect(actions).toContain("approval.approved");
  expect(actions).toContain("tool.executed");
});

test("landing and dashboard render", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.screenshot({ path: "screenshots/landing.png", fullPage: true });
  await page.goto("/dashboard");
  await page.getByTestId("seed").click();
  await expect(page.getByText("Demo data loaded")).toBeVisible();
  await page.getByPlaceholder("Search ids, statuses, emails…").fill("payout");
  await expect(page.getByTestId("data-grid").getByText("Payout").first()).toBeVisible();
  await page.getByPlaceholder("Search ids, statuses, emails…").fill("");
  await page.screenshot({ path: "screenshots/dashboard.png", fullPage: true });
});
