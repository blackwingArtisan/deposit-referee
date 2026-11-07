/**
 * The money rules. All amounts are integer US cents; PayPal's decimal strings are converted at
 * the edge. Safe to import in the browser: the host's preview uses the same maths as the server.
 */
import { fromMinor, toMinor } from "@/lib/money";

/** PayPal authorizations stop being capturable after 29 days. */
export const HOLD_LIMIT_DAYS = 29;
/** PayPal guarantees the funds for the first 3 days (the honor period); after that a capture can fail. */
export const HONOR_DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Matches the Guard's per-action cap in app.config.ts. */
export const MIN_DEPOSIT_CENTS = 100;
export const MAX_DEPOSIT_CENTS = 50_000;

/** How long the renter has to answer a proposed charge before the host may go ahead. */
export const RENTER_WINDOW_HOURS = 48;

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

/**
 * The hard limit on any capture, whatever the agent or a request asks for: above zero, inside
 * the hold, and no more than the itemized damage. Every capture path runs this.
 */
export function assertCaptureLimits(chargeCents: number, itemizedCents: number, heldCents: number) {
  assertChargeFits(chargeCents, heldCents);
  assertCents(itemizedCents, "Itemized damage");
  if (chargeCents > itemizedCents) throw new RuleError(`${formatExactCents(chargeCents)} is more than the ${formatExactCents(itemizedCents)} of itemized damage.`);
}

export function itemizedCents(lines: { amountCents: number }[]): number {
  return lines.reduce((sum, line) => sum + line.amountCents, 0);
}

/** The renter's window ends in 48 hours, or an hour before the hold does if that comes first. */
export function renterDeadline(holdExpiresAt: string | undefined, now = Date.now()): string {
  const window = now + RENTER_WINDOW_HOURS * 60 * 60 * 1000;
  const holdEnd = holdExpiresAt ? Date.parse(holdExpiresAt) - 60 * 60 * 1000 : window;
  return new Date(Math.min(window, holdEnd)).toISOString();
}

export interface RenterClearance {
  cleared: boolean;
  reason: string;
  /** Still waiting on the renter until this time. The browser shows it in the reader's own zone. */
  until?: string;
}

/** A deadline in the reader's own time zone, with the zone named. Call it in the browser. */
export function localTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });
}

/** Whether the host may send this charge to the approval gate. A contest was heard if the host is looking at it. */
export function renterClearance(renter: { deadline: string; response?: { decision: "accepted" | "contested"; amountCents: number } } | undefined, chargeCents: number, now = Date.now()): RenterClearance {
  if (!renter) return { cleared: false, reason: "The renter hasn't seen a proposal yet." };
  const { deadline, response } = renter;
  if (response && chargeCents > response.amountCents) return { cleared: false, reason: `The renter answered ${formatExactCents(response.amountCents)}, so a higher charge needs a new answer.` };
  if (response?.decision === "accepted") return { cleared: true, reason: "The renter accepted this charge." };
  if (response?.decision === "contested") return { cleared: true, reason: "The renter contested. Read their note before you decide." };
  if (now >= Date.parse(deadline)) return { cleared: true, reason: "The renter didn't answer in time." };
  return { cleared: false, reason: "The renter still has time to accept or contest.", until: deadline };
}

export interface HoldClock {
  expiresAt: string;
  /** End of PayPal's honor period: the authorization is 29 days long, so this is 26 days before it ends. */
  guaranteedUntil: string;
  limitDays: number;
  /** Whole days left, rounded up. 0 once expired. */
  daysLeft: number;
  expired: boolean;
}

export function holdClock(expiresAt: string, now = Date.now()): HoldClock {
  const end = Date.parse(expiresAt);
  if (Number.isNaN(end)) throw new RuleError(`Invalid hold expiry: ${expiresAt}`);
  const expired = now >= end;
  const guaranteedUntil = new Date(end - (HOLD_LIMIT_DAYS - HONOR_DAYS) * DAY_MS).toISOString();
  return { expiresAt, guaranteedUntil, limitDays: HOLD_LIMIT_DAYS, daysLeft: expired ? 0 : Math.ceil((end - now) / DAY_MS), expired };
}

export function assertHoldOpen(expiresAt: string, now = Date.now()) {
  if (holdClock(expiresAt, now).expired) throw new RuleError(`This hold has expired. PayPal holds last ${HOLD_LIMIT_DAYS} days, so nothing can be captured from it.`);
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

/** Reads one line's amount field. Zero is fine: it drops the line from the charge. */
export function parseLineAmount(value: string): { cents: number; error?: undefined } | { cents?: undefined; error: string } {
  try {
    return { cents: dollarsToCents(value) };
  } catch {
    return { error: "Enter an amount like 150.00." };
  }
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
