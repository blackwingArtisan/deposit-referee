/**
 * Demo data: `npm run seed`, POST /api/dev/seed, or the "Load demo data" button.
 *
 * Mock mode only: a realistic history (captures, partial refunds, open holds, invoices, a
 * payout batch, an open dispute), then seedAppData() for app-specific records. Sandbox data
 * comes from sandbox-seed.ts (npm run seed:sandbox).
 */
import { withContext } from "../events/bus";
import { getMockPayPal, getPayPal } from "../paypal";
import { seedAppData } from "./app-data";

export const BUYERS = [
  { email: "maya.chen@example.com", givenName: "Maya", surname: "Chen" },
  { email: "leo.park@example.com", givenName: "Leo", surname: "Park" },
  { email: "ines.costa@example.com", givenName: "Ines", surname: "Costa" },
  { email: "sam.okafor@example.com", givenName: "Sam", surname: "Okafor" },
];

const usd = (value: string) => ({ currency_code: "USD", value });

export async function seedDemoData(): Promise<{ mode: string; created: Record<string, number> }> {
  return withContext({ channel: "seed", actor: "seed" }, async () => {
    const pp = getPayPal();
    const mock = getMockPayPal();
    const created: Record<string, number> = { orders: 0, captures: 0, authorizations: 0, refunds: 0, invoices: 0, payouts: 0, disputes: 0 };

    const run = async () => {
      if (mock) {
        const captureOrder = async (value: string, description: string, buyer = BUYERS[0]) => {
          const o = await pp.orders.create({ intent: "CAPTURE", purchase_units: [{ amount: usd(value), description }] });
          await mock.simulateBuyerApproval(o.id, buyer);
          const done = await pp.orders.capture(o.id);
          created.orders++;
          created.captures++;
          return done.purchase_units![0].payments!.captures![0];
        };
        const c1 = await captureOrder("129.00", "Ceramic pour-over set", BUYERS[0]);
        await captureOrder("48.50", "Single-origin beans x2", BUYERS[1]);
        const c3 = await captureOrder("86.00", "Linen apron", BUYERS[2]);
        const c4 = await captureOrder("240.00", "Espresso grinder", BUYERS[3]);
        await pp.payments.refundCapture(c3.id, { amount: usd("20.00"), note_to_payer: "Partial refund: late delivery" });
        await pp.payments.refundCapture(c1.id, { note_to_payer: "Returned unused" });
        created.refunds += 2;

        const authorize = async (value: string, description: string, buyer = BUYERS[1]) => {
          const o = await pp.orders.create({ intent: "AUTHORIZE", purchase_units: [{ amount: usd(value), description }] });
          await mock.simulateBuyerApproval(o.id, buyer);
          const a = await pp.orders.authorize(o.id);
          created.orders++;
          created.authorizations++;
          return a.purchase_units![0].payments!.authorizations![0];
        };
        await authorize("310.00", "Pre-order: custom table (deposit hold)", BUYERS[2]);
        const a2 = await authorize("150.00", "3-item bundle", BUYERS[0]);
        await pp.payments.captureAuthorization(a2.id, { amount: usd("100.00"), final_capture: false });
        await pp.payments.voidAuthorization(a2.id);
        created.captures++;

        await pp.orders.create({ intent: "CAPTURE", purchase_units: [{ amount: usd("64.00"), description: "Gift card (awaiting buyer)" }] });
        created.orders++;

        const inv = (email: string, name: string, items: [string, string, string][]) =>
          pp.invoicing.create({
            detail: { currency_code: "USD", note: "Thank you for your business!", payment_term: { term_type: "NET_15" } },
            primary_recipients: [{ billing_info: { email_address: email, name: { given_name: name } } }],
            items: items.map(([n, q, v]) => ({ name: n, quantity: q, unit_amount: usd(v) })),
          });
        const i1 = await inv(BUYERS[3].email, "Sam", [["Workshop seat", "2", "75.00"]]);
        await pp.invoicing.send(i1.id);
        const i2 = await inv(BUYERS[1].email, "Leo", [["Wholesale beans (5kg)", "1", "180.00"], ["Shipping", "1", "15.00"]]);
        await pp.invoicing.send(i2.id);
        await mock.simulateInvoicePayment(i2.id);
        await inv(BUYERS[2].email, "Ines", [["Consulting (hours)", "3", "60.00"]]);
        created.invoices += 3;

        const batch = await pp.payouts.create({
          sender_batch_header: { email_subject: "Your affiliate commission", sender_batch_id: `seed-${Date.now()}` },
          items: [
            { recipient_type: "EMAIL", receiver: "affiliate.one@example.com", amount: { currency: "USD", value: "24.00" }, note: "October commission" },
            { recipient_type: "EMAIL", receiver: "affiliate.two@example.com", amount: { currency: "USD", value: "12.50" }, note: "October commission" },
          ],
        });
        await mock.advancePayouts();
        await pp.payouts.get(batch.batch_header.payout_batch_id);
        created.payouts++;

        await mock.simulateDispute({ captureId: c4.id, reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED", buyerMessage: "Grinder never arrived." });
        created.disputes++;
      } else {
        throw new Error("Mock mode only. Sandbox data comes from npm run seed:sandbox.");
      }
      await seedAppData();
    };

    if (mock) await mock.withLatency([0, 0], run);
    else await run();
    return { mode: pp.mode, created };
  });
}
