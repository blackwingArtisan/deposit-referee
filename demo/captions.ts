/**
 * Helpers for silent, captioned demo videos. Everything is injected into the page with
 * page.evaluate, so it works on any page without app support.
 *
 *   await titleCard(page, "Settle partial shipments with PayPal", "An AI agent with a human in the loop");
 *   await caption(page, "The buyer approves a $120 hold with PayPal");
 *   await highlight(page, page.getByTestId("run-agent"));
 */
import type { Locator, Page } from "@playwright/test";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Bottom-centre caption. Waits `ms` (reading time) unless wait=false. */
export async function caption(page: Page, text: string, opts: { ms?: number; wait?: boolean } = {}) {
  const ms = opts.ms ?? Math.min(6000, 1400 + text.length * 45);
  await page.evaluate(
    ({ text, ms }) => {
      let el = document.getElementById("__demo_caption");
      if (!el) {
        el = document.createElement("div");
        el.id = "__demo_caption";
        Object.assign(el.style, {
          position: "fixed", left: "50%", bottom: "36px", transform: "translateX(-50%) translateY(10px)", zIndex: "2147483647",
          maxWidth: "min(1000px, calc(100vw - 48px))", padding: "16px 26px", borderRadius: "18px",
          background: "rgba(9,9,11,0.9)", color: "#fff", font: "600 24px/1.35 ui-sans-serif, system-ui, -apple-system, sans-serif",
          textAlign: "center", boxShadow: "0 20px 50px rgba(0,0,0,.35)", opacity: "0", transition: "opacity .3s, transform .3s", pointerEvents: "none",
        });
        document.body.appendChild(el);
      }
      el.textContent = text;
      requestAnimationFrame(() => {
        el!.style.opacity = "1";
        el!.style.transform = "translateX(-50%) translateY(0)";
      });
      clearTimeout((window as unknown as { __demoCaptionTimer?: number }).__demoCaptionTimer);
      (window as unknown as { __demoCaptionTimer?: number }).__demoCaptionTimer = window.setTimeout(() => {
        el!.style.opacity = "0";
      }, ms);
    },
    { text, ms },
  );
  if (opts.wait !== false) await sleep(ms);
}

/** Full-screen title card (intro/outro). */
export async function titleCard(page: Page, title: string, subtitle = "", ms = 3200) {
  await page.evaluate(
    ({ title, subtitle }) => {
      const el = document.createElement("div");
      el.id = "__demo_title";
      el.innerHTML = `<div style="font:700 56px/1.1 ui-sans-serif,system-ui;letter-spacing:-0.02em">${title}</div>${subtitle ? `<div style="margin-top:18px;font:500 26px/1.4 ui-sans-serif,system-ui;opacity:.8">${subtitle}</div>` : ""}`;
      Object.assign(el.style, {
        position: "fixed", inset: "0", zIndex: "2147483647", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        textAlign: "center", padding: "48px", color: "#fff", background: "radial-gradient(ellipse at top, var(--brand, #0070e0), #0b1020 70%)",
        opacity: "0", transition: "opacity .4s",
      });
      document.body.appendChild(el);
      requestAnimationFrame(() => (el.style.opacity = "1"));
    },
    { title, subtitle },
  );
  await sleep(ms);
  await page.evaluate(() => {
    const el = document.getElementById("__demo_title");
    if (el) {
      el.style.opacity = "0";
      setTimeout(() => el.remove(), 400);
    }
  });
  await sleep(450);
}

/** Pulsing outline around an element so viewers know where to look. */
export async function highlight(page: Page, target: Locator, ms = 1600) {
  const box = await target.boundingBox();
  if (!box) return;
  await page.evaluate(
    ({ box, ms }) => {
      const el = document.createElement("div");
      Object.assign(el.style, {
        position: "fixed", left: `${box.x - 6}px`, top: `${box.y - 6}px`, width: `${box.width + 12}px`, height: `${box.height + 12}px`,
        border: "3px solid #f59e0b", borderRadius: "14px", zIndex: "2147483646", pointerEvents: "none",
        boxShadow: "0 0 0 6px rgba(245,158,11,.25)", transition: "opacity .3s",
      });
      document.body.appendChild(el);
      setTimeout(() => {
        el.style.opacity = "0";
        setTimeout(() => el.remove(), 300);
      }, ms);
    },
    { box, ms },
  );
  await sleep(Math.min(ms, 900));
}

/** Keeps the video under Devpost's 3-minute limit. */
export class DemoClock {
  private readonly start = Date.now();
  constructor(private readonly limitSeconds = 170) {}
  get seconds() {
    return Math.round((Date.now() - this.start) / 1000);
  }
  check(label: string) {
    const s = this.seconds;
    console.log(`[demo] ${label} at ${s}s`);
    if (s > this.limitSeconds) throw new Error(`Demo is ${s}s at "${label}" (limit ${this.limitSeconds}s). Cut scenes or shorten captions.`);
  }
}
