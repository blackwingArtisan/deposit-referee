/**
 * DEMO_REQUIRE_LIVE=1: the recording fails if any frame shows mock or simulated text, so a take
 * meant for judges can't be made on mock PayPal or mock AI by mistake. It reads the visible text
 * of the page and of every frame in it (the phone, PayPal's own frames) every half second, and
 * at every caption, which covers the captions themselves.
 */
import type { Page } from "@playwright/test";

export const NOT_LIVE = /\bmock\b|simulated/i;

export class LiveGuard {
  readonly on = process.env.DEMO_REQUIRE_LIVE === "1";
  private hit: string | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private scanning = false;

  constructor(private readonly page: Page) {}

  start() {
    if (!this.on || this.timer) return;
    console.log("[demo] DEMO_REQUIRE_LIVE=1: any visible mock or simulated text fails the run");
    this.timer = setInterval(() => void this.scan("between captions"), 500);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Scans now and throws if this scan, or any since the last check, found mock or simulated text. */
  async check(scene: string) {
    if (!this.on) return;
    await this.scan(scene);
    if (this.hit) {
      this.stop();
      throw new Error(`DEMO_REQUIRE_LIVE=1, and the recording shows text that isn't live: ${this.hit}. Record on the PayPal sandbox with live AI (DEMO_BASE_URL=<hosted site>).`);
    }
  }

  private async scan(scene: string) {
    if (this.hit || this.scanning || this.page.isClosed()) return;
    this.scanning = true;
    try {
      for (const frame of this.page.frames()) {
        const text = await frame.evaluate(() => document.body?.innerText ?? "").catch(() => "");
        const match = NOT_LIVE.exec(text);
        if (!match) continue;
        const line = text.split("\n").find((l) => NOT_LIVE.test(l))?.trim().slice(0, 120) ?? match[0];
        this.hit = `"${line}" (${scene}, ${frame === this.page.mainFrame() ? "page" : `frame ${frame.url().slice(0, 80)}`})`;
        return;
      }
    } finally {
      this.scanning = false;
    }
  }
}
