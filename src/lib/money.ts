/**
 * Money helpers. PayPal sends amounts as decimal strings ({ currency_code, value: "12.34" }).
 * Never do arithmetic on floats: convert to integer minor units, add/compare, convert back.
 */

export interface Money {
  currency_code: string;
  value: string;
}

/** Currencies PayPal treats as having no decimal places. */
const ZERO_DECIMAL = new Set(["JPY", "HUF", "TWD"]);

export function decimalsFor(currency: string): number {
  return ZERO_DECIMAL.has(currency.toUpperCase()) ? 0 : 2;
}

/** "12.34" USD -> 1234. Throws on malformed input or too many decimals. */
export function toMinor(value: string | number, currency: string): number {
  const str = typeof value === "number" ? value.toFixed(decimalsFor(currency)) : value.trim();
  if (!/^-?\d+(\.\d+)?$/.test(str)) throw new Error(`Invalid money value: "${value}"`);
  const decimals = decimalsFor(currency);
  const negative = str.startsWith("-");
  const [whole, frac = ""] = str.replace("-", "").split(".");
  if (frac.length > decimals && /[1-9]/.test(frac.slice(decimals))) {
    throw new Error(`Too many decimal places for ${currency}: "${value}"`);
  }
  const padded = (frac + "0".repeat(decimals)).slice(0, decimals);
  const minor = Number(whole) * 10 ** decimals + (decimals ? Number(padded) : 0);
  if (!Number.isSafeInteger(minor)) throw new Error(`Money value out of range: "${value}"`);
  return negative ? -minor : minor;
}

/** 1234 USD -> "12.34" */
export function fromMinor(minor: number, currency: string): string {
  const decimals = decimalsFor(currency);
  const negative = minor < 0;
  const abs = Math.abs(Math.round(minor));
  if (decimals === 0) return `${negative ? "-" : ""}${abs}`;
  const whole = Math.floor(abs / 10 ** decimals);
  const frac = String(abs % 10 ** decimals).padStart(decimals, "0");
  return `${negative ? "-" : ""}${whole}.${frac}`;
}

export function money(value: string | number, currency = "USD"): Money {
  const code = currency.toUpperCase();
  return { currency_code: code, value: fromMinor(toMinor(value, code), code) };
}

export function moneyFromMinor(minor: number, currency = "USD"): Money {
  return { currency_code: currency.toUpperCase(), value: fromMinor(minor, currency) };
}

function assertSameCurrency(a: Money, b: Money) {
  if (a.currency_code !== b.currency_code) {
    throw new Error(`Currency mismatch: ${a.currency_code} vs ${b.currency_code}`);
  }
}

export function addMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return moneyFromMinor(toMinor(a.value, a.currency_code) + toMinor(b.value, b.currency_code), a.currency_code);
}

export function subtractMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return moneyFromMinor(toMinor(a.value, a.currency_code) - toMinor(b.value, b.currency_code), a.currency_code);
}

/** Negative if a < b, 0 if equal, positive if a > b. */
export function compareMoney(a: Money, b: Money): number {
  assertSameCurrency(a, b);
  return toMinor(a.value, a.currency_code) - toMinor(b.value, b.currency_code);
}

export function sumMoney(items: Money[], currency = items[0]?.currency_code ?? "USD"): Money {
  return items.reduce((acc, m) => addMoney(acc, m), moneyFromMinor(0, currency));
}

export function isZero(m: Money): boolean {
  return toMinor(m.value, m.currency_code) === 0;
}

/** Multiply by a ratio and round half-up to the minor unit (e.g. fees, percentages). */
export function scaleMoney(m: Money, ratio: number): Money {
  return moneyFromMinor(Math.round(toMinor(m.value, m.currency_code) * ratio), m.currency_code);
}

export function formatMoney(m: Money | null | undefined, opts: { signDisplay?: "auto" | "always" | "never" } = {}): string {
  if (!m) return "—";
  const num = Number(m.value);
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: m.currency_code,
      signDisplay: opts.signDisplay ?? "auto",
      minimumFractionDigits: decimalsFor(m.currency_code),
      maximumFractionDigits: decimalsFor(m.currency_code),
    }).format(num);
  } catch {
    return `${m.value} ${m.currency_code}`;
  }
}
