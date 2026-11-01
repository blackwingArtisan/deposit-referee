/**
 * The money rules. All amounts are integer US cents; PayPal's decimal strings are converted at
 * the edge. Safe to import in the browser: the host's preview uses the same maths as the server.
 */
import { fromMinor, toMinor } from "@/lib/money";

/** PayPal authorizations stop being capturable after 29 days. */
export const HOLD_LIMIT_DAYS = 29;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Matches the Guard's per-action cap in app.config.ts. */
export const MIN_DEPOSIT_CENTS = 100;
export const MAX_DEPOSIT_CENTS = 50_000;

const CURRENCY = "USD";

export class RuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuleError";
  }
}

function assertCents(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value < 0) throw new RuleError(`${label} must be a whole number of cents, got ${value}.`);
}

/** Always authorized minus captured. Nothing else, and never the AI, decides this number. */
export function releasedCents(authorizedCents: number, capturedCents: number): number {
  assertCents(authorizedCents, "Authorized amount");
  assertCents(capturedCents, "Captured amount");
  if (capturedCents > authorizedCents) throw new RuleError(`Captured ${formatCents(capturedCents)} is more than the ${formatCents(authorizedCents)} hold.`);
  return authorizedCents - capturedCents;
}

/** Throws unless the host's exact charge fits inside the hold. */
export function assertChargeFits(chargeCents: number, authorizedCents: number) {
  assertCents(chargeCents, "Charge");
  if (chargeCents === 0) throw new RuleError("Enter a charge of at least $0.01.");
  releasedCents(authorizedCents, chargeCents);
}

export interface HoldClock {
  expiresAt: string;
  limitDays: number;
  /** Whole days left, rounded up. 0 once expired. */
  daysLeft: number;
  expired: boolean;
}

export function holdClock(expiresAt: string, now = Date.now()): HoldClock {
  const end = Date.parse(expiresAt);
  if (Number.isNaN(end)) throw new RuleError(`Invalid hold expiry: ${expiresAt}`);
  const expired = now >= end;
  return { expiresAt, limitDays: HOLD_LIMIT_DAYS, daysLeft: expired ? 0 : Math.ceil((end - now) / DAY_MS), expired };
}

export function assertHoldOpen(expiresAt: string, now = Date.now()) {
  if (holdClock(expiresAt, now).expired) throw new RuleError(`This hold expired on ${new Date(expiresAt).toUTCString()}. PayPal holds last ${HOLD_LIMIT_DAYS} days, so nothing can be captured from it.`);
}

export function dollarsToCents(value: string): number {
  return toMinor(value, CURRENCY);
}

/** "150.00", for PayPal and for form fields. */
export function centsToDollars(cents: number): string {
  return fromMinor(cents, CURRENCY);
}

/** "$150" for whole dollars, "$150.50" otherwise. */
export function formatCents(cents: number): string {
  const dollars = centsToDollars(cents);
  return `$${dollars.endsWith(".00") ? dollars.slice(0, -3) : dollars}`;
}

/** "$150.00": used wherever the host is agreeing to an exact amount. */
export function formatExactCents(cents: number): string {
  return `$${centsToDollars(cents)}`;
}

/** Reads the host's charge field. Never throws, because it runs on every keystroke. */
export function parseCharge(value: string, authorizedCents: number): { cents: number; error?: undefined } | { cents?: undefined; error: string } {
  try {
    const cents = dollarsToCents(value);
    assertChargeFits(cents, authorizedCents);
    return { cents };
  } catch (e) {
    return { error: e instanceof RuleError ? e.message : "Enter an amount like 150.00." };
  }
}
