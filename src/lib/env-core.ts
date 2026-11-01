/**
 * Environment loading + validation with no app imports, so next.config.ts, scripts and
 * tests can all use it.
 *
 * Precedence (first wins; a value that is already set is never overwritten):
 *   1. real process env (shell, Render dashboard)
 *   2. .env.local in the app directory
 *   3. the shared credentials file: $ENV_SHARED_PATH, else ../../.env.shared (apps/<slug>/),
 *      else ../.env.shared (the kit itself)
 *
 * There is deliberately no "live" mode. PAYPAL_MODE must be "mock" or "sandbox".
 */
import fs from "node:fs";
import path from "node:path";

export type PayPalMode = "mock" | "sandbox";
export type AiMode = "live" | "mock";

export class InvalidEnvError extends Error {
  constructor(message: string) {
    super(`[kit env] ${message}`);
    this.name = "InvalidEnvError";
  }
}

/** Minimal dotenv parser: KEY=VALUE, optional `export `, # comments, single/double quotes. */
export function parseDotenv(src: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of src.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1];
    let value = m[2];
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.lastIndexOf(quote) > 0) {
      value = value.slice(1, value.lastIndexOf(quote));
      if (quote === '"') value = value.replace(/\\n/g, "\n").replace(/\\"/g, '"');
    } else {
      const hash = value.indexOf(" #");
      if (hash >= 0) value = value.slice(0, hash);
      value = value.trim();
    }
    out[key] = value;
  }
  return out;
}

export function sharedEnvCandidates(cwd = process.cwd()): string[] {
  const list = [
    process.env.ENV_SHARED_PATH,
    path.resolve(/*turbopackIgnore: true*/ cwd, "../../.env.shared"),
    path.resolve(/*turbopackIgnore: true*/ cwd, "../.env.shared"),
  ];
  return list.filter((p): p is string => Boolean(p));
}

let loadedFiles: string[] | null = null;

/** Loads .env.local then the first shared env file found. Idempotent. Returns files loaded. */
export function loadEnvFiles(cwd = process.cwd(), opts: { force?: boolean } = {}): string[] {
  if (loadedFiles && !opts.force) return loadedFiles;
  const files: string[] = [];
  const apply = (file: string) => {
    if (!fs.existsSync(file)) return false;
    const parsed = parseDotenv(fs.readFileSync(file, "utf8"));
    for (const [k, v] of Object.entries(parsed)) {
      if (process.env[k] === undefined || process.env[k] === "") process.env[k] = v;
    }
    files.push(file);
    return true;
  };
  apply(path.resolve(/*turbopackIgnore: true*/ cwd, ".env.local"));
  for (const candidate of sharedEnvCandidates(cwd)) {
    if (apply(candidate)) break;
  }
  loadedFiles = files;
  return files;
}

export interface KitEnv {
  paypalMode: PayPalMode;
  paypalClientId?: string;
  paypalClientSecret?: string;
  paypalWebhookId?: string;
  sandboxBuyerEmail: string;
  sandboxSellerEmail: string;
  anthropicApiKey?: string;
  aiMode: AiMode;
  aiDailyCapUsd: number;
  dataDir: string;
  /** e.g. "150-450" (random ms range) or "0". Mock PayPal only. */
  mockLatency: [number, number];
  /** DEMO_TEST_CARD=1: sandbox recordings pay with the test card instead of a buyer login. */
  demoTestCard: boolean;
  isProduction: boolean;
}

function parseLatency(raw: string | undefined, fallback: [number, number]): [number, number] {
  if (!raw) return fallback;
  const parts = raw.split("-").map((p) => Number(p.trim()));
  if (parts.some((n) => !Number.isFinite(n) || n < 0)) return fallback;
  return parts.length === 1 ? [parts[0], parts[0]] : [Math.min(parts[0], parts[1]), Math.max(parts[0], parts[1])];
}

/** Reads + validates process.env. Throws InvalidEnvError for anything unsafe. */
export function readKitEnv(env: NodeJS.ProcessEnv = process.env): KitEnv {
  const rawMode = (env.PAYPAL_MODE ?? "mock").trim().toLowerCase();
  if (rawMode !== "mock" && rawMode !== "sandbox") {
    throw new InvalidEnvError(
      `PAYPAL_MODE="${env.PAYPAL_MODE}" is not allowed. Use "mock" or "sandbox". ` +
        "This kit has no live/production mode and refuses to start.",
    );
  }
  const paypalMode = rawMode as PayPalMode;
  const clientId = env.PAYPAL_CLIENT_ID?.trim() || undefined;
  const clientSecret = env.PAYPAL_CLIENT_SECRET?.trim() || undefined;
  if (paypalMode === "sandbox" && (!clientId || !clientSecret)) {
    throw new InvalidEnvError(
      "PAYPAL_MODE=sandbox requires PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET (sandbox app credentials). " +
        "Set PAYPAL_MODE=mock to run without credentials.",
    );
  }

  const capRaw = env.AI_DAILY_CAP_USD?.trim();
  const cap = capRaw ? Number(capRaw) : 2;
  if (!Number.isFinite(cap) || cap < 0) {
    throw new InvalidEnvError(`AI_DAILY_CAP_USD="${capRaw}" must be a non-negative number.`);
  }

  const apiKey = env.ANTHROPIC_API_KEY?.trim() || undefined;
  const aiModeRaw = env.AI_MODE?.trim().toLowerCase();
  const aiMode: AiMode = aiModeRaw === "mock" || !apiKey ? "mock" : "live";

  return {
    paypalMode,
    paypalClientId: clientId,
    paypalClientSecret: clientSecret,
    paypalWebhookId: env.PAYPAL_WEBHOOK_ID?.trim() || undefined,
    sandboxBuyerEmail: env.PAYPAL_SANDBOX_BUYER_EMAIL?.trim() || "buyer@personal.example.com",
    sandboxSellerEmail: env.PAYPAL_SANDBOX_SELLER_EMAIL?.trim() || "seller@business.example.com",
    anthropicApiKey: apiKey,
    aiMode,
    aiDailyCapUsd: cap,
    dataDir: path.resolve(/*turbopackIgnore: true*/ env.KIT_DATA_DIR?.trim() || ".data"),
    mockLatency: parseLatency(env.MOCK_PAYPAL_LATENCY_MS, [120, 420]),
    demoTestCard: env.DEMO_TEST_CARD === "1",
    isProduction: env.NODE_ENV === "production",
  };
}
