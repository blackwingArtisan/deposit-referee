/**
 * Shared demo data on the real PayPal sandbox: `npm run seed:sandbox`.
 *
 * Sales are paid with PayPal's test card, so they complete with no buyer login. Every object
 * has a stable key in sandbox-seed.json. A run reads the objects listed there (which fills this
 * app's local ledger) and only creates what is missing, so running it again adds nothing. The
 * file is committed and inherited by new apps, so all apps share one set of sandbox objects.
 * Disputes aren't here: only a buyer can open one.
 */
import fs from "node:fs";
import path from "node:path";
import { withContext } from "../events/bus";
import { getEnv } from "../env";
import { getPayPal, isPayPalError, type PayPalApi } from "../paypal";
import { SANDBOX_TEST_CARD } from "../paypal/test-card";
import type { Order } from "../paypal/types";
import { seedAppData } from "./app-data";
import { BUYERS } from "./seed";

export const MERCHANTS = [
  { id: "m_riverbend", name: "Riverbend Coffee", email: "payouts@riverbend-coffee.example.com" },
  { id: "m_northfold", name: "Northfold Studio", email: "payouts@northfold-studio.example.com" },
  { id: "m_lumen", name: "Lumen & Clay", email: "payouts@lumen-clay.example.com" },
];

const [MAYA, LEO, INES, SAM] = BUYERS;
const [RIVERBEND, NORTHFOLD, LUMEN] = MERCHANTS;

/** Bump to create a fresh set of PayPal request ids (only needed if the data itself changes). */
const SEED_VERSION = "v1";

export type SeedManifest = Record<string, string>;

const usd = (value: string) => ({ currency_code: "USD", value });
const fullName = (b: (typeof BUYERS)[number]) => `${b.givenName} ${b.surname}`;

export async function runSandboxSeed(pp: PayPalApi, manifest: SeedManifest, save: () => void = () => {}) {
  let created = 0;
  let reused = 0;
  const requestId = (key: string) => `seed-${SEED_VERSION}-${key}`;
  const note = (key: string, id: string | undefined) => {
    if (id && manifest[key] !== id) {
      manifest[key] = id;
      save();
    }
  };

  /** Reads the object if it still exists; otherwise creates it and records its id right away. */
  async function ensure<R>(key: string, read: (id: string) => Promise<R>, create: () => Promise<R>, idOf: (r: R) => string): Promise<R> {
    const known = manifest[key];
    if (known) {
      try {
        const found = await read(known);
        reused++;
        return found;
      } catch (e) {
        // Gone, or it belongs to other sandbox credentials: make our own.
        if (!isPayPalError(e) || (e.status !== 404 && e.status !== 403)) throw e;
      }
    }
    const made = await create();
    created++;
    note(key, idOf(made));
    return made;
  }

  const order = (key: string, create: () => Promise<Order>) => ensure(`order:${key}`, (id) => pp.orders.get(id), create, (o) => o.id);

  /** A completed card sale: CAPTURE takes the money now, AUTHORIZE leaves it on hold. */
  const sale = async (key: string, intent: "CAPTURE" | "AUTHORIZE", value: string, item: string, buyer: (typeof BUYERS)[number], merchant: (typeof MERCHANTS)[number]) => {
    const o = await order(key, () =>
      pp.orders.create(
        {
          intent,
          purchase_units: [{ amount: usd(value), description: `${item} (${merchant.name})`, custom_id: merchant.id }],
          payment_source: { card: { ...SANDBOX_TEST_CARD, name: fullName(buyer) } },
        },
        { requestId: requestId(`order-${key}`) },
      ),
    );
    const payments = o.purchase_units?.[0]?.payments;
    note(`capture:${key}`, payments?.captures?.[0]?.id);
    note(`authorization:${key}`, payments?.authorizations?.[0]?.id);
    return o;
  };

  const refund = (key: string, value: string | undefined, why: string) =>
    ensure(
      `refund:${key}`,
      (id) => pp.payments.getRefund(id),
      () => pp.payments.refundCapture(manifest[`capture:${key}`], { ...(value ? { amount: usd(value) } : {}), note_to_payer: why }, { requestId: requestId(`refund-${key}`) }),
      (r) => r.id,
    );

  const invoice = (key: string, buyer: (typeof BUYERS)[number], items: [name: string, quantity: string, price: string][]) =>
    ensure(
      `invoice:${key}`,
      (id) => pp.invoicing.get(id),
      () =>
        pp.invoicing.create({
          detail: { currency_code: "USD", note: "Thank you for your business!" },
          primary_recipients: [{ billing_info: { email_address: buyer.email, name: { given_name: buyer.givenName, surname: buyer.surname } } }],
          items: items.map(([name, quantity, price]) => ({ name, quantity, unit_amount: usd(price) })),
        }),
      (i) => i.id,
    );

  // Sales across all buyers and merchants, two of them refunded.
  await sale("pour-over", "CAPTURE", "129.00", "Ceramic pour-over set", MAYA, RIVERBEND);
  await sale("beans", "CAPTURE", "48.50", "Single-origin beans x2", LEO, RIVERBEND);
  await sale("apron", "CAPTURE", "86.00", "Linen apron", INES, NORTHFOLD);
  await sale("grinder", "CAPTURE", "240.00", "Espresso grinder", SAM, RIVERBEND);
  await sale("vase", "CAPTURE", "72.00", "Stoneware vase", MAYA, LUMEN);
  await sale("print", "CAPTURE", "34.00", "Letterpress print", LEO, NORTHFOLD);
  await refund("pour-over", undefined, "Returned unused");
  await refund("apron", "20.00", "Partial refund: late delivery");

  // One open hold, and one hold captured in part with the rest released.
  await sale("table-hold", "AUTHORIZE", "310.00", "Custom table deposit", INES, NORTHFOLD);
  await sale("bundle", "AUTHORIZE", "150.00", "3-item bundle", SAM, LUMEN);
  const bundleAuth = manifest["authorization:bundle"];
  await ensure(
    "capture:bundle",
    (id) => pp.payments.getCapture(id),
    () => pp.payments.captureAuthorization(bundleAuth, { amount: usd("100.00"), final_capture: false }, { requestId: requestId("capture-bundle") }),
    (c) => c.id,
  );
  const auth = await pp.payments.getAuthorization(bundleAuth);
  if (auth.status === "PARTIALLY_CAPTURED") await pp.payments.voidAuthorization(bundleAuth, { requestId: requestId("void-bundle") });

  // An order still waiting for its buyer. PayPal expires these, and the next run replaces it.
  await order("gift-card", () =>
    pp.orders.create({ intent: "CAPTURE", purchase_units: [{ amount: usd("64.00"), description: `Gift card (${LUMEN.name})`, custom_id: LUMEN.id }] }, { requestId: requestId("order-gift-card") }),
  );

  // Invoices: one due, one paid, one draft.
  const due = await invoice("workshop", SAM, [["Workshop seat", "2", "75.00"]]);
  if (due.status === "DRAFT") await pp.invoicing.send(due.id);
  let paid = await invoice("wholesale", LEO, [["Wholesale beans (5kg)", "1", "180.00"], ["Shipping", "1", "15.00"]]);
  if (paid.status === "DRAFT") {
    await pp.invoicing.send(paid.id);
    paid = await pp.invoicing.get(paid.id);
  }
  if (paid.status === "SENT" || paid.status === "UNPAID") {
    await pp.invoicing.recordPayment(paid.id, { method: "BANK_TRANSFER", amount: usd("195.00"), note: "Paid by bank transfer" });
  }
  await invoice("consulting", INES, [["Consulting (hours)", "3", "60.00"]]);

  // Payouts to the merchants. sender_batch_id blocks a duplicate batch for 30 days.
  await ensure(
    "payout:october",
    (id) => pp.payouts.get(id),
    () =>
      pp.payouts.create({
        sender_batch_header: { sender_batch_id: requestId("payout-october"), email_subject: "Your October settlement" },
        items: [
          { recipient_type: "EMAIL", receiver: RIVERBEND.email, amount: { currency: "USD", value: "312.40" }, note: "October settlement" },
          { recipient_type: "EMAIL", receiver: NORTHFOLD.email, amount: { currency: "USD", value: "184.75" }, note: "October settlement" },
          { recipient_type: "EMAIL", receiver: LUMEN.email, amount: { currency: "USD", value: "96.20" }, note: "October settlement" },
        ],
      }),
    (b) => b.batch_header.payout_batch_id,
  );

  return { created, reused };
}

/** Runs the seed against the real sandbox. Refuses anything else. */
export async function seedSandbox(file = path.resolve(/*turbopackIgnore: true*/ process.cwd(), "src/lib/demo/sandbox-seed.json")) {
  const pp = getPayPal();
  if (getEnv().paypalMode !== "sandbox" || pp.mode !== "sandbox") {
    throw new Error("seed:sandbox only runs against the PayPal sandbox. Set PAYPAL_MODE=sandbox with sandbox credentials.");
  }
  console.log("Seeding the PayPal sandbox…");
  const manifest: SeedManifest = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
  const save = () => fs.writeFileSync(file, JSON.stringify(manifest, null, 2) + "\n");
  return withContext({ channel: "seed", actor: "seed" }, async () => {
    const counts = await runSandboxSeed(pp, manifest, save);
    await seedAppData();
    return { ...counts, ids: manifest };
  });
}
