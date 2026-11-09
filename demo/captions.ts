/**
 * Helpers for silent, captioned demo videos. Everything is injected into the page with
 * page.evaluate, so it works on any page without app support.
 *
 *   await titleCard(page, "Settle partial shipments with PayPal", "An AI agent with a human in the loop");
 *   await caption(page, "The buyer approves a $120 hold with PayPal");
 *   await highlight(page, page.getByTestId("run-agent"));
 */
import fs from "node:fs";
import path from "node:path";
import type { Locator, Page } from "@playwright/test";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Height of the caption band at the bottom of the frame. Pages get the same padding, so it never covers content. */
export const BAND_PX = 96;

/**
 * A caption in a dark band across the bottom of the frame. The page is padded by the band's
 * height and toasts are lifted above it, so the caption never sits on what it describes.
 * Waits `ms` (reading time) unless wait=false.
 */
export async function caption(page: Page, text: string, opts: { ms?: number; wait?: boolean } = {}) {
  const ms = opts.ms ?? Math.min(6000, 1400 + text.length * 45);
  await page.evaluate(
    ({ text, ms, band }) => {
      if (!document.getElementById("__demo_band_style")) {
        const style = document.createElement("style");
        style.id = "__demo_band_style";
        style.textContent = `body{padding-bottom:${band + 16}px!important} html{scroll-padding-bottom:${band + 16}px} [aria-live="polite"].fixed{bottom:${band + 12}px!important}`;
        document.head.appendChild(style);
      }
      let el = document.getElementById("__demo_caption");
      if (!el) {
        el = document.createElement("div");
        el.id = "__demo_caption";
        Object.assign(el.style, {
          position: "fixed", left: "0", right: "0", bottom: "0", height: `${band}px`, zIndex: "2147483647",
          display: "flex", alignItems: "center", justifyContent: "center", padding: "0 48px",
          background: "#09090b", color: "#fff", font: "600 25px/1.3 ui-sans-serif, system-ui, -apple-system, sans-serif",
          textAlign: "center", pointerEvents: "none",
        });
        const span = document.createElement("span");
        span.style.transition = "opacity .25s";
        el.appendChild(span);
        document.body.appendChild(el);
      }
      const span = el.firstElementChild as HTMLElement;
      span.textContent = text;
      span.style.opacity = "1";
      clearTimeout((window as unknown as { __demoCaptionTimer?: number }).__demoCaptionTimer);
      (window as unknown as { __demoCaptionTimer?: number }).__demoCaptionTimer = window.setTimeout(() => {
        span.style.opacity = "0";
      }, ms);
    },
    { text, ms, band: BAND_PX },
  );
  if (opts.wait !== false) await sleep(ms);
}

/** Zooms in on one element (say, the AI's box) for a moment, then back out. */
export async function zoomOn(page: Page, target: Locator, opts: { scale?: number; ms?: number } = {}) {
  const { scale = 2.6, ms = 3200 } = opts;
  await target.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await sleep(400);
  const handle = await target.elementHandle();
  await page.evaluate(
    ({ el, scale }) => {
      const frame = (el as HTMLElement).parentElement!;
      const a = (el as HTMLElement).getBoundingClientRect();
      const f = frame.getBoundingClientRect();
      frame.dataset.demoZoom = "1";
      Object.assign(frame.style, { position: "relative", zIndex: "40", transition: "transform .8s ease", transformOrigin: `${a.left - f.left + a.width / 2}px ${a.top - f.top + a.height / 2}px`, boxShadow: "0 30px 80px rgba(0,0,0,.45)" });
      requestAnimationFrame(() => (frame.style.transform = `scale(${scale})`));
    },
    { el: handle, scale },
  );
  await sleep(ms);
  await page.evaluate(() => {
    const frame = document.querySelector<HTMLElement>("[data-demo-zoom]");
    if (frame) frame.style.transform = "scale(1)";
  });
  await sleep(900);
  await page.evaluate(() => {
    const frame = document.querySelector<HTMLElement>("[data-demo-zoom]");
    if (frame) Object.assign(frame.style, { zIndex: "", boxShadow: "", transform: "" });
    delete frame?.dataset.demoZoom;
  });
}

/** Shows a page the way a renter sees it on their phone: a 375px-wide screen in the middle of the frame. */
export async function openPhone(page: Page, url: string) {
  await page.evaluate(
    ({ url, band }) => {
      const wrap = document.createElement("div");
      wrap.id = "__demo_phone";
      Object.assign(wrap.style, {
        position: "fixed", inset: "0", bottom: `${band}px`, zIndex: "2147483600", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden",
        background: "radial-gradient(ellipse at top, #134e4a, #09090b 75%)", opacity: "0", transition: "opacity .4s",
      });
      const phone = document.createElement("div");
      Object.assign(phone.style, { width: "399px", height: `calc(100% - 28px)`, padding: "12px", borderRadius: "44px", background: "#111", boxShadow: "0 30px 80px rgba(0,0,0,.6), inset 0 0 0 2px #333" });
      const frame = document.createElement("iframe");
      frame.src = url;
      Object.assign(frame.style, { width: "375px", height: "100%", border: "0", borderRadius: "32px", background: "#fff" });
      phone.appendChild(frame);
      wrap.appendChild(phone);
      document.body.appendChild(wrap);
      requestAnimationFrame(() => (wrap.style.opacity = "1"));
    },
    { url, band: BAND_PX },
  );
  await sleep(500);
  return page.frameLocator("#__demo_phone iframe");
}

/** Zooms the phone in on one element inside it, so a tap or an answer reads at video size. */
export async function zoomPhone(page: Page, target: Locator, scale = 1.7) {
  const box = await target.boundingBox();
  if (!box) return;
  await page.evaluate(
    ({ box, scale }) => {
      const phone = document.querySelector<HTMLElement>("#__demo_phone > div");
      if (!phone) return;
      const p = phone.getBoundingClientRect();
      Object.assign(phone.style, { transition: "transform .6s ease", transformOrigin: `${box.x + box.width / 2 - p.left}px ${box.y + box.height / 2 - p.top}px` });
      requestAnimationFrame(() => (phone.style.transform = `scale(${scale})`));
    },
    { box, scale },
  );
  await sleep(650);
}

export async function closePhone(page: Page) {
  await page.evaluate(() => document.getElementById("__demo_phone")?.remove());
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

export interface Span {
  label: string;
  from: number;
  to: number;
}

/**
 * Keeps the edited video under its limit. A wait the edit cuts (Claude comparing, PayPal's form
 * filling itself in, a capture on its way) is wrapped in `cut()`: it doesn't count, and its span in
 * the raw recording goes into the edit list (videos/demo-*.cuts.json) that `npm run demo:mp4`
 * applies. `sync()` marks the opening title card, which the edit finds in the video to line up.
 */
export class DemoClock {
  private readonly start = Date.now();
  private cutMs = 0;
  readonly cuts: Span[] = [];
  private syncAt?: number;
  constructor(private readonly limitSeconds = 120) {}

  /** Call just before the opening title card (a white page turning dark). */
  sync() {
    this.syncAt = this.raw + 0.2;
  }
  /** Seconds into the raw recording. */
  get raw() {
    return (Date.now() - this.start) / 1000;
  }
  /** Seconds into the edited video. */
  get seconds() {
    return Math.round((Date.now() - this.start - this.cutMs) / 1000);
  }
  /** Seconds into the edited video, unrounded: where a voiceover line starts. */
  get exact() {
    return (Date.now() - this.start - this.cutMs) / 1000;
  }
  /** Runs a wait and cuts it from the video, keeping its first `keepMs`. */
  async cut<T>(label: string, wait: () => Promise<T>, keepMs = 0): Promise<T> {
    const from = this.raw;
    const result = await wait();
    const to = this.raw;
    const cut = Math.max(0, (to - from) * 1000 - keepMs);
    if (cut > 0) {
      this.cutMs += cut;
      this.cuts.push({ label, from: from + keepMs / 1000, to });
      console.log(`[demo] cut "${label}": raw ${(from + keepMs / 1000).toFixed(1)}s to ${to.toFixed(1)}s`);
    }
    return result;
  }
  /** Ends the video here: everything after this moment is cut. */
  end() {
    this.cuts.push({ label: "after the end card", from: this.raw, to: this.raw + 3600 });
  }
  /** Seconds of `[from, to]` (raw) that stay in the edited video. */
  onCamera(from: number, to: number) {
    return to - from - merge(this.cuts).reduce((sum, c) => sum + Math.max(0, Math.min(to, c.to) - Math.max(from, c.from)), 0);
  }
  check(label: string) {
    const s = this.seconds;
    console.log(`[demo] ${label} at ${s}s (raw ${Math.round(this.raw)}s)`);
    if (s > this.limitSeconds) throw new Error(`Demo is ${s}s at "${label}" (limit ${this.limitSeconds}s). Cut scenes or shorten captions.`);
  }
  /** Writes the edit list webm-to-mp4.sh applies: raw-second spans to cut, merged and sorted. */
  writeCuts(file: string) {
    const cuts = merge(this.cuts);
    const cutSeconds = cuts.reduce((sum, c) => sum + Math.max(0, Math.min(c.to, this.raw) - c.from), 0);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ rawSeconds: this.raw, cutSeconds, syncAt: this.syncAt, cuts }, null, 2));
    return { cuts, videoSeconds: this.raw - cutSeconds };
  }
}

/** Overlapping spans joined into one, in order. */
function merge(spans: Span[]): Span[] {
  const out: Span[] = [];
  for (const s of [...spans].sort((a, b) => a.from - b.from)) {
    const last = out.at(-1);
    if (last && s.from <= last.to) {
      last.to = Math.max(last.to, s.to);
      last.label = `${last.label} + ${s.label}`;
    } else out.push({ ...s });
  }
  return out;
}
