export class AiUnavailableError extends Error {
  readonly status = 503;
  constructor(message = "AI is in mock mode (no ANTHROPIC_API_KEY) and this call has no mock fixture.") {
    super(message);
    this.name = "AiUnavailableError";
  }
}

export class AiBudgetExceededError extends Error {
  readonly status = 402;
  constructor(
    readonly capUsd: number,
    readonly spentUsd: number,
    readonly estimateUsd: number,
  ) {
    super(
      `AI daily spend cap reached: $${spentUsd.toFixed(4)} spent of $${capUsd.toFixed(2)}; this call could cost up to $${estimateUsd.toFixed(4)}. Resets at 00:00 UTC.`,
    );
    this.name = "AiBudgetExceededError";
  }
}

export class AiRefusalError extends Error {
  readonly status = 422;
  constructor(
    readonly category: string | null,
    explanation?: string | null,
  ) {
    super(`Claude declined this request${category ? ` (${category})` : ""}${explanation ? `: ${explanation}` : ""}`);
    this.name = "AiRefusalError";
  }
}

export class AiOutputError extends Error {
  readonly status = 502;
  constructor(message: string) {
    super(message);
    this.name = "AiOutputError";
  }
}

export class RateLimitedError extends Error {
  readonly status = 429;
  constructor(readonly retryAfterSeconds: number) {
    super(`Too many requests. Try again in ${retryAfterSeconds}s.`);
    this.name = "RateLimitedError";
  }
}
