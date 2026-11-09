/**
 * Only the host's browser can act on a booking. Without the host's booking secret every route
 * that approves, captures, voids, edits the charge or sends evidence answers 401 (no secret) or
 * 403 (wrong secret), and PayPal is never called.
 */
import { expect, test, type APIRequestContext } from "@playwright/test";
import { kitStatus, renterAccepts, toProposal, type Flow } from "./booking-flow";

const ACTIONS: { method: "post" | "get"; path: string; data?: object }[] = [
  { method: "post", path: "settle", data: { chargeCents: 100 } },
  { method: "post", path: "settle", data: { release: true } },
  { method: "post", path: "part-capture" },
  { method: "post", path: "release" },
  { method: "post", path: "lines", data: { lines: [] } },
  { method: "post", path: "propose" },
  { method: "post", path: "review" },
  { method: "post", path: "photos", data: { slot: "check_out" } },
  { method: "post", path: "limit-test" },
  { method: "post", path: "host-link" },
  { method: "post", path: "dispute" },
  { method: "post", path: "dispute/evidence" },
  { method: "get", path: "evidence" },
];

async function paypalCalls(flow: Flow, request: APIRequestContext) {
  const { events } = (await (await request.get(`/api/bookings/${flow.id}/activity`)).json()) as { events: { paypal?: { operation: string; path: string } }[] };
  return events.flatMap((e) => (e.paypal ? [`${e.paypal.operation} ${e.paypal.path}`] : []));
}

test("without the host's booking secret nothing can be approved, captured, voided or sent, and PayPal is never called", async ({ page, request, browser }) => {
  const flow = await toProposal(page, request, { item: "Harbor loft, weekend of Dec 18" });
  await renterAccepts(page, await flow.booking());
  const before = await paypalCalls(flow, request);
  expect(before.length).toBeGreaterThan(0);

  // `request` is a separate client with none of the host's cookies.
  for (const action of ACTIONS) {
    const url = `/api/bookings/${flow.id}/${action.path}`;
    const none = await request[action.method](url, action.data ? { data: action.data } : {});
    expect(none.status(), `${action.method} ${action.path} with no secret`).toBe(401);
    const wrong = await request[action.method](url, { ...(action.data ? { data: action.data } : {}), headers: { "x-booking-secret": "not-the-hosts-secret-at-all" } });
    expect(wrong.status(), `${action.method} ${action.path} with the wrong secret`).toBe(403);
  }
  expect((await flow.booking()).status).toBe("proposed");
  expect((await flow.booking()).settlement).toBeUndefined();
  // None of it reached PayPal, not even a read.
  expect(await paypalCalls(flow, request)).toEqual(before);

  // Someone with the booking's link sees no renter link and no secret.
  const seen = await (await request.get(`/api/bookings/${flow.id}`)).json();
  expect(seen.viewer).toBe("visitor");
  expect(seen).not.toHaveProperty("renterToken");
  expect(JSON.stringify(seen)).not.toContain("hostSecret");
  const visitor = await browser.newContext({ baseURL: new URL(page.url()).origin });
  const other = await visitor.newPage();
  await other.goto(`/bookings/${flow.id}`);
  await expect(other.getByTestId("visitor-note")).toBeVisible();
  await expect(other.getByTestId("renter-link")).toHaveCount(0);
  await visitor.close();
  expect((await flow.booking()).viewer).toBe("host");

  // The host asks for approval. A stranger can't answer it; the host can.
  await page.getByTestId("request-approval").click();
  await expect(page.getByTestId("approval-prompt")).toBeVisible({ timeout: 30_000 });
  const approvalId = (await flow.booking()).approval!.id;
  // The host's own request read the hold before the prompt; take the list from here.
  const asked = await paypalCalls(flow, request);
  const none = await request.post(`/api/agent/approvals/${approvalId}`, { data: { decision: "approved" } });
  expect(none.status()).toBe(401);
  const wrong = await request.post(`/api/agent/approvals/${approvalId}`, { data: { decision: "approved" }, headers: { "x-booking-secret": "not-the-hosts-secret-at-all" } });
  expect(wrong.status()).toBe(403);
  expect((await flow.booking()).status).toBe("awaiting_approval");
  // Nothing new went to PayPal from either attempt.
  expect(await paypalCalls(flow, request)).toEqual(asked);

  await page.getByTestId("approve-button").click();
  await expect(page.getByTestId("ruling")).toBeVisible({ timeout: 60_000 });
  expect((await paypalCalls(flow, request)).some((c) => /capture/i.test(c))).toBe(true);
});

test("no visitor's copy of a booking carries the renter's link, samples included; the host's does", async ({ page, request }) => {
  // A booking made in this browser: the host gets the renter's link, a visitor gets no such field.
  await page.goto("/bookings");
  await page.getByLabel("What's being rented").fill("Harbor loft, weekend of Dec 25");
  await page.getByLabel("Renter").fill("Test Renter");
  await page.getByTestId("create-booking").click();
  await page.waitForURL(/\/bookings\/bk_/);
  const id = new URL(page.url()).pathname.split("/").pop()!;
  const host = await (await page.request.get(`/api/bookings/${id}`)).json();
  expect(host.viewer).toBe("host");
  expect(host.renterToken).toMatch(/^[0-9a-f-]{36}$/);
  const raw = await (await request.get(`/api/bookings/${id}`)).text();
  expect(raw).not.toContain("renterToken");
  expect(raw).not.toContain(host.renterToken);
  // The sample route never opens a real booking's renter page.
  expect((await request.get(`/renter/sample/${id}`, { maxRedirects: 0 })).status()).toBe(404);

  // Every sample, read by a visitor: no renterToken either. A local sandbox run has no samples.
  const { sandbox } = await kitStatus(request);
  if (!sandbox) expect((await request.post("/api/dev/seed")).ok()).toBe(true);
  const { bookings } = (await (await request.get("/api/bookings")).json()) as { bookings: { id: string; sample?: boolean }[] };
  const samples = bookings.filter((b) => b.sample).map((b) => b.id);
  if (sandbox && !process.env.E2E_BASE_URL) return;
  expect(samples.length).toBeGreaterThan(0);
  for (const sample of samples) {
    const text = await (await request.get(`/api/bookings/${sample}`)).text();
    expect(text, sample).not.toContain("renterToken");
  }

  // A sample says plainly where its renter view is, and the link opens it.
  const sample = samples.includes("bk_sample_lakeside") ? "bk_sample_lakeside" : samples[0];
  const jump = await request.get(`/renter/sample/${sample}`, { maxRedirects: 0 });
  expect(jump.status()).toBe(307);
  expect(jump.headers().location).toMatch(/^\/renter\/[0-9a-f-]{36}$/);
  await page.goto(`/bookings/${sample}`);
  const link = page.getByTestId("sample-renter-link");
  await expect(link).toHaveText("Open the renter’s view (sample)");
  const [renter] = await Promise.all([page.context().waitForEvent("page"), link.click()]);
  await expect(renter.getByTestId("renter-headline")).toBeVisible();
  await renter.close();
});
