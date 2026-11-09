/**
 * "Open on another device": the host's browser makes a one-time link that gives a second browser
 * the booking's host secret. It works once; a visitor never sees the panel or the link.
 */
import { expect, test } from "@playwright/test";

test("a one-time link opens the booking as host on a second device, once, and only the host sees it", async ({ page, browser, request }) => {
  await page.goto("/bookings");
  await page.getByLabel("What's being rented").fill("Harbor loft, weekend of Jan 8");
  await page.getByLabel("Renter").fill("Test Renter");
  await page.getByTestId("create-booking").click();
  await page.waitForURL(/\/bookings\/bk_/);
  const id = new URL(page.url()).pathname.split("/").pop()!;

  // The host makes the link and copies it.
  const panel = page.getByTestId("host-link");
  await expect(panel).toBeVisible();
  await expect(page.getByTestId("host-link-url")).toHaveCount(0);
  await page.getByTestId("host-link-make").click();
  const field = page.getByTestId("host-link-url");
  await expect(field).toBeVisible();
  const link = await field.inputValue();
  expect(link).toMatch(new RegExp(`^https?://[^/]+/host-link/[A-Za-z0-9_-]{32}$`));
  await expect(page.getByTestId("host-link-terms")).toContainText("Works once");
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(page.url()).origin });
  await page.getByTestId("host-link-copy").click();
  await expect(page.getByTestId("host-link-copy")).toHaveText("Copied");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(link);
  // The host's own copy of the booking carries no link codes either.
  expect(JSON.stringify(await (await page.request.get(`/api/bookings/${id}`)).json())).not.toContain("hostLinks");
  const path = new URL(link).pathname;

  // A visitor with the booking's address: no panel, no link, and can't make one.
  const visitor = await browser.newContext({ baseURL: new URL(page.url()).origin });
  const look = await visitor.newPage();
  await look.goto(`/bookings/${id}`);
  await expect(look.getByTestId("visitor-note")).toBeVisible();
  await expect(look.getByTestId("host-link")).toHaveCount(0);
  expect(await look.content()).not.toContain(path);
  expect((await look.request.post(`/api/bookings/${id}/host-link`)).status()).toBe(401);
  const seen = await (await look.request.get(`/api/bookings/${id}`)).text();
  expect(seen).not.toContain("hostLinks");
  expect(seen).not.toContain(path.split("/").pop()!);

  // The second device opens the link once and is the host there.
  const phone = await browser.newContext({ baseURL: new URL(page.url()).origin, viewport: { width: 390, height: 844 } });
  const mobile = await phone.newPage();
  await mobile.goto(path);
  await mobile.waitForURL(new RegExp(`/bookings/${id}$`));
  await expect(mobile.getByRole("heading", { level: 1 })).toHaveText("Harbor loft, weekend of Jan 8");
  await expect(mobile.getByTestId("visitor-note")).toHaveCount(0);
  await expect(mobile.getByTestId("host-link")).toBeVisible();
  expect((await (await mobile.request.get(`/api/bookings/${id}`)).json()).viewer).toBe("host");
  // It can act as the host: making a link of its own is a host-only route.
  expect((await mobile.request.post(`/api/bookings/${id}/host-link`)).status()).toBe(200);
  await phone.close();

  // The same link again, in the visitor's browser: refused, and the visitor stays a visitor.
  const again = await look.request.get(path, { maxRedirects: 0 });
  expect(again.status()).toBe(410);
  expect(await again.text()).toContain("already used");
  await look.goto(path);
  await expect(look.getByTestId("host-link-error")).toHaveText("This link was already used");
  expect((await (await look.request.get(`/api/bookings/${id}`)).json()).viewer).toBe("visitor");
  await visitor.close();

  // A made-up code opens nothing.
  expect((await request.get("/host-link/not-a-real-code-at-all-000000000000", { maxRedirects: 0 })).status()).toBe(404);
});
