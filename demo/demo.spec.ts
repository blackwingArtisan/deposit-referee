/**
 * The demo video (npm run demo:record): a booking, the renter placing the hold from their own page
 * on a phone, Claude comparing the photos, the renter accepting one item and contesting the other
 * with their own photo, the approval card and the first capture, Claude's second look at what was
 * contested, the counter the renter accepts, the settlement, every PayPal call, and an end card
 * read back from PayPal. A caption is on screen in every frame. Saves a .webm to videos/, its edit
 * list, and the voiceover script (videos/voiceover.json: [{ shot, at, text }], `at` in seconds of
 * the edited video). For PayPal's real card form, record on the sandbox:
 * DEMO_BASE_URL=https://deposit-referee.onrender.com records the hosted site with live AI;
 * DEMO_PAYPAL_MODE=sandbox records a local one. The captions follow the modes /api/kit/status
 * reports, so a mock run says it is one. For the take judges see, add DEMO_REQUIRE_LIVE=1: the run
 * then fails if any frame shows mock or simulated text (live-guard.ts).
 */
import { expect, test, type FrameLocator, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { shortName } from "../src/lib/deposit/conversation";
import type { ChargeLine } from "../src/lib/deposit/types";
import { BAND_PX, caption, closePhone, DemoClock, highlight, openPhone, titleCard, zoomOn, zoomPhone } from "./captions";
import { damageNamed, damageNotShown } from "./damage-words";
import { LiveGuard } from "./live-guard";
import { fitVoiceover, type VoiceLine } from "./voiceover";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const whole = (cents: number) => `$${(cents / 100).toFixed(cents % 100 ? 2 : 0)}`;
/** A caption that stays up until the next one replaces it, so no frame is left without one. */
const STAY = 10 * 60_000;
let guard: LiveGuard | null = null;
/** Everything the AI's findings say, once they're on screen. A caption may only name damage in here. */
let findingsText = "";
const CUTS_FILE = "test-results/demo/cuts.json";
const VOICE_FILE = "test-results/demo/voiceover.json";
const DEMO_PHOTOS = path.join(process.cwd(), "public", "demo-photos");
const say = async (page: Page, text: string, readMs = 0) => {
  const unshown = damageNotShown(text, findingsText);
  if (unshown.length) throw new Error(`The caption "${text}" names ${unshown.join(", ")}, which the findings on screen don't: ${findingsText.slice(0, 200) || "(none yet)"}`);
  await caption(page, text, { ms: STAY, wait: false });
  await guard?.check(`caption "${text.slice(0, 40)}"`);
  await sleep(readMs);
};

async function tap(page: Page, testId: string) {
  const target = page.getByTestId(testId).first();
  await target.scrollIntoViewIfNeeded();
  await highlight(page, target, 900);
  await target.click();
}

/** How long the approval card stays on screen before the host clicks Approve. */
const APPROVAL_HOLD_MS = 4_000;
/** How long the renter's contest stays on the phone, and the PayPal calls stay open. */
const CONTEST_HOLD_MS = 4_000;
const CALLS_HOLD_MS = 5_000;

/** The most PayPal's card form (or the mock's stand-in) may be on screen in the edited video. */
const FORM_ON_CAMERA_S = 3;
/** The edited video's limit. */
const CUT_LIMIT_S = 120;

/**
 * The renter fills PayPal's own card form (an iframe inside the renter's page), with PayPal's
 * sandbox test card. The form's loading and most of its filling-in are cut from the video.
 * Returns when the form opened (raw seconds), so the caller can time it on camera.
 */
async function payInPayPal(phone: FrameLocator, clock: DemoClock): Promise<number> {
  // PayPal's button can take a moment to wire up after it draws, so click until its form opens.
  // All of that loading is cut.
  const form = phone.frameLocator('iframe[src*="/smart/card-fields"]');
  await clock.cut("PayPal's card form loading", async () => {
    const frames = phone.locator('iframe[src*="/smart/card-fields"]');
    const button = phone.getByTestId("paypal-guest-button").locator("paypal-basic-card-button");
    await button.waitFor({ state: "visible", timeout: 30_000 });
    await sleep(1_500);
    for (let i = 0; i < 4 && !(await frames.count()); i++) {
      await button.click({ timeout: 30_000 });
      await frames.first().waitFor({ state: "attached", timeout: 5_000 }).catch(() => {});
    }
    await form.getByLabel("Email").waitFor({ state: "visible", timeout: 30_000 });
  });
  const opened = clock.raw;
  await sleep(900);
  await clock.cut("PayPal's card form filling in", async () => {
  await form.getByLabel("Email").fill("renter@example.com");
  await form.getByLabel("Card number").fill("4111111111111111");
  await form.getByLabel("Expires").fill("12/30");
  await form.getByLabel("CSC").fill("123");
  await form.getByLabel("First name").fill("Alex");
  await form.getByLabel("Last name").fill("Rivera");
  await form.getByLabel("Street address").fill("1 Main St");
  await form.getByLabel("City").fill("Austin");
  await form.getByLabel("State").selectOption("TX");
  await form.getByLabel(/ZIP/i).fill("78701");
  const mobile = form.getByLabel(/Mobile|Phone/i).first();
  if (await mobile.isVisible().catch(() => false)) await mobile.fill("5125550100");
  }, 600);
  await form.getByRole("button", { name: /^Pay \$/ }).click();
  return opened;
}

/** The dollar amounts in a piece of on-screen text, in order. */
const amountsIn = (text: string) => [...text.matchAll(/\$[\d,]+(?:\.\d\d)?/g)].map((m) => m[0].replace(/\.00$/, ""));

/** What Claude's second look found, said aloud, from the verdict on screen. */
function spokenVerdict(line: { verdict: string; fromCents: number; toCents: number }) {
  if (line.verdict === "already_there") return "it was already there";
  if (line.verdict === "unsure") return "it can't stand behind that charge";
  if (line.toCents < line.fromCents) return "it's smaller than first priced";
  return "the charge stands";
}

test("demo", async ({ page, request }) => {
  const clock = new DemoClock(CUT_LIMIT_S);
  fs.rmSync(CUTS_FILE, { force: true });
  fs.rmSync(VOICE_FILE, { force: true });
  findingsText = "";
  guard = new LiveGuard(page);
  const voice: VoiceLine[] = [];
  /** The voiceover for shot `shot` starts now (or at `at`); the first line that fits is kept. */
  const vo = (shot: number, lines: string[], at = clock.exact) => voice.push({ shot, at, lines });
  const check = async (scene: string) => {
    clock.check(scene);
    await guard?.check(scene);
  };
  // Mock mode starts clean and seeds here. On the sandbox the config has already seeded, and the
  // hosted site seeds itself on start; these routes are mock-only, so there they do nothing.
  await request.post("/api/dev/reset");
  await request.post("/api/dev/seed");
  const status = await (await request.get("/api/kit/status")).json();
  const sandbox = status.paypal.mode === "sandbox";
  const liveAI = status.ai.mode === "live";
  // A mock run says so in every caption that names PayPal, so no mock screen is captioned as the real thing.
  const pp = sandbox ? "PayPal" : "mock PayPal";
  console.log(`[demo] PayPal ${status.paypal.mode}, AI ${status.ai.mode}`);
  guard.start();

  // 1. Open: a title card the edit lines its cuts up on (the white page going dark), then the problem.
  await page.goto("/");
  await expect(page.getByTestId("landing-headline")).toBeVisible();
  clock.sync();
  vo(1, [
    "A guest leaves a gouge in your cabin floor and says it was already there. If you rent from your own website, there's no platform to settle it for you.",
    "A guest damages your cabin and says it was already there. Rent from your own site, and nobody settles it.",
  ]);
  await titleCard(page, "Deposit Referee", "Damage deposits settled from two photos, with PayPal holding the money", 2200);
  await say(page, "More than half of hosts have had a guest damage their place. Rent from your own site, and nobody settles it.", 5600);
  await check("open");

  // 2. The booking.
  await page.goto("/bookings");
  vo(2, [
    `The host books the cabin and asks for a $300 deposit. The renter gets a link, and the host never touches a card number.`,
    "The host asks for a $300 deposit. The renter gets a link.",
  ]);
  await say(page, "The host books the cabin and asks for a $300 deposit.");
  await page.getByLabel("What's being rented").pressSequentially("Cedar cabin, weekend of Nov 13", { delay: 16 });
  await page.getByLabel("Renter").pressSequentially("Alex Rivera", { delay: 22 });
  await tap(page, "create-booking");
  await page.waitForURL(/\/bookings\/bk_/);
  const id = new URL(page.url()).pathname.split("/").pop()!;
  await check("booking");

  // The host waits; the renter places the hold from their own page, on their phone.
  await expect(page.getByTestId("waiting-headline")).toBeVisible();
  await highlight(page, page.getByTestId("waiting-for-hold"), 1400);
  await say(page, "The host's page waits for the renter's hold. The host never sees a card form.", 3400);
  const { renterToken } = await (await page.request.get(`/api/bookings/${id}`)).json();
  vo(3, sandbox
    ? ["They place a $300 hold in PayPal's own card form. It's an authorization: nothing is charged.", "A $300 hold in PayPal's own card form. Nothing is charged."]
    : ["They place a $300 hold with mock PayPal. It's an authorization: nothing is charged.", "A $300 hold. Nothing is charged."]);
  const renter = await openPhone(page, `/renter/${renterToken}`);
  await expect(renter.getByTestId("renter-headline")).toHaveText("Place your $300 deposit hold", { timeout: 20_000 });
  await say(page, `The renter opens their link and places a $300 hold with ${pp}. Nothing is charged.`, 2000);
  // PayPal's card form (or the mock's stand-in) is on camera for at most 3 seconds of the edit.
  let formOpened: number;
  if (sandbox) {
    await say(page, "PayPal's own card form, with PayPal's sandbox test card.");
    formOpened = await payInPayPal(renter, clock);
  } else {
    await renter.getByTestId("simulate-paypal-approval").click();
    await expect(renter.getByTestId("mock-approve")).toBeVisible();
    formOpened = clock.raw;
    await say(page, "Mock PayPal's stand-in for the card form. The sandbox take shows PayPal's own.", 2_200);
    await renter.getByTestId("mock-approve").click();
  }
  const held = renter.getByTestId("renter-hold-headline");
  await clock.cut("the hold on its way", () => expect(held).toHaveText("$300 authorized, nothing charged", { timeout: 45_000 }));
  const formS = clock.onCamera(formOpened, clock.raw);
  console.log(`[demo] card form on camera ${formS.toFixed(1)}s`);
  expect(formS, `the card form is on camera at most ${FORM_ON_CAMERA_S} s`).toBeLessThanOrEqual(FORM_ON_CAMERA_S);
  // Zoomed in on the hold, so it reads at video size.
  await zoomPhone(page, renter.getByTestId("renter-hold"), 1.8);
  await say(page, "$300 authorized, nothing charged.", 1800);
  await closePhone(page);
  const authId = page.getByTestId("hold-authorization-id");
  await clock.cut("the host's page catching up", () => expect(authId).toHaveText(/\w{10,}/, { timeout: 45_000 }));
  const authorizationId = (await authId.textContent())!.trim();
  await authId.scrollIntoViewIfNeeded();
  vo(4, [
    `The host's page reads the authorization back from ${pp}: guaranteed for 3 days, and capturable until day 29.`,
    `The host's page reads it back from ${pp}: guaranteed 3 days, capturable until day 29.`,
    `The host's page reads the authorization back from ${pp}.`,
  ]);
  await highlight(page, authId, 3000);
  await say(page, `The host's page picks it up: ${pp} authorization ${authorizationId}, guaranteed 3 days, capturable until day 29.`, 5000);
  await check("hold");

  // 3. The comparison: the host uploads the two photos, captioned while Claude works.
  const photosAt = clock.exact;
  await say(page, "After the stay, the host adds the check-in and check-out photos.");
  await page.getByTestId("upload-photo-check_in").setInputFiles(path.join(DEMO_PHOTOS, "cabin-check-in.jpg"));
  await expect(page.getByTestId("photo-source")).toHaveCount(1, { timeout: 20_000 });
  await page.getByTestId("upload-photo-check_out").setInputFiles(path.join(DEMO_PHOTOS, "cabin-check-out-two.jpg"));
  await expect(page.getByTestId("photo-source")).toHaveCount(2, { timeout: 20_000 });
  await sleep(600);
  await tap(page, "run-review");
  await say(page, liveAI ? "Claude Sonnet 5.5 compares the two photos and boxes only what's new. Each step shows as it happens." : "Mock AI: a recorded comparison stands in for Claude, who boxes only what's new.");
  const proposal = page.getByTestId("ai-proposal");
  // Claude's work stays on camera for a few seconds; the rest of the wait is cut.
  await clock.cut("Claude comparing and the agent proposing", () => expect(proposal).toBeVisible({ timeout: 120_000 }), 3_000);
  // Every caption from here names damage only as the findings on screen do.
  const view = await (await page.request.get(`/api/bookings/${id}`)).json();
  const lines = view.proposal.lines as ChargeLine[];
  findingsText = [view.review?.reasoning ?? "", ...lines.map((l) => `${l.description} ${l.price?.type ?? ""} ${damageNamed(l)}`)].join(" ");
  // By what each line is, never by position (live AI lists the marks in either order): the renter
  // contests the stain with their check-in close-up and accepts the other mark.
  const isStain = (line: ChargeLine) => (line.price ? line.price.type === "stain" : /stain/i.test(line.description));
  const contestedLines = lines.filter(isStain);
  const accepted = lines.find((line) => !isStain(line))!;
  expect(contestedLines.length === 1 && !!accepted && lines.length === 2, `the two-marks photo should give the stain and one other mark; the review found ${lines.map((l) => l.price?.type ?? "unpriced").join(", ")}`).toBe(true);
  const named = (l: (typeof lines)[number]) => shortName(l).toLowerCase();
  const acceptedName = named(accepted);
  const contestedName = contestedLines.map(named).join(" and ");
  const acceptedCents = accepted.amountCents;
  const contestedCents = contestedLines.reduce((sum, l) => sum + l.amountCents, 0);
  const marks = `${lines.length === 2 ? "two" : lines.length} new marks, ${lines.map((l) => `a ${named(l)}`).join(" and ")}`;
  vo(5, [
    `After the stay, the host adds the check-in and check-out photos. Claude compares them and boxes only what's new: ${marks}.`,
    `The host adds the two photos. Claude boxes only what's new: ${marks}.`,
  ], photosAt);
  // The finished steps fold to one line each; open the photos to show the boxes.
  await page.getByTestId("fold-photos").locator("summary").click();
  await say(page, `${marks[0].toUpperCase()}${marks.slice(1)}.`);
  await zoomOn(page, page.getByTestId("damage-box").first(), { scale: 2.4, ms: 2600 });
  await page.getByTestId("fold-photos").locator("summary").click();
  vo(6, [
    `The prices come from a table in code, not from the model. ${whole(acceptedCents)} for the ${acceptedName}, ${whole(contestedCents)} for the ${contestedName}. The agent proposes and stops: it has no tool that can move money.`,
    `Prices come from a table in code. The agent proposes ${whole(acceptedCents + contestedCents)} and stops: it can't move money.`,
    "Prices come from a table in code. The agent proposes and stops; it can't move money.",
  ]);
  await say(page, liveAI ? "The settlement agent prices each one from the price table, proposes, and stops." : "The agent's scripted stand-in prices each one from the price table, proposes, and stops.");
  await page.screenshot({ path: "docs/screenshot.png", style: "#__demo_caption { display: none !important; } body { padding-bottom: 0 !important; }" });
  await proposal.scrollIntoViewIfNeeded();
  await highlight(page, proposal, 1800);
  await say(page, `${whole(acceptedCents)} for the ${acceptedName}, ${whole(contestedCents)} for the ${contestedName}. It has no tool that can move money.`, 6000);
  await check("proposal");

  // 4. The renter, on their phone: accepts the first item, contests the rest with their own photo.
  vo(7, [
    `The renter sees the same evidence on their phone. They accept the ${acceptedName}, and contest the ${contestedName} with their own photo from check-in.`,
    `On their phone, the renter accepts the ${acceptedName} and contests the ${contestedName}, with their own photo.`,
  ]);
  const phone = await openPhone(page, `/renter/${view.renterToken}`);
  await expect(phone.getByTestId("renter-summary")).toBeVisible({ timeout: 20_000 });
  await say(page, "The renter gets a link: what's held, what's proposed, and one card per item.", 2400);
  await phone.getByTestId(`line-accept-${accepted.id}`).scrollIntoViewIfNeeded();
  await say(page, `They accept the ${acceptedName} and contest the ${contestedName}, with their own photo from check-in.`);
  await phone.getByTestId(`line-accept-${accepted.id}`).click();
  for (const line of contestedLines) await phone.getByTestId(`line-contest-${line.id}`).click();
  await phone.getByTestId(`evidence-upload-${contestedLines[0].id}`).setInputFiles(path.join(DEMO_PHOTOS, "renter-check-in-stain.jpg"));
  const preview = phone.getByTestId(`evidence-preview-${contestedLines[0].id}`);
  await expect(preview).toBeVisible();
  await preview.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await sleep(1200);
  await phone.getByTestId("contest-note").pressSequentially(`The ${contestedName} was there when I arrived. My photo shows it.`, { delay: 12 });
  await phone.getByTestId("contest").click();
  const contested = phone.getByTestId("renter-contested");
  await expect(contested).toBeVisible({ timeout: 20_000 });
  // The renter's answer stays on the phone for 4 seconds.
  const contestShown = Date.now();
  await contested.evaluate((el) => el.scrollIntoView({ block: "center" }));
  // Zoomed in, so the renter's answer reads at video size.
  await zoomPhone(page, contested, 1.7);
  await say(page, `Their answer goes to the host: ${whole(acceptedCents)} accepted, ${whole(contestedCents)} contested, with their note and photo.`);
  await sleep(Math.max(0, CONTEST_HOLD_MS - (Date.now() - contestShown)));
  const contestMs = Date.now() - contestShown;
  console.log(`[demo] renter contest held ${(contestMs / 1000).toFixed(1)}s`);
  expect.soft(contestMs, "the renter's contest stays on the phone 4 s").toBeGreaterThanOrEqual(CONTEST_HOLD_MS);
  await closePhone(page);
  await check("contest");

  // 5. The first capture: the accepted part now, the contested part stays on the same hold.
  const prompt = page.getByTestId("approval-prompt");
  vo(8, [
    `The ${whole(acceptedCents)} they accepted can be charged now, once the host approves. ${pp} captures it with final capture false, so the contested ${whole(contestedCents)} stays on the same hold.`,
    `The host approves the ${whole(acceptedCents)} they accepted. The contested ${whole(contestedCents)} stays on the same hold.`,
  ]);
  await say(page, `The ${whole(acceptedCents)} they accepted can be charged now. Nothing moves until the host approves.`);
  await clock.cut("the approval card on its way", () => expect(prompt).toBeVisible({ timeout: 30_000 }), 1_500);
  // The approval card is held on screen for 4 seconds: each line, the renter's answer and the Guard's reason.
  await prompt.evaluate((el) => el.scrollIntoView({ block: "center" }));
  const cardShown = Date.now();
  await highlight(page, prompt, 1600);
  await say(page, `Each line with its price row and the renter's answer. ${await prompt.getByTestId("approval-money").textContent()}.`);
  await sleep(Math.max(0, APPROVAL_HOLD_MS - (Date.now() - cardShown)));
  await highlight(page, prompt.getByTestId("approve-button"), 900);
  console.log(`[demo] approval card held ${((Date.now() - cardShown) / 1000).toFixed(1)}s`);
  await prompt.getByTestId("approve-button").click();
  await say(page, `Approved. ${pp} captures the ${whole(acceptedCents)} the renter accepted.`);
  const part = page.getByTestId("part-capture");
  await clock.cut("the capture on its way", () => expect(part).toContainText(`${whole(acceptedCents)}`, { timeout: 60_000 }), 1_000);
  await part.scrollIntoViewIfNeeded();
  await highlight(page, part, 2400);
  await say(page, `Captured with final_capture false, so the contested ${whole(contestedCents)} stays on the same ${pp} hold.`, 3400);
  await check("part");

  // 6. Claude's second look at what the renter contested, with their photo and note. The charge can only fall.
  const look = page.getByTestId("second-look");
  await look.scrollIntoViewIfNeeded();
  const lookAt = clock.exact;
  await say(page, liveAI ? `Claude looks again at the ${contestedName}, with the renter's photo and note. It can only lower a charge.` : `Mock AI: a recorded second look at the ${contestedName}, with the renter's photo. It can only lower a charge.`);
  await clock.cut("Claude's second look", () => expect(look).toHaveAttribute("data-status", "ready", { timeout: 120_000 }), 1_200);
  const afterLook = await (await page.request.get(`/api/bookings/${id}`)).json();
  const lookLines = afterLook.secondLook.lines as { lineId: string; verdict: string; reasoning: string; fromCents: number; toCents: number; description: string }[];
  findingsText += ` ${lookLines.map((l) => `${l.description} ${l.reasoning}`).join(" ")}`;
  const verdictShown = (await look.getByTestId("second-look-verdict").first().textContent())!.trim();
  const [lookFrom, lookTo] = amountsIn((await look.getByTestId("second-look-total").textContent())!);
  const heard = spokenVerdict(lookLines[0]);
  vo(9, [
    `Claude takes a second look at the ${contestedName} with the renter's photo: ${heard}. The total falls from ${lookFrom} to ${lookTo}.`,
    `A second look with the renter's photo: ${heard}. ${lookFrom} becomes ${lookTo}.`,
    `Claude looks again: ${heard}. ${lookFrom} becomes ${lookTo}.`,
  ], lookAt);
  if (lookTo === lookFrom) voice.at(-1)!.lines = [`Claude takes a second look at the ${contestedName} with the renter's photo: ${heard}.`, `A second look with the renter's photo: ${heard}.`, `Claude looks again: ${heard}.`];
  const box = look.getByTestId("damage-box").first();
  await say(page, `Claude's second look: ${verdictShown}.`);
  await zoomOn(page, box, { scale: 2.2, ms: 3000 });
  const total = look.getByTestId("second-look-total");
  await total.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await highlight(page, total, 2200);
  await say(page, lookTo === lookFrom ? `The total stays at ${lookTo}.` : `The total charge falls from ${lookFrom} to ${lookTo}. The model sets no amount: code maps its verdict.`, 1800);
  vo(10, [
    "The agent sends the renter a counter, and they accept it on their phone.",
    "The renter accepts the counter.",
  ]);
  // The take's story is a charge that falls. If Claude kept the stain this time, the card says so
  // and there is no offer to send: stop with the reason rather than record a broken beat.
  expect(lookTo !== lookFrom, `Claude's second look kept the ${contestedName} at ${lookTo} on this take (${verdictShown}); the demo needs the charge to fall. Rerun the take.`).toBe(true);
  await tap(page, "send-counter");
  await expect(look.getByTestId("counter-sent")).toBeVisible({ timeout: 20_000 });
  await say(page, `The agent's new offer goes to the renter: ${lookTo} in all.`);
  await check("second look");

  // 7. The renter accepts the counter on their phone; the host approves the rest.
  const phone2 = await openPhone(page, `/renter/${view.renterToken}`);
  const counter = phone2.getByTestId("renter-counter");
  await expect(counter).toBeVisible({ timeout: 20_000 });
  await counter.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await zoomPhone(page, counter, 1.5);
  await say(page, "The renter reads the new offer on their phone and accepts it.", 1600);
  await phone2.getByTestId("accept-counter").click();
  await expect(phone2.getByTestId("renter-counter-accepted")).toBeVisible({ timeout: 20_000 });
  await sleep(1400);
  await closePhone(page);
  await say(page, `The host approves. ${pp} settles the rest of the same hold.`);
  await clock.cut("the approval card on its way", () => expect(prompt).toBeVisible({ timeout: 30_000 }), 800);
  await prompt.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await highlight(page, prompt.getByTestId("approve-button"), 900);
  await prompt.getByTestId("approve-button").click();
  const ruling = page.getByTestId("ruling-headline");
  await clock.cut("the settlement on its way", () => expect(ruling).toBeVisible({ timeout: 60_000 }), 800);
  await sleep(400);
  await ruling.scrollIntoViewIfNeeded();
  const done = await (await page.request.get(`/api/bookings/${id}`)).json();
  const captured = whole(done.settlement.capturedCents);
  const released = whole(done.settlement.releasedCents);
  await expect(ruling).toHaveText(`${captured} captured, ${released} released`);
  vo(11, [
    `${captured} captured, ${released} released, read back from ${pp}.`,
  ]);
  await zoomOn(page, ruling, { scale: 1.4, ms: 2400 });
  // The money in one line, each amount as PayPal returned it, held on screen.
  const strip = page.getByTestId("money-strip");
  await expect(strip).toBeVisible();
  const stripText = (await strip.getAttribute("aria-label"))!;
  await say(page, `${stripText}: each amount as ${pp} returned it.`);
  await highlight(page, strip, 2600);
  // The outline is fixed on the page: let it fade before the page scrolls to the calls.
  await sleep(2000);
  await check("ruling");

  // 8. Every PayPal call, open with the capture and void rows on screen together.
  const toggle = page.getByTestId("paypal-calls-toggle");
  await toggle.scrollIntoViewIfNeeded();
  await toggle.click();
  const toggledAt = Date.now();
  const calls = page.getByTestId("paypal-calls");
  await expect(calls).toContainText(/authoriz/i);
  await expect(calls).toContainText(/void/i);
  const callsOpened = Date.now();
  const row = (title: string) => calls.locator("li[data-paypal-call]").filter({ hasText: title });
  const capture = row("Capture authorization").last();
  const voided = row("Void authorization").last();
  await expect(capture).toContainText(/HTTP 20\d/);
  await expect(capture).toContainText("debug_id");
  await expect(voided).toContainText(/HTTP 20\d/);
  await expect(voided).toContainText("debug_id");
  const captures = done.settlement.captureId && done.settlement.captureId !== done.partCapture?.captureId ? "both captures" : "the capture";
  vo(12, [
    `Every ${pp} call on this booking is listed: the authorization, ${captures} and the void, each with its status and debug id.`,
    `Every ${pp} call is listed, with its status and debug id.`,
  ]);
  await say(page, `Every ${pp} call on this booking: the authorization, ${captures} and the void, each with its HTTP status and debug_id.`);
  // The list scrolls inside its card: put the last capture at the top of it, so the void sits
  // below it, then centre the card on the page. Both rows have to show inside the list. When a
  // re-read sits between them, the list grows (on camera only) just enough to show both.
  // For 2 s after the toggle the page keeps the result in view whenever the list changes size
  // (ruling.tsx), so grow and scroll the list only after that.
  await sleep(Math.max(0, 2_100 - (Date.now() - toggledAt)));
  const voidHandle = await voided.elementHandle();
  const inList = await capture.evaluate((el, [end, band]) => {
    let list = el.parentElement;
    while (list && !(list.scrollHeight > list.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(list).overflowY))) list = list.parentElement;
    if (!list) return null;
    const span = (end as HTMLElement).getBoundingClientRect().bottom - el.getBoundingClientRect().top + 8;
    if (span > list.clientHeight) {
      // More re-reads than fit between the two rows: draw the list a little smaller (on camera only)
      // rather than leave the void below the caption band.
      // Centred, the list must end above the caption band.
      const room = window.innerHeight - 2 * band - 16;
      const zoom = span > room ? room / span : 1;
      if (zoom < 1) list.style.zoom = zoom.toFixed(3);
      list.style.maxHeight = `${Math.min(span, zoom < 1 ? span : room)}px`;
      // Room below, so the page (or the pane that scrolls it) can scroll the grown list clear of the caption band.
      let pane = list.parentElement;
      while (pane && !(pane.scrollHeight > pane.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(pane).overflowY))) pane = pane.parentElement;
      const spacer = document.createElement("div");
      spacer.style.height = "600px";
      (pane ?? document.body).appendChild(spacer);
    }
    // A few passes, so the scroll lands whether the browser counts it before or after the zoom.
    const z = Number(list.style.zoom || 1);
    for (let i = 0; i < 4; i++) list.scrollTop += (el.getBoundingClientRect().top - (list.getBoundingClientRect().top + 2)) / z;
    list.scrollIntoView({ block: "center" });
    const box = list.getBoundingClientRect();
    return { top: box.top, bottom: box.bottom };
  }, [voidHandle, BAND_PX] as const);
  expect(inList, "the PayPal calls list scrolls inside its card").not.toBeNull();
  await sleep(300);
  const listBox = await capture.evaluate((el) => {
    let list = el.parentElement;
    while (list && !(list.scrollHeight > list.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(list).overflowY))) list = list.parentElement;
    const box = list!.getBoundingClientRect();
    return { top: box.top, bottom: box.bottom };
  });
  expect(listBox.bottom, "the PayPal calls list ends above the caption band").toBeLessThanOrEqual(page.viewportSize()!.height - BAND_PX + 1);
  for (const [name, rowEl] of [["capture", capture], ["void", voided]] as const) {
    const b = (await rowEl.boundingBox())!;
    console.log(`[demo] ${name} row ${Math.round(b.y)}-${Math.round(b.y + b.height)}, list ${Math.round(listBox.top)}-${Math.round(listBox.bottom)}`);
    expect(b.y, `${name} row starts inside the list`).toBeGreaterThanOrEqual(listBox.top - 1);
    // A row ends in 16px of empty padding (pb-4) under its card, which may fall below the list's edge.
    expect(b.y + b.height - 16, `${name} row's card ends inside the list`).toBeLessThanOrEqual(listBox.bottom + 1);
  }
  await Promise.all([highlight(page, capture, 2600), highlight(page, voided, 2600)]);
  await sleep(Math.max(0, CALLS_HOLD_MS - (Date.now() - callsOpened)));
  const callsMs = Date.now() - callsOpened;
  console.log(`[demo] PayPal calls open ${(callsMs / 1000).toFixed(1)}s`);
  expect.soft(callsMs, "the PayPal calls stay open 3 to 5 s").toBeGreaterThanOrEqual(3_000);
  await check("calls");

  // 9. The end card, from the amounts PayPal returned.
  vo(13, [`Deposit Referee. Two photos, a fair charge, and ${pp} holds the rest.`, "Deposit Referee."]);
  await say(page, `Deposit Referee: two photos, a fair charge, and ${pp} holds the rest.`);
  await titleCard(page, `${captured} captured, ${released} released, read back from ${pp}`, "Deposit Referee", 5000);
  const endAt = clock.exact;
  clock.end();
  await check("end");
  const edit = clock.writeCuts(CUTS_FILE);
  console.log(`[demo] edited video ${edit.videoSeconds.toFixed(1)}s, raw ${Math.round(clock.raw)}s, ${edit.cuts.length} cuts: ${edit.cuts.map((c) => `${c.label} ${c.from.toFixed(1)}-${c.to.toFixed(1)}`).join("; ")}`);
  expect(edit.videoSeconds, `the edited video is under ${CUT_LIMIT_S} s`).toBeLessThan(CUT_LIMIT_S);

  // The voiceover: each shot's first line that fits before the next one starts, at ~2.6 words a second.
  const script = fitVoiceover(voice, endAt);
  fs.writeFileSync(VOICE_FILE, JSON.stringify(script, null, 2));
  for (const line of script) console.log(`[demo] voiceover ${line.shot} at ${line.at.toFixed(1)}s (${line.room.toFixed(1)}s for ${line.words} words): ${line.text}`);
  const tooLong = script.filter((l) => !l.fits);
  expect(tooLong.map((l) => `shot ${l.shot}: ${l.words} words in ${l.room.toFixed(1)} s`), "every voiceover line fits before the next one at 2.6 words a second").toEqual([]);
});

test.afterEach(async ({ page }, info) => {
  guard?.stop();
  const video = page.video();
  await page.close();
  if (video) {
    const name = `videos/demo-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.webm`;
    await video.saveAs(name);
    // The edit list goes beside the video; npm run demo:mp4 applies it.
    if (fs.existsSync(CUTS_FILE)) fs.copyFileSync(CUTS_FILE, name.replace(/\.webm$/, ".cuts.json"));
    // The voiceover, in seconds of the edited video: the demo's clock plus where the video's clock starts.
    if (fs.existsSync(VOICE_FILE) && fs.existsSync(CUTS_FILE)) {
      const { syncAt } = JSON.parse(fs.readFileSync(CUTS_FILE, "utf8"));
      const { videoOffset } = await import("../scripts/demo-offset.mjs");
      const offset = videoOffset(name, syncAt);
      const script = (JSON.parse(fs.readFileSync(VOICE_FILE, "utf8")) as { shot: number; at: number; text: string }[]).map(({ shot, at, text }) => ({ shot, at: Math.round((at + offset) * 10) / 10, text }));
      const body = `${JSON.stringify(script, null, 2)}\n`;
      fs.writeFileSync("videos/voiceover.json", body);
      fs.writeFileSync(name.replace(/\.webm$/, ".voiceover.json"), body);
      console.log(`[demo] voiceover: ${script.length} lines, video clock offset ${offset.toFixed(2)}s, videos/voiceover.json`);
    }
    console.log(`[demo] saved ${name} (${info.duration / 1000 | 0}s)`);
  }
});
