/**
 * The PayPal sandbox buyer (a sandbox personal account), for the two steps only a buyer can do:
 * pay a hold with the PayPal wallet button, and file a dispute from their PayPal account. Test
 * automation only, on sandbox.paypal.com. The login comes from ../../.env.shared
 * (PAYPAL_SANDBOX_BUYER_EMAIL, PAYPAL_SANDBOX_BUYER_PASSWORD) and is never printed, logged,
 * traced or screenshotted. If PayPal shows a CAPTCHA or any other bot check, the run stops and
 * says so: it is never worked around.
 */
import type { Page } from "@playwright/test";
import { loadEnvFiles } from "../../src/lib/env-core";

export interface SandboxBuyer {
  email: string;
  password: string;
}

/** Why a buyer step is skipped, or null when the login is there. */
export function buyerMissing(): string | null {
  loadEnvFiles(process.cwd(), { force: true }); // re-read: the login may have been added since the run began
  const missing = ["PAYPAL_SANDBOX_BUYER_EMAIL", "PAYPAL_SANDBOX_BUYER_PASSWORD"].filter((name) => !process.env[name]?.trim());
  return missing.length
    ? `${missing.join(" and ")} ${missing.length > 1 ? "aren't" : "isn't"} in .env.shared yet, so the sandbox buyer can't log in to PayPal. Add it (Developer Dashboard > Testing Tools > Sandbox Accounts > the personal account) and rerun.`
    : null;
}

export function sandboxBuyer(): SandboxBuyer {
  const why = buyerMissing();
  if (why) throw new Error(why);
  return {
    email: process.env.PAYPAL_SANDBOX_BUYER_EMAIL!.trim(),
    password: process.env.PAYPAL_SANDBOX_BUYER_PASSWORD!.trim(),
  };
}

/** Thrown when PayPal puts a bot check in front of the buyer. The run stops there. */
export class BotCheck extends Error {}

const BOT_CHECK = /captcha|security challenge|verify (that )?you('re| are) (a )?(human|not a robot)|unusual activity|confirm it'?s you/i;

/** Stops the run if PayPal is showing a CAPTCHA or other bot check. Never tries to get past one. */
export async function stopOnBotCheck(page: Page, where: string) {
  // Only a challenge the buyer is shown counts. PayPal's sign-in pages always carry a hidden 0x0
  // reCAPTCHA v3 scoring frame (grcv3enterpriseframe) that asks nothing; that one isn't a stop.
  const shown = await page
    .locator('iframe[src*="captcha"], iframe[title*="captcha" i], iframe[src*="arkoselabs"], iframe[src*="hcaptcha"], #captcha-standalone, [data-testid*="captcha" i]')
    .evaluateAll((els) =>
      els
        .filter((e) => {
          const r = e.getBoundingClientRect();
          return r.width > 20 && r.height > 20 && getComputedStyle(e).visibility !== "hidden";
        })
        .map((e) => e.id || e.tagName.toLowerCase()),
    )
    .catch(() => [] as string[]);
  const text = (
    await page
      .locator("body")
      .innerText()
      .catch(() => "")
  ).match(BOT_CHECK)?.[0];
  if (shown.length || text) throw new BotCheck(`PayPal showed a bot check ${where} (${shown.length ? `challenge ${shown.join(", ")}` : `"${text}"`}). The run stopped there, as agreed; nothing was worked around.`);
}

/**
 * Logs the buyer in on PayPal's own page (the wallet pop-up, or sandbox.paypal.com). The password
 * field is filled without echo; callers keep tracing and screenshots off on these pages.
 */
export async function logInAsBuyer(page: Page, buyer: SandboxBuyer, where: string) {
  await stopOnBotCheck(page, where);
  const email = page.locator("#email, input[name='login_email']").first();
  await email.waitFor({ state: "visible", timeout: 30_000 });
  await email.fill(buyer.email);
  const password = page.locator("#password, input[name='login_password']").first();
  // PayPal asks for the email and password on one page or two (email, Next, then password).
  const next = page.locator("#btnNext");
  await next
    .or(password)
    .first()
    .waitFor({ state: "visible", timeout: 15_000 })
    .catch(() => {});
  if (await next.isVisible().catch(() => false)) await next.click();
  await stopOnBotCheck(page, where);
  await password.waitFor({ state: "visible", timeout: 30_000 });
  // An error from fill() is replaced by a plain one, so no message or log can carry the value.
  // PayPal slides the password step in after Next and can reset the field mid-slide, so check the
  // field holds the whole password (by length only, nothing is read back or printed) and refill.
  let typed = false;
  for (let i = 0; i < 4 && !typed; i++) {
    await page.waitForTimeout(1_000);
    await password.fill(buyer.password).catch(() => {
      throw new Error(`Couldn't type the sandbox buyer's password ${where}.`);
    });
    typed = await password.evaluate((el, n) => (el as HTMLInputElement).value.length === n, buyer.password.length).catch(() => false);
  }
  if (!typed) throw new Error(`PayPal's password field wouldn't keep the password ${where}: ${await describePage(page)}`);
  // The log-in button's id differs between PayPal's pages; Enter in the password field submits on all.
  const logIn = page.locator("#btnLogin").or(page.getByRole("button", { name: /^log ?in$/i }));
  if (!(await clickIfShown(page, logIn, 5_000))) await password.press("Enter");
  // Logged in once the password step is gone. PayPal's sandbox can be slow; say where it stopped if not.
  const through = await password.waitFor({ state: "hidden", timeout: 60_000 }).then(
    () => true,
    () => false,
  );
  await stopOnBotCheck(page, where);
  if (!through) {
    // Structure only: element ids, names, states and frame hosts, never a field's value.
    const shape = await page
      .evaluate(() => ({
        buttons: [...document.querySelectorAll("button, input[type=submit]")].map(
          (b) =>
            `${b.id || "-"}|${(b as HTMLButtonElement).name || "-"}|${(b.textContent || "").trim().slice(0, 30)}|${(b as HTMLElement).offsetParent ? "shown" : "hidden"}|${(b as HTMLButtonElement).disabled ? "disabled" : "on"}`,
        ),
        passwordFields: [...document.querySelectorAll("input[type=password]")].map(
          (i) => `${i.id}|${(i as HTMLInputElement).name}|invalid=${i.getAttribute("aria-invalid")}|${(i as HTMLElement).offsetParent ? "shown" : "hidden"}`,
        ),
        frames: [...document.querySelectorAll("iframe")].map((f) => {
          try {
            const u = new URL(f.src);
            return `${u.host}${u.pathname}|${f.title}`;
          } catch {
            return `-|${f.title}`;
          }
        }),
        errors: [...document.querySelectorAll("[role=alert], .notification, .notification-critical, [class*=errorMessage]")].map((e) => (e.textContent || "").trim().slice(0, 120)).filter(Boolean),
      }))
      .catch(() => ({}));
    throw new Error(`PayPal's log-in didn't go through ${where}: ${await describePage(page)} shape=${JSON.stringify(shape)}`);
  }
}

/** Where a PayPal page stopped, by path, headings, buttons and choices only (never field values). */
async function describePage(page: Page): Promise<string> {
  const texts = async (sel: ReturnType<Page["locator"]>) =>
    (await sel.allInnerTexts().catch(() => []))
      .map((t) => t.replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .slice(0, 10);
  return JSON.stringify({
    path: new URL(page.url()).pathname,
    headings: await texts(page.getByRole("heading")),
    alerts: await texts(
      page.locator('[role="alert"], [class*="error" i]:visible').filter({
        hasNotText: /^Notifications|Messages|You have no new messages/,
      }),
    ),
    dialog: (await texts(page.getByRole("dialog").filter({ visible: true }))).map((t) => t.slice(0, 400)),
    dialogActions: await texts(page.getByRole("dialog").filter({ visible: true }).locator("a, button")),
    buttons: await texts(page.getByRole("button")),
    choices: await texts(page.locator("label")),
  });
}

/** Clicks the first visible match, if any shows within the wait. */
async function clickIfShown(page: Page, target: ReturnType<Page["locator"]>, ms = 10_000): Promise<boolean> {
  const shown = await target
    .first()
    .waitFor({ state: "visible", timeout: ms })
    .then(
      () => true,
      () => false,
    );
  if (shown) await target.first().click();
  return shown;
}

/**
 * The buyer files a dispute on one capture from their PayPal account, in PayPal's Resolution Center
 * (/disputes/dashboard): choose the payment ("Test Store Payment ... $150.00 USD"), then on each
 * page pick the not-as-described reason, write the renter's words and continue, until PayPal says
 * the case is open. Each page is logged by its headings and buttons only. PayPal's sandbox can take
 * a while before a new payment can be disputed; the caller says so if the payment isn't offered.
 */
export async function fileDisputeAsBuyer(page: Page, buyer: SandboxBuyer, transactionId: string, message: string, amount = "$150.00"): Promise<"filed" | "not offered yet"> {
  await page.goto("https://www.sandbox.paypal.com/signin");
  await logInAsBuyer(page, buyer, "on the sandbox sign-in page");
  const visible = (sel: ReturnType<Page["locator"]>) => sel.filter({ visible: true }).first();
  try {
    // PayPal's filing page is keyed by the seller's capture id, so open this payment's own filing.
    await page.goto(`https://www.sandbox.paypal.com/resolutioncenter/filing/${transactionId}/create`);
    await stopOnBotCheck(page, "in the Resolution Center");
    const offered = await page
      .getByRole("button", {
        name: /not as described|continue reporting this issue/i,
      })
      .first()
      .waitFor({ state: "visible", timeout: 20_000 })
      .then(
        () => true,
        () => false,
      );
    if (!offered) {
      await page.goto("https://www.sandbox.paypal.com/resolutioncenter");
      await stopOnBotCheck(page, "in the Resolution Center");
      const money = amount.replace(/[$.]/g, (c) => `\\${c}`);
      // The payment (a capture), not the authorizations listed beside it.
      const byId = page.getByRole("button", {
        name: new RegExp(transactionId),
      });
      // The newest payment listed, not a half-filed draft from an earlier run ("Resume filing").
      const payment = page.getByRole("button", { name: new RegExp(`Payment\\b.*${money}`, "i") }).filter({ hasNotText: /steps completed|will be saved/i });
      if (!(await clickIfShown(page, byId, 5_000)) && !(await clickIfShown(page, payment, 30_000))) return "not offered yet";
    }
    const reasons = [
      /not as described|significantly (not as described|different)|different (from|than) (what was )?described/i,
      /problem with (the |my |this )?(item|purchase|order)|issue with (the |my |this )?(item|purchase|order)|item (issue|problem)/i,
    ];
    const done = /case (has been |was )?(opened|filed|submitted|created)|we('ve| have) (opened|received|filed)|dispute (has been |was )?(opened|filed|submitted|created)|case id|case number/i;
    const go_ = /^(continue|continue reporting this issue|next|submit|get started|start|file (a )?(dispute|claim|case)|open (a )?(dispute|case)|report (a )?problem|send|done)$/i;
    const next = page.getByRole("button", { name: go_ }).or(page.getByRole("link", { name: go_ }));
    // The item-details page: what was bought (a cabin booking) and how many.
    const fillIf = async (label: RegExp, value: string) => {
      const field = visible(page.getByLabel(label));
      if ((await field.isVisible().catch(() => false)) && !(await field.inputValue().catch(() => "x"))) await field.fill(value);
    };
    const pickIf = async (label: RegExp, option: string) => {
      const field = visible(page.getByLabel(label));
      if (!(await field.isVisible().catch(() => false))) return;
      if ((await field.evaluate((e) => e.tagName).catch(() => "")) === "SELECT") {
        if (!(await field.inputValue().catch(() => ""))) await field.selectOption({ label: option });
        return;
      }
      await field.click();
      await visible(
        page
          .getByRole("option", { name: option, exact: true })
          .or(page.getByRole("menuitem", { name: option, exact: true }))
          .or(page.getByText(option, { exact: true })),
      ).click({ timeout: 5_000 });
    };
    let last = "";
    let repeats = 0;
    for (let step = 1; step <= 12; step++) {
      await page.waitForLoadState("domcontentloaded");
      await page.waitForTimeout(2_000);
      await stopOnBotCheck(page, "in the Resolution Center");
      const heads = (
        await page
          .getByRole("heading")
          .allInnerTexts()
          .catch(() => [])
      ).join(" ");
      if (done.test(heads)) return "filed";
      const seen = await describePage(page);
      console.log(`buyer step ${step}: ${seen}`);
      repeats = seen === last ? repeats + 1 : 0;
      last = seen;
      if (repeats >= 2) {
        const dateShape = await visible(page.getByLabel(/^date/i))
          .evaluate((e) => {
            const i = e as HTMLInputElement;
            return `type=${i.type} placeholder=${i.placeholder} maxlength=${i.maxLength} inputmode=${i.inputMode} pattern=${i.pattern} value=${i.value} min=${i.min} max=${i.max} readonly=${i.readOnly} tag=${i.tagName}`;
          })
          .catch(() => "-");
        throw new Error(`PayPal kept the same page after Continue on step ${step} (date field ${dateShape})`);
      }
      await clickIfShown(page, page.getByRole("button", { name: /^yes, i accept$/i }), 1_000);
      await fillIf(/^item name/i, "Lakeside cabin stay");
      await pickIf(/^item type/i, "Booking");
      await pickIf(/^category/i, "Other");
      await fillIf(/^quantity/i, "1");
      // The problem page: when it happened (today, the check-out) and the refund asked for (the charge).
      const date = visible(page.getByLabel(/^date/i));
      // A masked field: its empty value is the mask itself ("MM/DD/YYYY").
      if ((await date.isVisible().catch(() => false)) && /^[MDY/_ ]*$/.test(await date.inputValue().catch(() => "x"))) {
        const now = new Date();
        const [y, m, d] = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, "0"), String(now.getDate()).padStart(2, "0")];
        if ((await date.getAttribute("type")) === "date") await date.fill(`${y}-${m}-${d}`);
        else {
          // Digits only, key by key from the start: the mask puts the slashes in.
          await date.click();
          await date.press("Home");
          await date.pressSequentially(`${m}${d}${y}`, { delay: 60 });
        }
        await date.press("Tab").catch(() => {});
      }
      await fillIf(/enter amount/i, amount.replace("$", ""));
      for (const reason of reasons) {
        const option = visible(
          page
            .getByRole("radio", { name: reason })
            .or(page.locator("label").filter({ hasText: reason }))
            .or(page.getByRole("button", { name: reason })),
        );
        if (await option.isVisible().catch(() => false)) {
          await option.click();
          break;
        }
      }
      for (const box of await page.locator("textarea").filter({ visible: true }).all()) if (!(await box.inputValue().catch(() => "x"))) await box.fill(message.padEnd(120, " Please review this charge."));
      const go = visible(next);
      if (
        !(await go.waitFor({ state: "visible", timeout: 15_000 }).then(
          () => true,
          () => false,
        ))
      ) {
        if (
          done.test(
            await page
              .locator("body")
              .innerText()
              .catch(() => ""),
          )
        )
          return "filed";
        throw new Error(`no Continue or Submit on step ${step}`);
      }
      await go.click();
    }
    throw new Error("PayPal's form kept going past 12 steps");
  } catch (e) {
    if (e instanceof BotCheck) throw e;
    throw new Error(`Filing the dispute as the buyer stopped: ${e instanceof Error ? e.message.split("\n")[0] : String(e)}. PayPal's page: ${await describePage(page)}`);
  }
}

/**
 * The renter places the hold with the PayPal wallet button: PayPal's own window opens, the sandbox
 * buyer logs in and agrees, and the window closes with the order approved.
 */
export async function payHoldWithWallet(renter: Page, buyer: SandboxBuyer) {
  // Sign in on PayPal's own sign-in page first, in the renter's browser: the checkout window then
  // opens already signed in. (A log-in typed inside the checkout window can sit there unanswered.)
  const signIn = await renter.context().newPage();
  await signIn.goto("https://www.sandbox.paypal.com/signin");
  await logInAsBuyer(signIn, buyer, "on the sandbox sign-in page");
  await signIn.close();
  const button = renter.getByTestId("paypal-v6-button").locator("paypal-button").first();
  await button.waitFor({ state: "visible", timeout: 30_000 });
  // PayPal draws the button before it wires the click up; click until its window opens.
  let popup: Page | undefined;
  for (let i = 0; i < 4 && !popup; i++) {
    const opened = renter.waitForEvent("popup", { timeout: 8_000 }).catch(() => undefined);
    await button.click({ timeout: 30_000 });
    popup = await opened;
  }
  if (!popup) throw new Error("PayPal's checkout window didn't open from the wallet button.");
  await popup.waitForLoadState("domcontentloaded");
  await stopOnBotCheck(popup, "in PayPal's checkout window");
  // Usually already signed in; log in here only if PayPal still asks.
  const asks = await popup
    .locator("#email, input[name='login_email'], #password")
    .first()
    .waitFor({ state: "visible", timeout: 15_000 })
    .then(
      () => true,
      () => false,
    );
  if (asks) await logInAsBuyer(popup, buyer, "in PayPal's checkout window");
  // PayPal may show one page or two (review, then agree) before it closes the window.
  // Whole names only: "Pay with" (a section toggle on the same page) must not count as "Pay".
  const agree = popup
    .locator("#payment-submit-btn")
    .or(
      popup.getByRole("button", {
        name: /^(Complete Purchase|Pay Now|Pay|Continue|Continue to Review Order|Agree & Continue|Agree and Continue|Agree & Pay|Save and Continue)$/i,
      }),
    )
    .first();
  const closed = popup
    .waitForEvent("close", { timeout: 120_000 })
    .then(() => true)
    .catch(() => false);
  for (let i = 0; i < 4 && !popup.isClosed(); i++) {
    const ready = await agree.waitFor({ state: "visible", timeout: 30_000 }).then(
      () => true,
      () => false,
    );
    if (!ready) break;
    await stopOnBotCheck(popup, "in PayPal's checkout window");
    await agree.click().catch(() => {});
    await Promise.race([closed, new Promise((r) => setTimeout(r, 15_000))]);
  }
  if (!popup.isClosed()) {
    // Say where it stopped, by page text only (never field values).
    throw new Error(`PayPal's checkout window stayed open: ${await describePage(popup)}`);
  }
}
