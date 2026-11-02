import Anthropic from "@anthropic-ai/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { guardedClaudeCall, isCreditFailure } from "@/lib/ai/client";
import { AiCreditError } from "@/lib/ai/errors";
import { getBudget } from "@/lib/ai/budget";
import { resetEnvCache } from "@/lib/env";

const apiError = (status: number, type: string, message: string) =>
  Anthropic.APIError.generate(status, { type: "error", error: { type, message } }, undefined, new Headers());

const call = (fail: () => never) =>
  guardedClaudeCall({ model: "claude-haiku-5-5", max_tokens: 10, messages: [{ role: "user", content: "hi" }] }, { feature: "test" }, async () => fail());

describe("an empty AI account", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    resetEnvCache();
  });
  const live = () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key-not-real");
    vi.stubEnv("AI_MODE", "live");
    resetEnvCache();
  };

  it("recognizes both ways Anthropic reports it, and nothing else", () => {
    expect(isCreditFailure(apiError(400, "invalid_request_error", "Your credit balance is too low to access the Anthropic API."))).toBe(true);
    expect(isCreditFailure(apiError(402, "billing_error", "Payment required."))).toBe(true);
    expect(isCreditFailure(apiError(400, "invalid_request_error", "max_tokens is too large"))).toBe(false);
    expect(isCreditFailure(apiError(429, "rate_limit_error", "Slow down."))).toBe(false);
    expect(isCreditFailure(new Error("credit balance"))).toBe(false);
  });

  it("turns the API's error into the host's message and gives the reserved money back", async () => {
    live();
    const before = getBudget().status();
    await expect(call(() => { throw apiError(400, "invalid_request_error", "Your credit balance is too low."); })).rejects.toThrow(AiCreditError);
    await expect(call(() => { throw apiError(400, "invalid_request_error", "Your credit balance is too low."); })).rejects.toThrow(/No money moved, and the deposit is still on hold/);
    expect(getBudget().status()).toEqual(before);
  });

  it("leaves every other failure alone", async () => {
    live();
    await expect(call(() => { throw apiError(400, "invalid_request_error", "max_tokens is too large"); })).rejects.toThrow(/max_tokens/);
  });

  it("explains a spent daily limit the same way", async () => {
    vi.stubEnv("AI_DAILY_CAP_USD", "0");
    live();
    await expect(call(() => { throw new Error("never reached"); })).rejects.toThrow(/Today's AI limit is used up.*No money moved/);
  });
});
