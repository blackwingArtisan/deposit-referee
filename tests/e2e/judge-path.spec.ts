/**
 * A judge's way in: "Try the demo booking" on the landing page opens a ready sample booking in one
 * click, with the AI's findings and the proposed charge on screen, and nothing for demos or judges
 * opened up. Runs hosted with live AI (in the sandbox list).
 */
import { expect, test } from "@playwright/test";
import { expectNoSidewaysScroll, kitStatus } from "./booking-flow";

for (const size of [{ name: "laptop", width: 1440, height: 900 }, { name: "phone", width: 390, height: 844 }]) {
  test(`"Try the demo booking" opens a ready sample in one click (${size.name})`, async ({ page, request }) => {
    const { sandbox } = await kitStatus(request);
    if (!sandbox) expect((await request.post("/api/dev/seed")).ok()).toBe(true);
    const { bookings } = (await (await request.get("/api/bookings")).json()) as { bookings: { id: string; sample?: boolean }[] };
    // A local sandbox run seeds no samples; the hosted site always has them.
    test.skip(!bookings.some((b) => b.sample) && !process.env.E2E_BASE_URL, "No sample bookings on this local sandbox server");

    await page.setViewportSize({ width: size.width, height: size.height });
    await page.goto("/");
    const tryIt = page.getByTestId("try-demo-booking");
    await expect(tryIt).toBeVisible();
    await expect(tryIt).toHaveText("Try the demo booking");
    await tryIt.click();
    await page.waitForURL(/\/bookings\/bk_sample_/);

    // The sample waiting on the host's decision: its findings and the proposed charge, on screen.
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Lakeside cabin, long weekend");
    await expect(page.getByTestId("sample-note")).toBeVisible();
    await expect(page.getByTestId("sample-renter-link")).toBeVisible();
    for (const step of ["hold", "photos", "compare"]) await expect(page.getByTestId(`fold-${step}-summary`)).toBeVisible();
    await expect(page.getByTestId("fold-compare-summary")).toContainText(/\$\d+ from the price table/);
    // Nothing for demos or judges is opened up (a visitor gets none of it at all).
    const tools = page.getByTestId("demo-tools");
    if (await tools.count()) await expect(tools).not.toHaveAttribute("open");
    await expect(page.getByTestId("for-judges")).not.toBeVisible();
    await expectNoSidewaysScroll(page);
    await page.screenshot({ path: `screenshots/judge-path-${size.name}.png` });
  });
}
