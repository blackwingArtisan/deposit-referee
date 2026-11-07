/**
 * Sample bookings, so a host's first look at the app isn't an empty dashboard. Render wipes the
 * disk on every deploy, and `npm run seed:sandbox` runs on every start, so this adds only what's
 * missing. Each hold is a real PayPal hold, and every settled amount is read back from PayPal.
 * Sample bookings carry `sample: true`, and the app says so wherever they show.
 */
import { randomUUID } from "node:crypto";
import { collection } from "@/lib/store/collection";
import { getMockPayPal, isPayPalError, type PayPalApi } from "@/lib/paypal";
import { SANDBOX_TEST_CARD } from "@/lib/paypal/test-card";
import type { Authorization } from "@/lib/paypal/types";
import { DEMO_CLEAN_CHECK_OUT, DEMO_PHOTOS } from "./photos";
import { MOCK_NO_DAMAGE, MOCK_VERDICT, toReview } from "./review";
import { centsToDollars, dollarsToCents, releasedCents, renterDeadline } from "./rules";
import type { Booking, ChargeLine, Proposal, RenterState, Settlement } from "./types";

interface Sample {
  key: string;
  item: string;
  renter: string;
  depositCents: number;
  daysAgo: number;
  stage: "held" | "proposed" | "settled";
  /** What the agent proposed. 0 means a clean check-out and a full release. */
  aiCents?: number;
  /** What the host charged, when it differs from the agent. */
  chargedCents?: number;
  contest?: string;
}

export const SAMPLES: Sample[] = [
  { key: "pine-ridge", item: "Pine Ridge cabin, this weekend", renter: "Priya Nair", depositCents: 25_000, daysAgo: 1, stage: "held" },
  { key: "lakeside", item: "Lakeside cabin, long weekend", renter: "Jordan Reyes", depositCents: 30_000, daysAgo: 3, stage: "proposed", aiCents: 15_000 },
  { key: "harbor", item: "Harbor loft, two nights", renter: "Sam Whitfield", depositCents: 40_000, daysAgo: 12, stage: "settled", aiCents: 15_000, chargedCents: 21_000 },
  { key: "riverside", item: "Riverside studio, three nights", renter: "Noor Haddad", depositCents: 35_000, daysAgo: 19, stage: "settled", aiCents: 15_000, chargedCents: 9_000, contest: "That scratch was already there when I arrived. I sent the host a photo on day one." },
  { key: "hilltop", item: "Hilltop cottage, one week", renter: "Elena Marsh", depositCents: 25_000, daysAgo: 27, stage: "settled", aiCents: 0 },
  { key: "lakeside-oct", item: "Lakeside cabin, fall break", renter: "Marcus Bell", depositCents: 30_000, daysAgo: 34, stage: "settled", aiCents: 15_000 },
];

/** An open hold this close to its end gets replaced, so a sample can always be finished. */
const MIN_HOLD_LEFT_MS = 3 * 24 * 60 * 60 * 1000;

export const sampleBookingId = (key: string) => `bk_sample_${key}`;

const isOpen = (auth: Authorization, now: number) => auth.status === "CREATED" && Date.parse(auth.expiration_time) - now > MIN_HOLD_LEFT_MS;

async function newHold(pp: PayPalApi, sample: Sample, requestId: string) {
  const unit = { amount: { currency_code: "USD", value: centsToDollars(sample.depositCents) }, description: `Deposit for ${sample.item}`, custom_id: sampleBookingId(sample.key) };
  const mock = getMockPayPal();
  if (mock) {
    const order = await pp.orders.create({ intent: "AUTHORIZE", purchase_units: [unit] });
    await mock.simulateBuyerApproval(order.id, { givenName: sample.renter.split(" ")[0], surname: sample.renter.split(" ")[1] });
    return { orderId: order.id, auth: (await pp.orders.authorize(order.id)).purchase_units![0].payments!.authorizations![0] };
  }
  const order = await pp.orders.create({ intent: "AUTHORIZE", purchase_units: [unit], payment_source: { card: { ...SANDBOX_TEST_CARD, name: sample.renter } } }, { requestId });
  return { orderId: order.id, auth: order.purchase_units![0].payments!.authorizations![0] };
}

function proposalFor(sample: Sample, now: number): Proposal {
  const clean = !sample.aiCents;
  const verdict = clean ? MOCK_NO_DAMAGE : MOCK_VERDICT;
  const lines: ChargeLine[] = verdict.findings.map((f, i) => ({ id: `ai-${i}`, description: f.description, box: f.box, amountCents: sample.chargedCents ?? f.charge_cents, aiCents: f.charge_cents, note: "Sample figure." }));
  return { runId: `sample_${sample.key}`, kind: clean ? "release" : "charge", aiCents: sample.aiCents ?? 0, lines, rationale: verdict.reasoning, proposedAt: new Date(now).toISOString(), engine: "Sample proposal", simulated: true };
}

function renterStateFor(sample: Sample, auth: Authorization, now: number): RenterState | undefined {
  if (sample.stage === "held" || !sample.aiCents) return undefined;
  const deadline = renterDeadline(auth.expiration_time, now);
  if (sample.stage === "proposed") return { deadline };
  const at = new Date(now).toISOString();
  return sample.contest
    ? { deadline, response: { decision: "contested", note: sample.contest, amountCents: sample.aiCents, at } }
    : { deadline, response: { decision: "accepted", amountCents: sample.chargedCents ?? sample.aiCents, at } };
}

export async function seedSampleBookings(pp: PayPalApi, manifest: Record<string, string>, save: () => void = () => {}) {
  const store = collection<Booking>("bookings");
  const now = Date.now();
  let added = 0;
  const note = (key: string, id: string) => {
    if (manifest[key] !== id) {
      manifest[key] = id;
      save();
    }
  };

  const readHold = async (id: string | undefined) => {
    if (!id) return undefined;
    try {
      return await pp.payments.getAuthorization(id);
    } catch (e) {
      // Gone, or it belongs to other sandbox credentials: place our own.
      if (isPayPalError(e) && (e.status === 404 || e.status === 403)) return undefined;
      throw e;
    }
  };

  for (const sample of SAMPLES) {
    const id = sampleBookingId(sample.key);
    if (store.get(id)) continue;

    const authKey = `sample:authorization:${sample.key}`;
    const captureKey = `sample:capture:${sample.key}`;
    const chargeCents = sample.stage === "settled" ? (sample.chargedCents ?? sample.aiCents ?? 0) : 0;
    let auth = await readHold(manifest[authKey]);
    // A judge may have settled an open sample before the last redeploy, and holds run out.
    if (!auth || (sample.stage !== "settled" && !isOpen(auth, now))) {
      const placed = await newHold(pp, sample, `seed-sample-${sample.key}-${manifest[authKey] ?? "first"}`);
      auth = placed.auth;
      note(`sample:order:${sample.key}`, placed.orderId);
      note(authKey, auth.id);
      delete manifest[captureKey];
    }

    let settlement: Settlement | undefined;
    if (sample.stage === "settled") {
      const requestId = (step: string) => `seed-sample-${step}-${auth.id}`;
      if (chargeCents && !manifest[captureKey]) {
        const capture = await pp.payments.captureAuthorization(auth.id, { amount: { currency_code: "USD", value: centsToDollars(chargeCents) }, final_capture: false }, { requestId: requestId("capture") });
        note(captureKey, capture.id);
      }
      const before = await pp.payments.getAuthorization(auth.id);
      if (before.status === "CREATED" || before.status === "PARTIALLY_CAPTURED") await pp.payments.voidAuthorization(auth.id, { requestId: requestId("void") });
      const after = await pp.payments.getAuthorization(auth.id);
      const capture = chargeCents ? await pp.payments.getCapture(manifest[captureKey]) : undefined;
      const capturedCents = capture ? dollarsToCents(capture.amount.value) : 0;
      settlement = {
        runId: `sample_${sample.key}`,
        kind: chargeCents ? "charge" : "release",
        requestedCents: chargeCents,
        contestHeard: !!sample.contest,
        captureId: capture?.id,
        captureStatus: capture?.status,
        capturedCents,
        releasedCents: releasedCents(dollarsToCents(after.amount.value), capturedCents),
        authorizationStatus: after.status,
        settledAt: new Date(now - (sample.daysAgo - 1) * 24 * 60 * 60 * 1000).toISOString(),
      };
    }

    const created = now - sample.daysAgo * 24 * 60 * 60 * 1000;
    const clean = sample.aiCents === 0;
    const photos = { check_in: DEMO_PHOTOS.check_in, ...(sample.stage === "held" ? {} : { check_out: clean ? DEMO_CLEAN_CHECK_OUT : DEMO_PHOTOS.check_out }) };
    store.upsert({
      id,
      sample: true,
      item: sample.item,
      renter: sample.renter,
      depositCents: sample.depositCents,
      status: sample.stage,
      createdAt: new Date(created).toISOString(),
      renterToken: randomUUID(),
      orderId: manifest[`sample:order:${sample.key}`],
      authorizationId: auth.id,
      authorizedCents: dollarsToCents(auth.amount.value),
      holdExpiresAt: auth.expiration_time,
      photos,
      review: sample.stage === "held" ? undefined : toReview(clean ? MOCK_NO_DAMAGE : MOCK_VERDICT, sample.depositCents, { mocked: true, costUsd: 0 }),
      proposal: sample.stage === "held" ? undefined : proposalFor(sample, created),
      renterState: renterStateFor(sample, auth, now),
      settlement,
    });
    added++;
  }
  return { added };
}
