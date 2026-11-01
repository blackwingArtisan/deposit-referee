import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { InvalidEnvError, parseDotenv, readKitEnv } from "@/lib/env-core";
import { SANDBOX_API_BASE } from "@/lib/paypal/sandbox";
import { SpendBudget } from "@/lib/ai/budget";
import { AiBudgetExceededError } from "@/lib/ai/errors";
import { actualCostUsd, estimateInputTokens, worstCaseCostUsd } from "@/lib/ai/cost";
import { hit } from "@/lib/ai/rate-limit";
import { addMoney, compareMoney, money, scaleMoney, subtractMoney, toMinor } from "@/lib/money";

const env = (vars: Record<string, string> = {}) => vars as unknown as NodeJS.ProcessEnv;

describe("no live PayPal, ever", () => {
  it.each(["live", "production", "LIVE", "prod", "sandbox-live"])("refuses PAYPAL_MODE=%s", (mode) => {
    expect(() => readKitEnv(env({ PAYPAL_MODE: mode }))).toThrow(InvalidEnvError);
  });

  it("defaults to mock and requires credentials for sandbox", () => {
    expect(readKitEnv(env({})).paypalMode).toBe("mock");
    expect(() => readKitEnv(env({ PAYPAL_MODE: "sandbox" }))).toThrow(/PAYPAL_CLIENT_ID/);
    expect(readKitEnv(env({ PAYPAL_MODE: "sandbox", PAYPAL_CLIENT_ID: "a", PAYPAL_CLIENT_SECRET: "b" })).paypalMode).toBe("sandbox");
  });

  it("treats an empty PAYPAL_WEBHOOK_ID as not configured", () => {
    expect(readKitEnv(env({ PAYPAL_WEBHOOK_ID: "" })).paypalWebhookId).toBeUndefined();
  });

  it("keeps the demo test card off unless DEMO_TEST_CARD=1", () => {
    expect(readKitEnv(env({})).demoTestCard).toBe(false);
    expect(readKitEnv(env({ DEMO_TEST_CARD: "1" })).demoTestCard).toBe(true);
  });

  it("only knows the sandbox API host", () => {
    expect(SANDBOX_API_BASE).toBe("https://api-m.sandbox.paypal.com");
  });

  it("has no live PayPal hosts anywhere in src/", () => {
    const live = /https:\/\/(api-m|api)\.paypal\.com|https:\/\/www\.paypal\.com\/(sdk|web-sdk)/;
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(p);
        else if (/\.(ts|tsx|js|mjs)$/.test(entry.name) && live.test(fs.readFileSync(p, "utf8"))) offenders.push(p);
      }
    };
    walk(path.resolve("src"));
    expect(offenders).toEqual([]);
  });

  it("forces the PayPal Agent Toolkit into sandbox mode", () => {
    const src = fs.readFileSync(path.resolve("src/lib/agent/tools/toolkit.ts"), "utf8");
    expect(src).toMatch(/new PayPalAPI\(token, \{ sandbox: true/);
    expect(src).not.toMatch(/sandbox:\s*false/);
  });
});

describe("dotenv parser", () => {
  it("parses quotes, comments and export", () => {
    expect(parseDotenv(`# c\nexport A=1\nB="two words"\nC='x#y'\nD=plain # trailing\nE=`)).toEqual({ A: "1", B: "two words", C: "x#y", D: "plain", E: "" });
  });
});

describe("AI daily spend cap", () => {
  const file = path.join(os.tmpdir(), `kit-spend-${process.pid}-${Date.now()}.json`);

  it("refuses a call whose worst case would exceed the cap and persists real spend", () => {
    const budget = new SpendBudget(file, () => 0.01);
    const r1 = budget.reserve(0.006);
    expect(() => budget.reserve(0.006)).toThrow(AiBudgetExceededError); // in-flight reservations count
    budget.commit(r1, 0.002);
    const again = new SpendBudget(file, () => 0.01); // a new process sees persisted spend
    expect(again.status().spentUsd).toBeCloseTo(0.002);
    expect(() => again.reserve(0.0081)).toThrow(AiBudgetExceededError);
    const r2 = again.reserve(0.007);
    again.release(r2);
    expect(again.status().reservedUsd).toBe(0);
  });

  it("estimates worst case pessimistically (full max_tokens, fallback doubles Sonnet)", () => {
    const input = estimateInputTokens({ messages: [{ role: "user", content: "x".repeat(3000) }] });
    expect(input).toBeGreaterThanOrEqual(1000);
    expect(worstCaseCostUsd("claude-haiku-5-5", 1000, 8192)).toBeCloseTo((1000 * 0.1 + 8192 * 0.5) / 1e6);
    expect(worstCaseCostUsd("claude-sonnet-5-5", 1000, 8192)).toBeCloseTo(((1000 * 2 + 8192 * 10) / 1e6) * 2);
    expect(estimateInputTokens({ messages: [{ role: "user", content: [{ type: "image", source: { data: "A".repeat(300000) } }] }] })).toBeLessThan(6000);
  });

  it("prices actual usage, including the long-context Haiku rate", () => {
    const usage = { input_tokens: 1000, output_tokens: 500, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, iterations: null };
    expect(actualCostUsd({ model: "claude-haiku-5-5", usage } as never)).toBeCloseTo((1000 * 0.1 + 500 * 0.5) / 1e6);
    expect(actualCostUsd({ model: "claude-haiku-5-5", usage: { ...usage, input_tokens: 150_000 } } as never)).toBeCloseTo((150_000 * 0.5 + 500 * 2.5) / 1e6);
  });
});

describe("rate limiting", () => {
  it("allows the limit per window then returns seconds to wait", () => {
    const key = `t-${Math.random()}`;
    expect(hit(key, 2, 60_000, 1000)).toBe(0);
    expect(hit(key, 2, 60_000, 2000)).toBe(0);
    expect(hit(key, 2, 60_000, 3000)).toBe(58);
    expect(hit(key, 2, 60_000, 62_000)).toBe(0);
  });
});

describe("money", () => {
  it("does exact decimal math in minor units", () => {
    expect(addMoney(money("0.10"), money("0.20"))).toEqual(money("0.30"));
    expect(subtractMoney(money("120.00"), money("45.55"))).toEqual(money("74.45"));
    expect(compareMoney(money("10"), money("9.99"))).toBeGreaterThan(0);
    expect(scaleMoney(money("100.00"), 0.0349)).toEqual(money("3.49"));
    expect(toMinor("1000", "JPY")).toBe(1000);
    expect(() => toMinor("1.234", "USD")).toThrow();
  });
});
