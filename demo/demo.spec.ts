/**
 * The demo video (npm run demo:record): a 5-second card with the problem and why PayPal (one
 * layer, no caption under it), a booking, the renter placing the hold from their own page on a
 * phone, Claude comparing the photos, the proposal as line cards, the agent's own loop on the
 * timeline (it reads the review and PayPal through the Agent Toolkit, proposes and stops), the
 * limit test refused by code, the renter accepting one item and contesting the other with their
 * own dated photo, then one hold bar pinned at the side while the money moves: the host's Approve
 * click on camera under a headline that names the same amount, the first capture, Claude's second
 * look, the counter the renter accepts and the settlement. Then the money strip, the three PayPal
 * calls that moved money, the dispute beat (the same booking in mock mode; on the sandbox another
 * stay, captioned as one), and an end card read back from PayPal. Each region that matters is
 * zoomed so it reads at 1080p. A caption is on screen in every frame after the opening card, each
 * long enough to read at 15 characters a second. Saves a .webm to videos/, its edit list, and the
 * voiceover script (videos/voiceover.json: [{ shot, at, text }], `at` in seconds of the edited
 * video). For PayPal's real card form, record on the sandbox: DEMO_BASE_URL=https://deposit-referee.onrender.com
 * records the hosted site with live AI; DEMO_PAYPAL_MODE=sandbox records a local one. The captions
 * follow the modes /api/kit/status reports, so a mock run says it is one. For the take judges see,
 * add DEMO_REQUIRE_LIVE=1: the run then fails if any frame shows mock or simulated text
 * (live-guard.ts). On the sandbox, DEMO_DISPUTE_BOOKING names a booking whose real sandbox dispute
 * the dispute beat shows; without it the beat is skipped.
 */
import { expect, test, type APIRequestContext, type FrameLocator, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { shortName } from "../src/lib/deposit/conversation";
import type { ChargeLine } from "../src/lib/deposit/types";
import { caption, clickOnCamera, closePhone, DemoClock, highlight, holdBar, openPhone, titleCard, zoomIn, zoomOn, zoomPhone } from "./captions";
import { damageNamed, damageNotShown } from "./damage-words";
import { LiveGuard } from "./live-guard";
import { CHARS_PER_SECOND, fitVoiceover, type VoiceLine } from "./voiceover";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Waits until `ms` have truly passed since `since` (Date.now()), however early a timer fires. */
async function holdUntil(since: number, ms: number) {
  for (let left = ms - (Date.now() - since); left > 0; left = ms - (Date.now() - since)) await sleep(left + 20);
}
const whole = (cents: number) => `$${(cents / 100).toFixed(cents % 100 ? 2 : 0)}`;
/** A caption that stays up until the next one replaces it, so no frame is left without one. */
const STAY = 10 * 60_000;
let guard: LiveGuard | null = null;
/** Everything the AI's findings say, once they're on screen. A caption may only name damage in here. */
let findingsText = "";
const CUTS_FILE = "test-results/demo/cuts.json";
const VOICE_FILE = "test-results/demo/voiceover.json";
const DEMO_PHOTOS = path.join(process.cwd(), "public", "demo-photos");
/** The edited video's clock, for timing captions. */
let clockNow = () => 0;
/** Each caption and how long it stayed up, in seconds of the edited video. */
const shown: { text: string; seconds: number }[] = [];
let current: { text: string; at: number } | null = null;
/** The caption on screen is replaced (or the video ends): note how long it was up. */
const closeCaption = () => {
  if (current) shown.push({ text: current.text, seconds: clockNow() - current.at });
  current = null;
};
const say = async (page: Page, text: string, readMs = 0) => {
  const unshown = damageNotShown(text, findingsText);
  if (unshown.length) throw new Error(`The caption "${text}" names ${unshown.join(", ")}, which the findings on screen don't: ${findingsText.slice(0, 200) || "(none yet)"}`);
  // The caption on screen stays until it can be read at 15 characters a second.
  if (current) while (clockNow() - current.at < current.text.length / CHARS_PER_SECOND + 0.05) await sleep(50);
  closeCaption();
  current = { text, at: clockNow() };
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
const CALLS_HOLD_MS = 4_400;
/** The opening card: the problem and why PayPal, about 5 s with its fades. */
const OPENING_MS = 4_600;

/** How long PayPal's card form (or the mock's stand-in) is on screen in the edited video, give or take half a second. */
const FORM_ON_CAMERA_S = 3;
/** Every narrated beat stays on screen at least this long. */
const BEAT_MIN_S = 4;
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
  // The form stays on camera about 3 s in all, then the renter pays.
  while (clock.onCamera(opened, clock.raw) < FORM_ON_CAMERA_S) await sleep(100);
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
  clockNow = () => clock.exact;
  shown.length = 0;
  current = null;
  fs.rmSync(CUTS_FILE, { force: true });
  fs.rmSync(VOICE_FILE, { force: true });
  findingsText = "";
  guard = new LiveGuard(page);
  const voice: VoiceLine[] = [];
  /** The voiceover for shot `shot` starts now (or at `at`); the first line that fits is kept. */
  const vo = (shot: number, lines: string[], at = clock.exact) => voice.push({ shot, at, lines });
  /** A narrated beat stays on screen at least BEAT_MIN_S (plus a breath): waits out the rest. */
  const beatFrom = (at: number, seconds = BEAT_MIN_S + 0.4) => async () => {
    while (clock.exact - at < seconds) await sleep(100);
  };
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
  /** The same, starting a sentence. */
  const Pp = sandbox ? "PayPal" : "Mock PayPal";
  const holdTitle = sandbox ? "PayPal hold" : "Mock PayPal hold";
  console.log(`[demo] PayPal ${status.paypal.mode}, AI ${status.ai.mode}`);
  guard.start();

  // 1. The problem and why PayPal, on one 5-second card and nothing else: no caption under it.
  // The edit lines its cuts up on the card (the white page going dark).
  await page.goto("/");
  await expect(page.getByTestId("landing-headline")).toBeVisible();
  clock.sync();
  vo(1, [
    "A guest damages the cabin and says it was already there. One PayPal hold settles it.",
    "A guest says the damage was already there. One PayPal hold settles it.",
    "Damage, and a guest who says it was already there.",
  ]);
  await titleCard(page, "A guest damages a host&rsquo;s cabin", "Why PayPal: one hold, several captures, up to 29 days", OPENING_MS);
  expect(clock.exact, "the PayPal reason is on screen in the first 20 s").toBeLessThan(20);
  await check("open");

  // 2. The booking.
  await page.goto("/bookings");
  const bookingAt = clock.exact;
  vo(2, ["A host who rents from their own site asks for a $300 deposit, and sends the renter a link.", "The host asks for a $300 deposit. The renter gets a link.", "The host asks for a $300 deposit."]);
  await say(page, "A host renting from their own site asks for a $300 deposit.");
  // Zoomed on the form, so what's typed reads at video size.
  const form = page.locator("form").filter({ has: page.getByLabel("What's being rented") });
  await zoomIn(page, form, { scale: 1.45, self: true });
  await page.getByLabel("What's being rented").pressSequentially("Cedar cabin, weekend of Nov 13", { delay: 16 });
  await page.getByLabel("Renter").pressSequentially("Alex Rivera", { delay: 22 });
  await tap(page, "create-booking");
  await page.waitForURL(/\/bookings\/bk_/);
  const id = new URL(page.url()).pathname.split("/").pop()!;
  await expect(page.getByTestId("waiting-headline")).toBeVisible();
  await beatFrom(bookingAt)();
  await check("booking");

  // 3. The renter places the hold from their own page, on their phone.
  const { renterToken } = await (await page.request.get(`/api/bookings/${id}`)).json();
  vo(3, sandbox
    ? ["They place a $300 hold in PayPal's own card form. It's an authorization: nothing is charged.", "A $300 hold in PayPal's own card form. Nothing is charged."]
    : ["They place a $300 hold with mock PayPal. It's an authorization: nothing is charged.", "A $300 hold. Nothing is charged."]);
  const renter = await openPhone(page, `/renter/${renterToken}`);
  await expect(renter.getByTestId("renter-headline")).toHaveText("Place your $300 deposit hold", { timeout: 20_000 });
  // Readable before the card form opens, which is timed on camera.
  await say(page, `The renter places a $300 hold with ${pp}.`, 3200);
  // PayPal's card form (or the mock's stand-in) is on camera for at most 3 seconds of the edit.
  let formOpened: number;
  if (sandbox) {
    await say(page, "PayPal's own card form, with PayPal's sandbox test card.");
    formOpened = await payInPayPal(renter, clock);
  } else {
    await renter.getByTestId("simulate-paypal-approval").click();
    await expect(renter.getByTestId("mock-approve")).toBeVisible();
    formOpened = clock.raw;
    await say(page, "Mock PayPal's stand-in for the card form.");
    while (clock.onCamera(formOpened, clock.raw) < FORM_ON_CAMERA_S) await sleep(100);
    await renter.getByTestId("mock-approve").click();
  }
  const held = renter.getByTestId("renter-hold-headline");
  await clock.cut("the hold on its way", () => expect(held).toHaveText("$300 authorized, nothing charged", { timeout: 45_000 }));
  const formS = clock.onCamera(formOpened, clock.raw);
  console.log(`[demo] card form on camera ${formS.toFixed(1)}s`);
  expect(formS, `the card form is on camera about ${FORM_ON_CAMERA_S} s`).toBeGreaterThanOrEqual(FORM_ON_CAMERA_S - 0.5);
  expect(formS, `the card form is on camera about ${FORM_ON_CAMERA_S} s`).toBeLessThanOrEqual(FORM_ON_CAMERA_S + 0.5);
  // Zoomed in on the hold, so it reads at video size; the hold bar comes in and stays to the settlement.
  await zoomPhone(page, renter.getByTestId("renter-hold"), 1.8);
  await say(page, "$300 authorized, nothing charged.");
  await holdBar(page, { heldCents: 30_000, capturedCents: 0, contestedCents: 0, releasedCents: 0, note: "Authorized. Nothing charged." }, { title: holdTitle });
  await sleep(900);
  await closePhone(page);
  const authId = page.getByTestId("hold-authorization-id");
  await clock.cut("the host's page catching up", () => expect(authId).toHaveText(/\w{10,}/, { timeout: 45_000 }));
  const authorizationId = (await authId.textContent())!.trim();
  await authId.scrollIntoViewIfNeeded();
  vo(4, [
    `The host's page reads the authorization back from ${pp}: capturable until day 29.`,
    `The host's page reads it back from ${pp}.`,
  ]);
  const holdOut = await zoomIn(page, authId.locator("xpath=ancestor::div[1]"), { scale: 1.7, self: true });
  await say(page, `${Pp} authorization ${authorizationId}: capturable until day 29.`, 2600);
  await holdOut();
  await check("hold");

  // 4. The comparison: the host uploads the two photos, captioned while Claude works.
  const photosAt = clock.exact;
  await say(page, "After the stay, the host adds the check-in and check-out photos.");
  await page.getByTestId("upload-photo-check_in").setInputFiles(path.join(DEMO_PHOTOS, "cabin-check-in.jpg"));
  await expect(page.getByTestId("photo-source")).toHaveCount(1, { timeout: 20_000 });
  await page.getByTestId("upload-photo-check_out").setInputFiles(path.join(DEMO_PHOTOS, "cabin-check-out-two.jpg"));
  await expect(page.getByTestId("photo-source")).toHaveCount(2, { timeout: 20_000 });
  await sleep(400);
  await tap(page, "run-review");
  await say(page, liveAI ? "Claude Sonnet 5.5 compares them and boxes only what's new." : "Mock AI stands in for Claude, boxing only what's new.");
  const proposal = page.getByTestId("ai-proposal");
  // Claude's work stays on camera for a few seconds; the rest of the wait is cut.
  await clock.cut("Claude comparing and the agent proposing", () => expect(proposal).toBeVisible({ timeout: 120_000 }), 2_600);
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
    `After the stay, the host adds the two photos. Claude compares them and boxes only what's new: ${marks}.`,
    `The host adds the two photos. Claude boxes only what's new: ${marks}.`,
  ], photosAt);
  // The finished steps fold to one line each; open the photos to show the boxes.
  await page.getByTestId("fold-photos").locator(":scope > summary").click();
  await say(page, `${marks[0].toUpperCase()}${marks.slice(1)}.`);
  await zoomOn(page, page.getByTestId("damage-box").first(), { scale: 2.4, ms: 2200 });
  await page.getByTestId("fold-photos").locator(":scope > summary").click();
  await check("photos");

  // 5. The proposal: one card per line, zoomed so the mark, the price chip and the amount read at video size.
  const proposalAt = clock.exact;
  vo(6, [
    `Prices come from a table in code: ${whole(acceptedCents)} for the ${acceptedName}, ${whole(contestedCents)} for the ${contestedName}. The agent proposes and stops: it can't move money.`,
    "Prices come from a table in code. The agent proposes and stops; it can't move money.",
    "Prices come from a table in code. The agent can't move money.",
  ]);
  await page.screenshot({ path: "docs/screenshot.png", style: "#__demo_caption, #__demo_holdbar { display: none !important; } body { padding-bottom: 0 !important; }" });
  const itemized = page.getByTestId("itemized-charge");
  await say(page, `${whole(acceptedCents)} and ${whole(contestedCents)}, from the price table. The agent can't move money.`);
  await zoomOn(page, itemized, { scale: 1.35, ms: 3000, self: true });
  await beatFrom(proposalAt, 5.2)();
  await check("proposal");

  // 5b. The agent's own loop, from the timeline: it reads the review, reads PayPal through the
  // Agent Toolkit, proposes and stops. Cropped to the agent's rows, zoomed so they read.
  const agentAt = clock.exact;
  const callsToggle = page.getByTestId("paypal-calls-toggle");
  await callsToggle.scrollIntoViewIfNeeded();
  await callsToggle.click();
  const timeline = page.getByTestId("tool-call-timeline");
  await expect(timeline).toBeVisible();
  await expect(timeline).toContainText("propose_settlement");
  /** Shows only the rows from the first one matching `from` on (and never a run's "finished" row). */
  const cropTimeline = (from: string) =>
    timeline.evaluate((root, from) => {
      const rows = [...root.querySelectorAll<HTMLElement>("ol > li")];
      const first = rows.findIndex((li) => new RegExp(from).test(li.textContent ?? "") && !/finished/.test(li.textContent ?? ""));
      let kept = 0;
      rows.forEach((li, i) => {
        const keep = first >= 0 && i >= first && !/(agent|test) finished/.test(li.textContent ?? "");
        li.style.display = keep ? "" : "none";
        if (keep) kept++;
      });
      Object.assign(root.style, { maxHeight: "none", overflow: "visible" });
      return kept;
    }, from);
  // The agent's loop as J5 put it: read_damage_review, then PayPal through the Agent Toolkit
  // (get_order, get_authorization), then propose_settlement, and its own words when it stops.
  const agentRows = await timeline.evaluate((root) => {
    const rows = [...root.querySelectorAll<HTMLElement>("ol > li")];
    const text = (li: HTMLElement) => li.textContent ?? "";
    const start = rows.findIndex((li) => /Read the photo review/.test(text(li)));
    const proposeAt = rows.findIndex((li) => /propose_settlement/.test(text(li)));
    const stopAt = rows.findIndex((li, i) => i > proposeAt && /Settlement agent/.test(text(li)) && !/finished/.test(text(li)));
    const seen = new Set<string>();
    let kept = 0;
    rows.forEach((li, i) => {
      const t = text(li);
      const read = t.match(/^(Get order|Get authorization)/)?.[1];
      let keep = start >= 0 && i >= start && i <= (stopAt > 0 ? stopAt : proposeAt);
      if (keep) keep = /Read the photo review|propose_settlement/.test(t) || i === stopAt || (!!read && /GET \//.test(t) && !seen.has(read));
      if (keep && read) seen.add(read);
      li.style.display = keep ? "" : "none";
      if (keep) kept++;
    });
    Object.assign(root.style, { maxHeight: "none", overflow: "visible" });
    return { kept, dump: rows.map((li, i) => `${i}${li.style.display ? "-" : "+"} ${text(li).slice(0, 70)}`).join(" | ") };
  }).then(({ kept, dump }) => {
    console.log(`[demo] timeline rows: ${dump}`);
    return kept;
  });
  console.log(`[demo] agent loop cropped to ${agentRows} rows`);
  expect(agentRows, "the agent's loop is on screen").toBeGreaterThanOrEqual(3);
  vo(61, [
    "The agent reads the review, then PayPal through the Agent Toolkit, and proposes. Then it stops.",
    "The agent reads PayPal through the Agent Toolkit, proposes, and stops.",
  ]);
  const agentOut = await zoomIn(page, timeline, { scale: 1.45, self: true });
  await say(page, "The agent reads the review and PayPal, then proposes and stops.");
  await beatFrom(agentAt, BEAT_MIN_S + 0.6)();
  await agentOut();
  await check("agent");

  // 5c. Test the limit: a scripted agent asks for one cent over the hold through the real tools.
  // The app's code refuses it before PayPal. Run from the API, so Demo tools stays closed.
  const limitAt = clock.exact;
  const over = whole((view.authorizedCents ?? 30_000) + 1);
  const limit = await page.request.post(`/api/bookings/${id}/limit-test`);
  expect(limit.status(), "the limit test runs while the host decides").toBe(200);
  await expect(timeline).toContainText("Refused by the app's code", { timeout: 20_000 });
  await sleep(300);
  const limitRows = await cropTimeline("Limit test");
  expect(limitRows, "the limit test's ask and its refusal are on screen").toBeGreaterThanOrEqual(2);
  vo(62, [
    `Test the limit: an agent asks for ${over}, one cent over the hold. The app's code refuses it. No money moves.`,
    `An agent asks for ${over}. The code refuses it. No money moves.`,
    "One cent over the hold: the code refuses it.",
  ]);
  const limitOut = await zoomIn(page, timeline, { scale: 1.4, self: true });
  await say(page, `Test the limit: an agent asks for ${over}. The code refuses it.`);
  await beatFrom(limitAt, BEAT_MIN_S + 1.4)();
  await limitOut();
  await callsToggle.click();
  await check("limit");

  // 6. The renter, on their phone: accepts the first item, contests the rest with their own photo.
  vo(7, [
    `On their phone, the renter accepts the ${acceptedName} and contests the ${contestedName}, with their own photo from check-in.`,
    `The renter accepts the ${acceptedName} and contests the ${contestedName}, with their own photo.`,
  ]);
  const phone = await openPhone(page, `/renter/${view.renterToken}`);
  await expect(phone.getByTestId("renter-summary")).toBeVisible({ timeout: 20_000 });
  await phone.getByTestId(`line-accept-${accepted.id}`).scrollIntoViewIfNeeded();
  await say(page, `The renter accepts the ${acceptedName} and contests the ${contestedName} with their check-in photo.`);
  await phone.getByTestId(`line-accept-${accepted.id}`).click();
  for (const line of contestedLines) await phone.getByTestId(`line-contest-${line.id}`).click();
  await phone.getByTestId(`evidence-upload-${contestedLines[0].id}`).setInputFiles(path.join(DEMO_PHOTOS, "renter-check-in-stain.jpg"));
  const preview = phone.getByTestId(`evidence-preview-${contestedLines[0].id}`);
  await expect(preview).toBeVisible();
  await preview.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await sleep(700);
  await phone.getByTestId("contest-note").pressSequentially(`The ${contestedName} was there when I arrived. My photo shows it.`, { delay: 7 });
  await phone.getByTestId("contest").click();
  const contested = phone.getByTestId("renter-contested");
  await expect(contested).toBeVisible({ timeout: 20_000 });
  // The renter's answer stays on the phone for 4 seconds.
  const contestShown = Date.now();
  await contested.evaluate((el) => el.scrollIntoView({ block: "center" }));
  // Zoomed in, so the renter's answer reads at video size.
  // Captioned first, so the line is read while the phone zooms in.
  await say(page, `${whole(acceptedCents)} accepted, ${whole(contestedCents)} contested, with their note and photo.`);
  await zoomPhone(page, contested, 1.7);
  await holdBar(page, { heldCents: 30_000, capturedCents: 0, contestedCents, releasedCents: 0, note: `${whole(contestedCents)} contested by the renter.` }, { title: holdTitle });
  await holdUntil(contestShown, CONTEST_HOLD_MS);
  const contestMs = Date.now() - contestShown;
  console.log(`[demo] renter contest held ${(contestMs / 1000).toFixed(1)}s`);
  expect(contestMs, "the renter's contest stays on the phone 4 s").toBeGreaterThanOrEqual(CONTEST_HOLD_MS);
  await closePhone(page);
  await check("contest");

  // 7. The first capture: the accepted part now, the contested part stays on the same hold. The bar tells it.
  const prompt = page.getByTestId("approval-prompt");
  vo(8, [
    `The host approves the ${whole(acceptedCents)} the renter accepted. ${Pp} captures it with final capture false, so the contested ${whole(contestedCents)} stays on the same hold.`,
    `The host approves the ${whole(acceptedCents)} they accepted. The contested ${whole(contestedCents)} stays on the same hold.`,
  ]);
  await clock.cut("the approval card on its way", () => expect(prompt).toBeVisible({ timeout: 30_000 }));
  // The approval card is held on screen for 4 seconds: each line, the renter's answer and the Guard's reason.
  await prompt.evaluate((el) => el.scrollIntoView({ block: "center" }));
  const cardShown = Date.now();
  await say(page, `Nothing moves until the host approves: ${await prompt.getByTestId("approval-money").textContent()}.`);
  // The host's headline names what the Approve button moves, never another number.
  const approveButton = prompt.getByTestId("approve-button");
  const action = (await approveButton.textContent())!.replace(/^Approve:\s*/, "").trim();
  const headline = page.getByTestId("host-headline");
  await expect(headline).toContainText(action);
  console.log(`[demo] headline "${(await headline.textContent())!.trim()}" over the button "${action}"`);
  // The click itself, on camera: zoomed on the buttons, a pointer and a ring where it lands.
  const approveOut = await zoomIn(page, approveButton, { scale: 1.7 });
  await holdUntil(cardShown, APPROVAL_HOLD_MS);
  const cardMs = Date.now() - cardShown;
  console.log(`[demo] approval card on screen ${(cardMs / 1000).toFixed(1)}s before the click`);
  expect(cardMs, "the approval card is on screen 4 s before the click").toBeGreaterThanOrEqual(APPROVAL_HOLD_MS);
  await clickOnCamera(page, approveButton);
  await sleep(700);
  const part = page.getByTestId("part-capture");
  await clock.cut("the capture on its way", async () => {
    await approveOut();
    await expect(part).toContainText(`${whole(acceptedCents)}`, { timeout: 60_000 });
  }, 600);
  const partDone = await (await page.request.get(`/api/bookings/${id}`)).json();
  const partCents = partDone.partCapture.capturedCents as number;
  expect(partDone.partCapture.finalCapture, "PayPal read the first capture back with final_capture false").toBe(false);
  await holdBar(page, { heldCents: 30_000, capturedCents: partCents, contestedCents, releasedCents: 0, note: `${whole(partCents)} captured, final_capture false.` }, { title: holdTitle });
  await say(page, `${Pp} captures ${whole(partCents)}; the ${whole(contestedCents)} stays on hold.`, 1000);
  await check("part");

  // 8. Claude's second look at what the renter contested, with their dated photo and note. The charge can only fall.
  const look = page.getByTestId("second-look");
  await look.scrollIntoViewIfNeeded();
  const lookAt = clock.exact;
  await say(page, liveAI ? "Claude looks again, with the renter's dated photo." : "Mock AI looks again, with the renter's photo.");
  await clock.cut("Claude's second look", () => expect(look).toHaveAttribute("data-status", "ready", { timeout: 120_000 }), 1_200);
  const afterLook = await (await page.request.get(`/api/bookings/${id}`)).json();
  const lookLines = afterLook.secondLook.lines as { lineId: string; verdict: string; reasoning: string; fromCents: number; toCents: number; description: string }[];
  findingsText += ` ${lookLines.map((l) => `${l.description} ${l.reasoning}`).join(" ")}`;
  const verdictShown = (await look.getByTestId("second-look-verdict").first().textContent())!.trim();
  let [lookFrom, lookTo] = amountsIn((await look.getByTestId("second-look-total").textContent())!);
  const heard = spokenVerdict(lookLines[0]);
  const flaggedRow = look.locator('[data-testid="second-look-line"][data-flagged="true"]').first();
  const flagged = (await flaggedRow.count()) > 0;
  const lineRow = flagged ? flaggedRow : look.getByTestId("second-look-line").first();
  if (flagged) {
    // Claude couldn't tell: the host decides. Kept so a take still finishes; the story wants "already there".
    console.log(`[demo] second look flagged the ${contestedName} for the host (${verdictShown})`);
    await say(page, "Claude can't tell, so the host decides.");
    await zoomOn(page, lineRow, { scale: 1.3, ms: 2600, self: true });
    await tap(page, "flag-drop");
    await expect(look.locator('[data-testid="second-look-line"][data-flagged="true"]')).toHaveCount(0, { timeout: 15_000 });
    await clock.cut("the agent writing the counter", () => expect(look.getByTestId("counter-rationale")).not.toBeEmpty({ timeout: 90_000 }), 800);
  } else {
    await say(page, `${verdictShown}. The ${contestedName} falls from ${whole(contestedCents)} to ${whole(lookLines[0].toCents)}.`);
    await zoomOn(page, lineRow, { scale: 1.5, ms: 3000, self: true });
  }
  [lookFrom, lookTo] = amountsIn((await look.getByTestId("second-look-total").textContent())!);
  // The take's story is a charge that falls. If Claude kept the stain this time, stop with the
  // reason rather than record a broken beat.
  expect(lookTo !== lookFrom, `Claude's second look kept the ${contestedName} at ${lookTo} on this take (${verdictShown}); the demo needs the charge to fall. Rerun the take.`).toBe(true);
  const stillContested = afterLook.secondLook.lines.reduce((sum: number, l: { toCents: number }) => sum + l.toCents, 0) as number;
  await holdBar(page, { heldCents: 30_000, capturedCents: partCents, contestedCents: stillContested, releasedCents: 0, note: `The ${contestedName}: ${whole(contestedCents)} to ${whole(stillContested)}.` }, { title: holdTitle });
  vo(9, flagged
    ? [`Claude can't tell from the renter's photo, so the host decides and drops the ${contestedName}. ${lookFrom} becomes ${lookTo}, and the renter accepts the new offer.`, `Claude can't tell, so the host drops it. ${lookFrom} becomes ${lookTo}.`]
    : [`Claude takes a second look with the renter's dated photo: ${heard}. The total falls from ${lookFrom} to ${lookTo}, and the renter accepts the new offer.`, `A second look with the renter's photo: ${heard}. ${lookFrom} becomes ${lookTo}.`],
    lookAt);
  await tap(page, "send-counter");
  await expect(look.getByTestId("counter-sent")).toBeVisible({ timeout: 20_000 });
  await check("second look");

  // The renter accepts the counter on their phone.
  const phone2 = await openPhone(page, `/renter/${view.renterToken}`);
  const counter = phone2.getByTestId("renter-counter");
  await expect(counter).toBeVisible({ timeout: 20_000 });
  await counter.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await zoomPhone(page, counter, 1.5);
  await say(page, `The renter accepts the new offer: ${lookTo} in all.`, 1600);
  await phone2.getByTestId("accept-counter").click();
  await expect(phone2.getByTestId("renter-counter-accepted")).toBeVisible({ timeout: 20_000 });
  await sleep(800);
  await closePhone(page);
  await check("counter");

  // 9. The host approves the rest; PayPal settles the same hold. The money strip is the take's high point.
  const settleAt = clock.exact;
  await say(page, `The host approves. ${Pp} settles the rest of the same hold.`);
  await clock.cut("the approval card on its way", () => expect(prompt).toBeVisible({ timeout: 30_000 }));
  await prompt.evaluate((el) => el.scrollIntoView({ block: "center" }));
  const settleButton = prompt.getByTestId("approve-button");
  await expect(page.getByTestId("host-headline")).toContainText((await settleButton.textContent())!.replace(/^Approve:\s*/, "").trim());
  const settleOut = await zoomIn(page, settleButton, { scale: 1.7 });
  await clickOnCamera(page, settleButton);
  await sleep(700);
  const ruling = page.getByTestId("ruling-headline");
  await clock.cut("the settlement on its way", async () => {
    await settleOut();
    await expect(ruling).toBeVisible({ timeout: 60_000 });
  });
  await sleep(400);
  await ruling.scrollIntoViewIfNeeded();
  const done = await (await page.request.get(`/api/bookings/${id}`)).json();
  const captured = whole(done.settlement.capturedCents);
  const released = whole(done.settlement.releasedCents);
  await expect(ruling).toHaveText(`${captured} captured, ${released} released`);
  vo(10, [
    `${captured} captured, ${released} released. Each amount as ${pp} returned it.`,
    `${captured} captured, ${released} released, read back from ${pp}.`,
  ], settleAt);
  await holdBar(page, { heldCents: 30_000, capturedCents: done.settlement.capturedCents, contestedCents: 0, releasedCents: done.settlement.releasedCents, note: `Settled, read back from ${pp}.` }, { title: holdTitle });
  await sleep(1200);
  // The money strip is the high point: the bar steps aside for it.
  await holdBar(page, null);
  // The money in one line, each amount as PayPal returned it, on its own: the bar steps aside.
  const strip = page.getByTestId("money-strip");
  await expect(strip).toBeVisible();
  const stripText = (await strip.getAttribute("aria-label"))!;
  await say(page, `${stripText}: each amount as ${pp} returned it.`);
  await zoomOn(page, strip, { scale: 1.6, ms: 4200 });
  await check("ruling");

  // 10. The PayPal calls, cropped to three rows: the hold, the capture and the void.
  const callsAt = clock.exact;
  const toggle = page.getByTestId("paypal-calls-toggle");
  await toggle.scrollIntoViewIfNeeded();
  await toggle.click();
  const toggledAt = Date.now();
  const calls = page.getByTestId("paypal-calls");
  await expect(calls).toContainText(/authoriz/i);
  await expect(calls).toContainText(/void/i);
  const row = (title: string) => calls.locator("li[data-paypal-call]").filter({ hasText: title });
  const capture = row("Capture authorization").last();
  const voided = row("Void authorization").last();
  await expect(capture).toContainText(/HTTP 20\d/);
  await expect(capture).toContainText("debug_id");
  await expect(voided).toContainText(/HTTP 20\d/);
  await expect(voided).toContainText("debug_id");
  const captures = done.settlement.captureId && done.settlement.captureId !== done.partCapture?.captureId ? "both captures" : "the capture";
  vo(11, [
    `The ${pp} calls that moved money: the hold, ${captures} and the void, each with its HTTP status and debug id.`,
    `${Pp}'s answers, with status and debug id.`,
  ], callsAt);
  // The crop, on camera only: every row but the hold and the money moves is hidden, and the list
  // stops scrolling. Three rows: the authorization, the capture and the void (with two captures,
  // both captures and the void).
  const kept = await calls.evaluate((root) => {
    const rows = [...root.querySelectorAll<HTMLElement>("li[data-paypal-call]")];
    const titled = (re: RegExp) => rows.filter((li) => re.test(li.textContent ?? ""));
    const moves = [...titled(/Capture authorization/).slice(-2), ...titled(/Void authorization/).slice(-1)];
    const keep = [...(moves.length < 3 ? titled(/Authorize order/).slice(-1) : []), ...moves];
    for (const li of root.querySelectorAll<HTMLElement>("li")) if (!keep.some((k) => k === li || k.contains(li) || li.contains(k))) li.style.display = "none";
    for (let el = keep[0]?.parentElement; el && el !== root.parentElement; el = el.parentElement) {
      if (/auto|scroll/.test(getComputedStyle(el).overflowY)) Object.assign(el.style, { maxHeight: "none", overflow: "visible" });
    }
    return keep.length;
  });
  console.log(`[demo] PayPal calls cropped to ${kept} rows`);
  expect(kept, "the crop keeps three rows: the hold and the money moves").toBe(3);
  const list = capture.locator("xpath=..");
  await say(page, `The ${pp} calls that moved money, with HTTP status and debug_id.`);
  const callsOpened = Date.now();
  // For 2 s after the toggle the page keeps the result in view whenever the list changes size
  // (ruling.tsx): the cropped rows show under the result, then the zoom brings them up.
  await sleep(Math.max(0, 2_100 - (Date.now() - toggledAt)));
  await zoomOn(page, list, { scale: 1.45, ms: 2_600, self: true });
  await holdUntil(callsOpened, CALLS_HOLD_MS);
  console.log(`[demo] PayPal calls open ${((Date.now() - callsOpened) / 1000).toFixed(1)}s`);
  await check("calls");

  // 11. A dispute: the guest disputes the charge with PayPal and the host sends the evidence pack
  // through the approval gate. In mock mode it's this same booking; on the sandbox it's another
  // stay, and the caption says so.
  const disputeShown = await showDispute(page, request, { id, sandbox, pp, clock, captured });
  if (disputeShown) {
    vo(12, disputeShown.same
      ? [`Weeks later, the guest disputes the charge with ${pp}. The evidence pack goes in only after the host approves.`, `The guest disputes it with ${pp}. The host approves sending the evidence pack.`]
      : [`On a different stay, the guest disputed the charge with ${pp}. The evidence pack went in after the host approved.`, `Another stay's ${pp} dispute: the evidence pack, sent after approval.`],
      disputeShown.at);
    await check("dispute");
  }

  // 12. The end card, from the amounts PayPal returned.
  vo(13, [`Deposit Referee. Two photos, a fair charge, and ${pp} holds the rest.`, "Deposit Referee."]);
  // The end card is its own caption: the line under it would be covered as soon as it showed.
  await titleCard(page, `${captured} captured, ${released} released, read back from ${pp}`, `Deposit Referee: two photos, a fair charge, and ${pp} holds the rest`, 4200);
  const endAt = clock.exact;
  closeCaption();
  clock.end();
  await check("end");
  const edit = clock.writeCuts(CUTS_FILE);
  console.log(`[demo] edited video ${edit.videoSeconds.toFixed(1)}s, raw ${Math.round(clock.raw)}s, ${edit.cuts.length} cuts: ${edit.cuts.map((c) => `${c.label} ${c.from.toFixed(1)}-${c.to.toFixed(1)}`).join("; ")}`);
  // The captions: each one stays up long enough to read at 15 characters a second.
  for (const c of shown) console.log(`[demo] caption ${c.seconds.toFixed(1)}s for ${c.text.length} chars: ${c.text}`);
  expect(edit.videoSeconds, `the edited video is under ${CUT_LIMIT_S} s`).toBeLessThan(CUT_LIMIT_S);
  const rushed = shown.filter((c) => c.seconds + 0.25 < c.text.length / CHARS_PER_SECOND);
  expect(rushed.map((c) => `${c.seconds.toFixed(1)} s for ${c.text.length} chars: ${c.text}`), `every caption is on screen long enough to read at ${CHARS_PER_SECOND} characters a second`).toEqual([]);

  // The voiceover: each shot's first line that fits before the next one starts, at 15 characters a second.
  const script = fitVoiceover(voice, endAt);
  fs.writeFileSync(VOICE_FILE, JSON.stringify(script, null, 2));
  for (const line of script) console.log(`[demo] voiceover ${line.shot} at ${line.at.toFixed(1)}s (${line.room.toFixed(1)}s for ${line.chars} chars): ${line.text}`);
  const short = script.filter((l) => l.room + 0.3 < BEAT_MIN_S);
  expect(short.map((l) => `shot ${l.shot}: ${(l.room + 0.3).toFixed(1)} s`), `every narrated beat is on screen at least ${BEAT_MIN_S} s`).toEqual([]);
  const tooLong = script.filter((l) => !l.fits);
  expect(tooLong.map((l) => `shot ${l.shot}: ${l.chars} chars in ${l.room.toFixed(1)} s`), `every voiceover line fits before the next one at ${CHARS_PER_SECOND} characters a second`).toEqual([]);
});

/**
 * The dispute beat. In mock mode the guest disputes this booking's charge as a chargeback
 * (mock-only route): the caption says so, the host's "send the evidence pack" approval is on
 * camera, and the host approves it. On the sandbox only a buyer can open a dispute, so it shows the
 * booking named by DEMO_DISPUTE_BOOKING, one that tests/e2e/dispute-sandbox.spec.ts ran on that
 * site, captioned plainly as a different stay; without it the beat is skipped.
 */
async function showDispute(page: Page, request: APIRequestContext, o: { id: string; sandbox: boolean; pp: string; clock: DemoClock; captured: string }) {
  const at = o.clock.exact;
  const panel = page.getByTestId("dispute-panel");
  let bookingId = o.id;
  if (o.sandbox) {
    const named = process.env.DEMO_DISPUTE_BOOKING;
    const found = named ? await (await request.get(`/api/bookings/${named}`)).json().catch(() => null) : null;
    if (!found?.dispute?.evidence?.submittedAt) {
      console.log(`[demo] dispute beat skipped: set DEMO_DISPUTE_BOOKING to a booking on this site whose sandbox dispute has its evidence sent${named ? ` (${named} has none)` : ""}`);
      return null;
    }
    bookingId = found.id;
    const amount = found.settlement?.capturedCents ? ` ${whole(found.settlement.capturedCents)}` : "";
    // Said before the page changes, so the jump to another booking is explained first.
    await say(page, `A different stay, weeks later: that guest disputes the${amount} charge.`);
    await o.clock.cut("the other booking loading", async () => {
      await page.goto(`/bookings/${bookingId}`);
      await expect(panel.getByTestId("evidence-sent")).toContainText("as evidence", { timeout: 30_000 });
      await panel.evaluate((el) => el.scrollIntoView({ block: "center" }));
      await sleep(500);
    });
    const disputeId = (await panel.getByTestId("dispute-id").textContent())!.trim();
    const stage = (await panel.getByTestId("dispute-stage").textContent())!.trim();
    expect(stage, "the dispute is a claim, where PayPal takes evidence").not.toBe("INQUIRY");
    await say(page, `${o.pp} case ${disputeId}: the evidence pack, sent after the host approved.`);
    await zoomOn(page, panel, { scale: 1.3, ms: 4_000, self: true });
    console.log(`[demo] dispute ${disputeId} ${stage}, evidence sent, on ${bookingId} (a different booking, captioned)`);
    return { at, same: false };
  }
  const opened = await request.post(`/api/dev/mock/dispute/${o.id}`, { data: { stage: "CHARGEBACK", message: "I don't agree with this charge." } });
  expect(opened.status(), "the mock dispute opens").toBe(200);
  // The page picking the case up and the agent drafting the pack are cut; the host's approval is on camera.
  await o.clock.cut("the dispute arriving", async () => {
    await page.reload();
    await expect(panel).toBeVisible({ timeout: 30_000 });
    await panel.getByTestId("send-evidence").click();
    await expect(panel.getByTestId("approval-prompt")).toBeVisible({ timeout: 30_000 });
    await panel.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await sleep(400);
  });
  const gate = panel.getByTestId("approval-prompt");
  const gateOut = await zoomIn(page, gate, { scale: 1.15, self: true });
  await say(page, `Weeks later the guest disputes the ${o.captured} charge. The host approves the evidence pack.`);
  await sleep(1_400);
  await clickOnCamera(page, gate.getByTestId("approve-button"));
  await sleep(500);
  const { disputeId, stage } = await o.clock.cut("the evidence going to PayPal", async () => {
    await gateOut();
    await expect(panel.getByTestId("evidence-sent")).toContainText("as evidence", { timeout: 30_000 });
    // The approval's toast would sit over the panel: it fades by itself, off camera.
    await expect(page.getByText("Approved", { exact: true })).toHaveCount(0, { timeout: 15_000 }).catch(() => undefined);
    await panel.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await sleep(300);
    return { disputeId: (await panel.getByTestId("dispute-id").textContent())!.trim(), stage: (await panel.getByTestId("dispute-stage").textContent())!.trim() };
  });
  expect(stage, "the dispute is a claim, where PayPal takes evidence").not.toBe("INQUIRY");
  await say(page, `Sent to ${o.pp} case ${disputeId}.`);
  const sentOut = await zoomIn(page, panel.getByTestId("evidence-sent"), { scale: 1.6, self: true });
  await sleep(1_000);
  // The zoom stays: the end card covers it.
  void sentOut;
  console.log(`[demo] dispute ${disputeId} ${stage}, evidence sent, on ${bookingId} (the same booking)`);
  return { at, same: true };
}

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
