/** Shared steps for the browser tests: a booking from its hold to the agent's proposal. */
import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { moneyLine, moneySteps } from "../../src/lib/deposit/money-strip";
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
  const booking = async () => (await (await page.request.get(`/api/bookings/${id}`)).json()) as BookingView;

  // The host has no card form: they wait while the renter places the hold from their own page.
  await expect(page.getByTestId("waiting-headline")).toHaveText(/Waiting for the renter.s hold/);
  await expect(page.getByTestId("host-headline")).toHaveText("Waiting for the renter's $300.00 hold");
  await expect(page.getByTestId("paypal-v6-button")).toHaveCount(0);
  await expect(page.getByTestId("simulate-paypal-approval")).toHaveCount(0);

  // The renter, on their phone: money held, not taken.
  const renter = await openAsRenter(page, await booking());
  await expect(renter.getByTestId("renter-headline")).toHaveText("Place your $300 deposit hold");
  if (sandbox) await expect(renter.getByTestId("paypal-v6-button")).toBeVisible();
  if (sandbox && opts.payWith === "card-form") await payInPayPalCardForm(renter);
  else {
    await renter.getByTestId(sandbox ? "sandbox-test-card" : "simulate-paypal-approval").click();
    if (!sandbox) await renter.getByTestId("mock-approve").click();
  }
  await expect(renter.getByTestId("renter-hold-headline")).toHaveText("$300 authorized, nothing charged", { timeout: 30_000 });
  await expect(renter.getByTestId("renter-hold-ends")).toContainText("The hold ends on");
  await expectNoSidewaysScroll(renter);
  await renter.context().close();

  // The host's page picks the hold up by itself.
  const hold = page.getByTestId("hold-panel");
  await expect(page.getByTestId("hold-headline")).toHaveText("$300 authorized, nothing charged", { timeout: 30_000 });
  await expect(page.getByTestId("host-headline")).toHaveText("$300.00 on hold, nothing charged");
  await expect(hold).toContainText("PayPal keeps an authorization for 29 days");
  await expect(hold).toContainText("guaranteed for the first 3 days");
  // The id on screen is the one PayPal returned for the hold.
  await expect(page.getByTestId("hold-authorization-id")).toHaveText((await booking()).authorizationId!);
  if (opts.checkCalls) await expectCallsSurviveReload(page, 2);

  // Both photos, each with its source. The sample photos sit behind Demo tools.
  await expect(page.getByTestId("demo-tools")).not.toHaveAttribute("open");
  await openDemoTools(page);
  await page.getByTestId("demo-photo-check_in").click();
  await expect(page.getByTestId("demo-photo-check_out")).toBeEnabled();
  if (checkOut === "upload") await page.getByTestId("upload-photo-check_out").setInputFiles("public/demo-photos/cabin-check-out.jpg");
  else await page.getByTestId({ clean: "demo-photo-clean", faint: "demo-photo-faint", two: "demo-photo-two", demo: "demo-photo-check_out" }[checkOut]).click();
  await expect(page.getByTestId("photo-source")).toHaveCount(2);
  await expect(page.getByTestId("photo-source").first()).toContainText("Greg Zaal, CC0 1.0");
  await expect(page.getByTestId("photo-source").nth(1)).toContainText({ upload: "Uploaded by the host", demo: "added digitally", clean: "same photo", faint: "faint floor scuff", two: "gouge and the stain" }[checkOut]);

  return { id, sandbox, live, mode, booking };
}

/** Opens the Demo tools disclosure (sample photos and the limit test) if it's closed. */
export async function openDemoTools(page: Page) {
  const tools = page.getByTestId("demo-tools");
  if (!(await tools.evaluate((el) => (el as HTMLDetailsElement).open))) await tools.locator(":scope > summary").click();
}

/** Opens a finished step that folded to one line once the proposal came in. */
export async function unfold(page: Page, step: "hold" | "photos" | "compare") {
  const fold = page.getByTestId(`fold-${step}`);
  if (!(await fold.evaluate((el) => (el as HTMLDetailsElement).open))) await fold.locator(":scope > summary").click();
}

/** Everything in toPhotos, then the review and the agent, which stops at its proposal. */
export async function toProposal(page: Page, request: APIRequestContext, opts: Parameters<typeof toPhotos>[2] = {}): Promise<Flow> {
  const flow = await toPhotos(page, request, opts);
  await page.getByTestId("run-review").click();
  // Never a bare spinner: a live list of steps, with the seconds Claude has been comparing.
  await expect(page.getByTestId("wait-story").first()).toBeVisible({ timeout: 2_000 });
  await expect(page.getByTestId("ai-proposal")).toBeVisible({ timeout: 90_000 });
  // With the proposal in, the finished steps fold to one line each, and open on a click.
  for (const step of ["hold", "photos", "compare"]) await expect(page.getByTestId(`fold-${step}-summary`)).toBeVisible();
  await expect(page.getByTestId("review")).toBeHidden();
  await unfold(page, "compare");
  await expect(page.getByTestId("review")).toBeVisible();
  await expect(page.getByTestId("wait-step-proposal")).toHaveAttribute("data-state", "done");
  await expect(page.getByTestId("wait-step-proposal")).toContainText("Proposal ready");
  await expect(page.getByTestId("wait-note-compare")).toHaveText(/^· \d+ s$/);
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

/** Contests every item on the renter's page with one note. */
export async function renterContests(renter: Page, note: string) {
  const contest = renter.locator('[data-testid^="line-contest-"]');
  await contest.first().waitFor();
  for (let i = 0; i < (await contest.count()); i++) await contest.nth(i).click();
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

/**
 * The ruling's one-line money strip reads `expected`, and each amount is the one the booking
 * recorded from PayPal (the authorization, each capture, the void).
 */
export async function expectMoneyStrip(page: Page, flow: Flow, expected: string[]) {
  const strip = page.getByTestId("money-strip");
  await expect(strip).toBeVisible();
  await expect(strip.getByTestId("money-step")).toHaveText(expected);
  const steps = moneySteps((await flow.booking()) as unknown as Parameters<typeof moneySteps>[0]);
  expect(steps?.map((s) => s.label)).toEqual(expected);
  await expect(strip).toHaveAttribute("aria-label", moneyLine(steps!));
}
