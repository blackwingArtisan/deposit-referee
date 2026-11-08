/** Shared steps for the browser tests: a booking from its hold to the agent's proposal. */
import { expect, type APIRequestContext, type Page } from "@playwright/test";
import type { BookingView, RenterView } from "../../src/lib/deposit/types";

export const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;
export const headline = (cents: number) => `$${cents % 100 === 0 ? cents / 100 : (cents / 100).toFixed(2)}`;

export interface Flow {
  id: string;
  sandbox: boolean;
  live: boolean;
  mode: string;
  booking: () => Promise<BookingView>;
}

/** A phone page wider than its screen scrolls sideways, and mobile browsers rescale it, which breaks tapping. */
export async function expectNoSidewaysScroll(page: Page) {
  const width = await page.evaluate(() => ({ screen: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }));
  expect(width.content).toBeLessThanOrEqual(width.screen);
}

export async function kitStatus(request: APIRequestContext) {
  const status = await (await request.get("/api/kit/status")).json();
  return { sandbox: status.paypal.mode === "sandbox", live: status.ai.mode === "live", mode: status.paypal.mode as string };
}

const callCount = async (page: Page) => Number(/PayPal calls \((\d+)\)/.exec((await page.getByTestId("paypal-calls-toggle").textContent()) ?? "")?.[1] ?? -1);

/**
 * "PayPal calls (N)" comes from the booking's own record, so a reload and a fresh browser with
 * none of this tab's state both show every call (and the list behind the count). Leaves the list folded.
 */
export async function expectCallsSurviveReload(page: Page, min = 1) {
  const toggle = page.getByTestId("paypal-calls-toggle");
  await expect(toggle).toContainText(/PayPal calls \(\d+\)/);
  if ((await toggle.getAttribute("aria-expanded")) === "true") await toggle.click();
  const before = await callCount(page);
  expect(before).toBeGreaterThanOrEqual(min);

  await page.reload();
  await expect.poll(() => callCount(page), { timeout: 15_000 }).toBeGreaterThanOrEqual(before);
  await toggle.click();
  await expect.poll(() => page.getByTestId("paypal-calls").locator("li[data-paypal-call]").count(), { timeout: 15_000 }).toBeGreaterThanOrEqual(before);
  await toggle.click();

  const fresh = await page.context().browser()!.newContext({ baseURL: new URL(page.url()).origin });
  const other = await fresh.newPage();
  await other.goto(page.url());
  await expect.poll(() => callCount(other), { timeout: 15_000 }).toBeGreaterThanOrEqual(before);
  await fresh.close();
  return before;
}

/**
 * The renter approves the hold in PayPal's own card form (guest checkout, no PayPal login), with
 * PayPal's sandbox card. The form is PayPal's iframe on the page, so a recording shows it.
 */
export async function payInPayPalCardForm(page: Page, opts: { pause?: number } = {}) {
  // PayPal draws its card button before it wires the click up, and an early click opens nothing.
  // Click until PayPal's card form is on the page.
  const button = page.getByTestId("paypal-guest-button").locator("paypal-basic-card-button");
  const frames = page.locator('iframe[src*="/smart/card-fields"]');
  await button.waitFor({ state: "visible", timeout: 30_000 });
  for (let i = 0; i < 4 && !(await frames.count()); i++) {
    await button.click({ timeout: 30_000 });
    await frames.first().waitFor({ state: "attached", timeout: 6_000 }).catch(() => {});
  }
  const form = page.frameLocator('iframe[src*="/smart/card-fields"]');
  await form.getByLabel("Email").fill("renter@example.com", { timeout: 30_000 });
  await form.getByLabel("Card number").pressSequentially("4111111111111111", { delay: opts.pause ? 40 : 0 });
  await form.getByLabel("Expires").fill("12/30");
  await form.getByLabel("CSC").fill("123");
  await form.getByLabel("First name").fill("Sample");
  await form.getByLabel("Last name").fill("Renter");
  await form.getByLabel("Street address").fill("1 Main St");
  await form.getByLabel("City").fill("Austin");
  await form.getByLabel("State").selectOption("TX");
  await form.getByLabel(/ZIP/i).fill("78701");
  // PayPal asks for a phone number on some sessions (when it offers to save the card), not all.
  const phone = form.getByLabel(/Mobile|Phone/i).first();
  if (await phone.isVisible().catch(() => false)) await phone.fill("5125550100");
  if (opts.pause) await page.waitForTimeout(opts.pause);
  await form.getByRole("button", { name: /^Pay \$/ }).click();
}

/** Creates a booking, places the deposit and adds both photos. */
export async function toPhotos(page: Page, request: APIRequestContext, opts: { item?: string; checkOut?: "demo" | "upload" | "clean" | "faint" | "two"; checkCalls?: boolean; payWith?: "card-form" | "one-tap" } = {}): Promise<Flow> {
  const { sandbox, live, mode } = await kitStatus(request);
  const checkOut = opts.checkOut ?? "demo";

  await page.goto("/bookings");
  await page.getByLabel("What's being rented").fill(opts.item ?? "Lakeside cabin, weekend of Nov 6");
  await page.getByLabel("Renter").fill("Test Renter");
  await page.getByLabel("Deposit").fill("300.00");
  await page.getByTestId("create-booking").click();
  await page.waitForURL(/\/bookings\/bk_/);
  const id = new URL(page.url()).pathname.split("/").pop()!;
  const booking = async () => (await (await request.get(`/api/bookings/${id}`)).json()) as BookingView;

  // The renter places the deposit: money held, not taken.
  if (sandbox) await expect(page.getByTestId("paypal-v6-button")).toBeVisible();
  if (sandbox && opts.payWith === "card-form") await payInPayPalCardForm(page);
  else {
    await page.getByTestId(sandbox ? "sandbox-test-card" : "simulate-paypal-approval").click();
    if (!sandbox) await page.getByTestId("mock-approve").click();
  }
  const hold = page.getByTestId("hold-panel");
  await expect(page.getByTestId("hold-headline")).toHaveText("$300 authorized, nothing charged", { timeout: 30_000 });
  await expect(hold).toContainText("PayPal keeps an authorization for 29 days");
  await expect(hold).toContainText("guaranteed for the first 3 days");
  // The id on screen is the one PayPal returned for the hold.
  await expect(page.getByTestId("hold-authorization-id")).toHaveText((await booking()).authorizationId!);
  if (opts.checkCalls) await expectCallsSurviveReload(page, 2);

  // Both photos, each with its source.
  await page.getByTestId("demo-photo-check_in").click();
  await expect(page.getByTestId("demo-photo-check_out")).toBeEnabled();
  if (checkOut === "upload") await page.getByTestId("upload-photo-check_out").setInputFiles("public/demo-photos/cabin-check-out.jpg");
  else await page.getByTestId({ clean: "demo-photo-clean", faint: "demo-photo-faint", two: "demo-photo-two", demo: "demo-photo-check_out" }[checkOut]).click();
  await expect(page.getByTestId("photo-source")).toHaveCount(2);
  await expect(page.getByTestId("photo-source").first()).toContainText("Greg Zaal, CC0 1.0");
  await expect(page.getByTestId("photo-source").nth(1)).toContainText({ upload: "Uploaded by the host", demo: "added digitally", clean: "same photo", faint: "faint floor scuff", two: "gouge and the stain" }[checkOut]);

  return { id, sandbox, live, mode, booking };
}

/** Everything in toPhotos, then the review and the agent, which stops at its proposal. */
export async function toProposal(page: Page, request: APIRequestContext, opts: Parameters<typeof toPhotos>[2] = {}): Promise<Flow> {
  const flow = await toPhotos(page, request, opts);
  await page.getByTestId("run-review").click();
  await expect(page.getByTestId("review")).toBeVisible({ timeout: 90_000 });
  await expect(page.getByTestId("ai-proposal")).toBeVisible({ timeout: 90_000 });
  await expectNoSidewaysScroll(page);
  return flow;
}

/** The renter's own page, in a separate browser session with none of the host's state. */
export async function openAsRenter(page: Page, booking: BookingView): Promise<Page> {
  const context = await page.context().browser()!.newContext({ baseURL: new URL(page.url()).origin, viewport: { width: 420, height: 900 } });
  const renter = await context.newPage();
  await renter.goto(`/renter/${booking.renterToken}`);
  await expect(renter.getByTestId("renter-headline")).toBeVisible();
  await expectNoSidewaysScroll(renter);
  return renter;
}

export async function renterAccepts(page: Page, booking: BookingView) {
  const renter = await openAsRenter(page, booking);
  await renter.getByTestId("accept").click();
  await expect(renter.getByTestId("renter-accepted")).toBeVisible();
  return renter;
}

export async function renterContests(renter: Page, note: string) {
  await renter.getByTestId("contest-note").fill(note);
  await renter.getByTestId("contest").click();
  await expect(renter.getByTestId("renter-contested")).toContainText(note);
}

export const renterView = async (request: APIRequestContext, booking: BookingView) => (await (await request.get(`/api/renter/${booking.renterToken}`)).json()) as RenterView;

/** Sets the host's charge: the whole amount on the first line and nothing on the others. */
export async function setCharge(page: Page, booking: BookingView, value: string) {
  const [first, ...rest] = booking.proposal!.lines;
  await page.getByTestId(`line-amount-${first.id}`).fill(value);
  for (const line of rest) await page.getByTestId(`line-amount-${line.id}`).fill("0.00");
}
