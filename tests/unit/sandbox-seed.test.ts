import { describe, expect, it, vi } from "vitest";
import { runSandboxSeed, seedSandbox, type SeedManifest } from "@/lib/demo/sandbox-seed";
import { PayPalApiError, type PayPalApi } from "@/lib/paypal";

/** Just enough of the sandbox to run the seed: objects live in a Map, every write is counted. */
function fakeSandbox() {
  const objects = new Map<string, Record<string, unknown>>();
  let next = 0;
  const add = (prefix: string, fields: Record<string, unknown>) => {
    const id = `${prefix}-${++next}`;
    objects.set(id, { id, ...fields });
    return objects.get(id)!;
  };
  const find = async (id: string) => {
    if (!objects.has(id)) throw new PayPalApiError({ status: 404, name: "RESOURCE_NOT_FOUND", message: "gone" });
    return objects.get(id);
  };
  const write = <A extends unknown[], R>(fn: (...args: A) => R) => vi.fn(fn);
  const pp = {
    mode: "sandbox",
    orders: {
      get: find,
      create: write((body: { intent: string; payment_source?: unknown }) => {
        const paid = body.payment_source ? { status: "COMPLETED" } : { status: "CREATED", purchase_units: [{}] };
        const payments = !body.payment_source ? undefined : body.intent === "CAPTURE" ? { captures: [add("cap", {})] } : { authorizations: [add("auth", { status: "CREATED" })] };
        return add("order", { ...paid, ...(payments ? { purchase_units: [{ payments }] } : {}) });
      }),
    },
    payments: {
      getRefund: find,
      getCapture: find,
      getAuthorization: find,
      refundCapture: write(() => add("refund", {})),
      captureAuthorization: write((id: string) => {
        objects.get(id)!.status = "PARTIALLY_CAPTURED";
        return add("cap", {});
      }),
      voidAuthorization: write((id: string) => {
        objects.get(id)!.status = "VOIDED";
        return objects.get(id);
      }),
    },
    invoicing: {
      get: find,
      create: write(() => add("inv", { status: "DRAFT" })),
      send: write((id: string) => {
        objects.get(id)!.status = "SENT";
      }),
      recordPayment: write((id: string) => {
        objects.get(id)!.status = "PAID";
        return { payment_id: "p" };
      }),
    },
    payouts: {
      get: find,
      create: write(() => {
        const made = add("batch", {});
        return { ...made, batch_header: { payout_batch_id: made.id } };
      }),
    },
  };
  const writes = () =>
    [pp.orders.create, pp.payments.refundCapture, pp.payments.captureAuthorization, pp.payments.voidAuthorization, pp.invoicing.create, pp.invoicing.send, pp.invoicing.recordPayment, pp.payouts.create].reduce(
      (n, f) => n + f.mock.calls.length,
      0,
    );
  return { pp: pp as unknown as PayPalApi, objects, writes };
}

describe("sandbox seed", () => {
  it("refuses to run outside the sandbox", async () => {
    await expect(seedSandbox("/nonexistent/sandbox-seed.json")).rejects.toThrow(/only runs against the PayPal sandbox/);
  });

  it("creates everything once; a second run writes nothing", async () => {
    const { pp, writes } = fakeSandbox();
    const manifest: SeedManifest = {};
    const first = await runSandboxSeed(pp, manifest);
    expect(first.created).toBeGreaterThan(10);
    const snapshot = { ...manifest };
    const writesAfterFirst = writes();

    const second = await runSandboxSeed(pp, manifest);
    expect(second.created).toBe(0);
    expect(writes()).toBe(writesAfterFirst);
    expect(manifest).toEqual(snapshot);
  });

  it("replaces only an object that no longer exists", async () => {
    const { pp, objects } = fakeSandbox();
    const manifest: SeedManifest = {};
    await runSandboxSeed(pp, manifest);
    const gone = manifest["order:gift-card"];
    objects.delete(gone);

    const rerun = await runSandboxSeed(pp, manifest);
    expect(rerun.created).toBe(1);
    expect(manifest["order:gift-card"]).not.toBe(gone);
  });

  it("finishes a run that stopped halfway", async () => {
    const { pp } = fakeSandbox();
    const manifest: SeedManifest = {};
    vi.mocked(pp.invoicing.recordPayment).mockRejectedValueOnce(new Error("network"));
    await expect(runSandboxSeed(pp, manifest)).rejects.toThrow("network");

    const rerun = await runSandboxSeed(pp, manifest);
    expect(manifest["payout:october"]).toBeTruthy();
    expect(rerun.created).toBeGreaterThan(0);
    expect(pp.orders.create).toHaveBeenCalledTimes(9);
  });
});
