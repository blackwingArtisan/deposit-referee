/** When the AI can't run, the host is told plainly, the money stays put, and trying again works. */
import { expect, test, type APIRequestContext } from "@playwright/test";
import { kitStatus, toPhotos, type Flow } from "./booking-flow";

async function moneyUntouched(request: APIRequestContext, flow: Flow) {
  const { authorizationId } = await flow.booking();
  const { entries } = (await (await request.get("/api/paypal/ledger")).json()) as { entries: { paypalId: string; kind: string; status: string }[] };
  expect(entries.find((entry) => entry.paypalId === authorizationId)?.status).toBe("CREATED");
  expect((await flow.booking()).settlement).toBeUndefined();
}

test("out of AI credit: the host sees why, no money moves, and a retry works", async ({ page, request }) => {
  const status = await kitStatus(request);
  test.skip(status.sandbox || status.live, "The switch only exists on mock PayPal with mock AI");
  const flow = await toPhotos(page, request);
  const creditOut = (step: "review" | "agent" | null) => request.post("/api/dev/ai-credit", { data: { bookingId: flow.id, step } });
  const error = page.getByTestId("booking-error");
  const message = /out of credit, so this step didn't run\. No money moved, and the deposit is still on hold\./;

  // The photo comparison can't run: the booking stays where it was.
  await creditOut("review");
  await page.getByTestId("run-review").click();
  await expect(error).toHaveText(message);
  await expect(page.getByTestId("run-review")).toBeEnabled();
  await page.screenshot({ path: "screenshots/ai-credit-review.png", fullPage: true });
  expect((await flow.booking()).status).toBe("held");
  await expect(page.getByTestId("hold-panel")).toContainText("nothing charged");
  await moneyUntouched(request, flow);

  // The comparison ran, then the agent couldn't.
  await creditOut("agent");
  await page.getByTestId("run-review").click();
  await expect(page.getByTestId("review")).toBeVisible();
  await expect(error).toHaveText(message);
  await page.screenshot({ path: "screenshots/ai-credit-agent.png", fullPage: true });
  expect((await flow.booking()).status).toBe("reviewed");
  await moneyUntouched(request, flow);

  // Credit is back, and the same booking carries on.
  await creditOut(null);
  await page.getByTestId("ask-agent").click();
  await expect(page.getByTestId("ai-proposal")).toBeVisible();
  await expect(error).toHaveCount(0);
  await moneyUntouched(request, flow);
});
