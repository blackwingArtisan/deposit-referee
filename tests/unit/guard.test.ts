import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { Guard } from "@/lib/agent/guard";
import { ApprovalService } from "@/lib/agent/approvals";
import { AuditLog } from "@/lib/agent/audit";
import { IdempotencyStore } from "@/lib/agent/idempotency";
import { DailyMoneyCounter, matchesPattern, type GuardPolicy } from "@/lib/agent/policy";
import { defineTool } from "@/lib/agent/tool";
import { captureAuthorization, voidAuthorization } from "@/lib/agent/tools/extensions";
import { toolkitTools } from "@/lib/agent/tools/toolkit";
import { MockPayPal } from "@/lib/paypal/mock";
import { money } from "@/lib/money";

const policy: Partial<GuardPolicy> = {
  currency: "USD",
  maxPerAction: "500.00",
  maxPerDay: "600.00",
  approvalThreshold: "50.00",
  allowedCounterparties: ["*@example.com"],
  requireApprovalFor: ["always_ask"],
  blockedTools: ["forbidden"],
  approvalTimeoutMs: 200,
};

let paypal: MockPayPal;
let approvals: ApprovalService;
let audit: AuditLog;
let guard: Guard;
const ctx = (runId = "run-1") => ({ runId, actor: "agent:test", channel: "test" });

function makeGuard(overrides: Partial<GuardPolicy> = {}) {
  return new Guard({ paypal, policy: { ...policy, ...overrides }, approvals, audit, idempotency: new IdempotencyStore(null), daily: new DailyMoneyCounter(null) });
}

beforeEach(() => {
  paypal = new MockPayPal();
  approvals = new ApprovalService();
  audit = new AuditLog(null);
  guard = makeGuard();
});

/** A fake "send money" tool that records how often it really executed. */
function payTool(name = "pay_someone") {
  const execute = vi.fn(async (i: { to: string; amount: string }, c: { requestId: string }) => ({ id: `tx-${execute.mock.calls.length}`, to: i.to, amount: i.amount, requestId: c.requestId }));
  const tool = defineTool({
    name,
    description: "Pay someone",
    risk: "money",
    schema: z.object({ to: z.string(), amount: z.string(), idempotency_key: z.string().optional() }),
    impact: async (i) => ({ amount: money(i.amount), counterparties: [i.to], summary: `Pay ${i.amount} to ${i.to}` }),
    execute: execute as never,
  });
  return { tool, execute };
}

const approveNext = () => {
  const off = approvals.onChange((a) => {
    if (a.state === "pending") {
      off();
      setTimeout(() => approvals.decide(a.id, "approved", "tester"), 5);
    }
  });
};
const denyNext = () => {
  const off = approvals.onChange((a) => {
    if (a.state === "pending") {
      off();
      setTimeout(() => approvals.decide(a.id, "denied", "tester", "not today"), 5);
    }
  });
};

describe("caps and allowlist", () => {
  it("executes money tools under the approval threshold without asking", async () => {
    const { tool, execute } = payTool();
    const out = await guard.run(tool, { to: "ada@example.com", amount: "20.00" }, ctx());
    expect(out.status).toBe("executed");
    expect(execute).toHaveBeenCalledTimes(1);
    expect(approvals.list()).toHaveLength(0);
    expect(audit.list().map((e) => e.action)).toEqual(["tool.requested", "tool.executed"]);
  });

  it("denies anything over the per-action cap and never executes it", async () => {
    const { tool, execute } = payTool();
    const out = await guard.run(tool, { to: "ada@example.com", amount: "500.01" }, ctx());
    expect(out).toMatchObject({ status: "denied", code: "OVER_ACTION_CAP" });
    expect(execute).not.toHaveBeenCalled();
  });

  it("denies payees that are not on the allowlist", async () => {
    const { tool, execute } = payTool();
    const out = await guard.run(tool, { to: "mallory@evil.test", amount: "5.00" }, ctx());
    expect(out).toMatchObject({ status: "denied", code: "COUNTERPARTY_NOT_ALLOWED" });
    expect(execute).not.toHaveBeenCalled();
  });

  it("enforces the daily cap across calls and runs", async () => {
    const { tool } = payTool();
    approveNext();
    expect((await guard.run(tool, { to: "a@example.com", amount: "400.00" }, ctx("r1"))).status).toBe("executed");
    const out = await guard.run(tool, { to: "b@example.com", amount: "250.00" }, ctx("r2"));
    expect(out).toMatchObject({ status: "denied", code: "OVER_DAILY_CAP" });
    expect((out as { reason: string }).reason).toMatch(/^The app moves at most \$[\d,.]+ a day, and \$400\.00 has already moved today, so this \$250\.00 was stopped\. No money moved\.$/);
  });

  it("blocks blocked tools", async () => {
    const { tool, execute } = payTool("forbidden");
    expect(await guard.run(tool, { to: "a@example.com", amount: "1.00" }, ctx())).toMatchObject({ status: "denied", code: "BLOCKED_TOOL" });
    expect(execute).not.toHaveBeenCalled();
  });

  it("matches allowlist patterns case-insensitively with wildcards", () => {
    expect(matchesPattern("Ada@Example.com", "*@example.com")).toBe(true);
    expect(matchesPattern("ada@example.com.evil.test", "*@example.com")).toBe(false);
  });
});

describe("human approval", () => {
  it("waits for approval above the threshold, then executes", async () => {
    const { tool, execute } = payTool();
    const requested = vi.fn();
    approveNext();
    const out = await guard.run(tool, { to: "ada@example.com", amount: "75.00" }, { ...ctx(), onApprovalRequested: requested });
    expect(requested).toHaveBeenCalledOnce();
    expect(out.status).toBe("executed");
    expect(out.approval?.state).toBe("approved");
    expect(execute).toHaveBeenCalledTimes(1);
    expect(audit.list().map((e) => e.action)).toEqual(["tool.requested", "approval.requested", "approval.approved", "tool.executed"]);
  });

  it("does not execute when a human denies", async () => {
    const { tool, execute } = payTool();
    denyNext();
    const out = await guard.run(tool, { to: "ada@example.com", amount: "75.00" }, ctx());
    expect(out).toMatchObject({ status: "denied", code: "APPROVAL_DENIED" });
    expect(execute).not.toHaveBeenCalled();
  });

  it("expires unanswered approvals and does not execute", async () => {
    const { tool, execute } = payTool();
    const out = await guard.run(tool, { to: "ada@example.com", amount: "75.00" }, ctx());
    expect(out).toMatchObject({ status: "denied", code: "APPROVAL_EXPIRED" });
    expect(execute).not.toHaveBeenCalled();
  });

  it("always asks for tools listed in requireApprovalFor, even for tiny amounts", async () => {
    const { tool } = payTool("always_ask");
    approveNext();
    const out = await guard.run(tool, { to: "ada@example.com", amount: "1.00" }, ctx());
    expect(out.status).toBe("executed");
    expect(out.approval?.reason).toMatch(/always requires/);
  });

  it("refuses to decide an approval twice", async () => {
    const { tool } = payTool();
    let id = "";
    approvals.onChange((a) => {
      if (a.state === "pending") id = a.id;
    });
    approveNext();
    await guard.run(tool, { to: "ada@example.com", amount: "75.00" }, ctx());
    expect(() => approvals.decide(id, "denied")).toThrow(/already approved/);
  });
});

describe("idempotency", () => {
  it("replays an identical call in the same run instead of paying twice", async () => {
    const { tool, execute } = payTool();
    const a = await guard.run(tool, { to: "ada@example.com", amount: "10.00" }, ctx());
    const b = await guard.run(tool, { to: "ada@example.com", amount: "10.00" }, ctx());
    expect(execute).toHaveBeenCalledTimes(1);
    expect(b).toMatchObject({ status: "executed", replayed: true });
    expect(b.status === "executed" && a.status === "executed" && b.result).toEqual(a.status === "executed" && a.result);
  });

  it("treats a new run as a new intent, unless an explicit idempotency_key is reused", async () => {
    const { tool, execute } = payTool();
    await guard.run(tool, { to: "ada@example.com", amount: "10.00" }, ctx("r1"));
    await guard.run(tool, { to: "ada@example.com", amount: "10.00" }, ctx("r2"));
    expect(execute).toHaveBeenCalledTimes(2);
    await guard.run(tool, { to: "ada@example.com", amount: "10.00", idempotency_key: "order-42" }, ctx("r3"));
    await guard.run(tool, { to: "ada@example.com", amount: "10.00", idempotency_key: "order-42" }, ctx("r4"));
    expect(execute).toHaveBeenCalledTimes(3);
  });

  it("allows a retry after a failure, with a fresh PayPal-Request-Id", async () => {
    let calls = 0;
    const ids: string[] = [];
    const flaky = defineTool({
      name: "flaky_pay",
      description: "x",
      risk: "money",
      schema: z.object({ amount: z.string() }),
      impact: async (i) => ({ amount: money(i.amount), summary: "x" }),
      execute: async (_i, c) => {
        ids.push(c.requestId);
        if (++calls === 1) throw new Error("PayPal 500");
        return { ok: true };
      },
    });
    expect((await guard.run(flaky, { amount: "5.00" }, ctx())).status).toBe("failed");
    expect((await guard.run(flaky, { amount: "5.00" }, ctx())).status).toBe("executed");
    expect(ids[0]).not.toBe(ids[1]);
  });

  it("passes the idempotency key to PayPal so a real double capture is impossible", async () => {
    const order = await paypal.orders.create({ intent: "AUTHORIZE", purchase_units: [{ amount: { currency_code: "USD", value: "100.00" } }] });
    await paypal.simulateBuyerApproval(order.id);
    const auth = (await paypal.orders.authorize(order.id)).purchase_units![0].payments!.authorizations![0];
    const input = captureAuthorization.parse({ authorization_id: auth.id, amount: "30.00" });
    const first = await guard.run(captureAuthorization, input, ctx());
    const again = await guard.run(captureAuthorization, input, ctx());
    expect(first.status).toBe("executed");
    expect(again).toMatchObject({ status: "executed", replayed: true });
    expect(paypal.authorizationRemaining(auth.id)).toEqual(money("70.00"));
  });
});

describe("with real kit tools on the mock", () => {
  async function authorized(value: string) {
    const order = await paypal.orders.create({ intent: "AUTHORIZE", purchase_units: [{ amount: { currency_code: "USD", value } }] });
    await paypal.simulateBuyerApproval(order.id, { email: "buyer@example.com" });
    return (await paypal.orders.authorize(order.id)).purchase_units![0].payments!.authorizations![0];
  }

  it("partial capture above the threshold needs approval; void releases the rest", async () => {
    const auth = await authorized("120.00");
    approveNext();
    const cap = await guard.run(captureAuthorization, captureAuthorization.parse({ authorization_id: auth.id, amount: "60.00" }), ctx());
    expect(cap.status).toBe("executed");
    expect(cap.approval?.state).toBe("approved");
    expect(cap.impact?.summary).toBe("Capture $60.00 of the $120.00 authorization");
    const voided = await guard.run(voidAuthorization, voidAuthorization.parse({ authorization_id: auth.id }), ctx());
    expect(voided).toMatchObject({ status: "executed", result: { status: "VOIDED" } });
    expect(voided.impact?.amount).toEqual(money("60.00"));
  });

  it("uses PayPal Agent Toolkit tool definitions, guarded (pay_order resolves the order total)", async () => {
    const [createOrder, payOrder] = toolkitTools(["create_order", "pay_order"], "mock");
    expect(createOrder.source).toBe("paypal-agent-toolkit");
    expect(createOrder.inputSchema).toHaveProperty("properties.items");
    const created = await guard.run(createOrder, createOrder.parse({ currencyCode: "USD", items: [{ name: "Mug", quantity: 2, itemCost: 12.5, taxPercent: 8, itemTotal: 25 }] }), ctx());
    expect(created.status).toBe("executed");
    const order = (created as { result: { id: string } }).result;
    await paypal.simulateBuyerApproval(order.id, { email: "buyer@example.com" });
    const paid = await guard.run(payOrder, payOrder.parse({ id: order.id }), ctx());
    expect(paid.impact?.amount).toEqual(money("27.00"));
    expect(paid).toMatchObject({ status: "executed", result: { status: "success" } });
  });
});

describe("audit log", () => {
  it("is hash-chained and detects tampering", async () => {
    const { tool } = payTool();
    await guard.run(tool, { to: "ada@example.com", amount: "5.00" }, ctx());
    await guard.run(tool, { to: "x@evil.test", amount: "5.00" }, ctx());
    const entries = audit.list();
    expect(audit.verify().ok).toBe(true);
    const tampered = entries.map((e) => ({ ...e }));
    tampered[1] = { ...tampered[1], amount: money("0.01") };
    expect(audit.verify(tampered)).toMatchObject({ ok: false, brokenAt: tampered[1].seq });
  });

  it("redacts secrets in recorded inputs", () => {
    const e = audit.append({ action: "tool.requested", actor: "t", input: { access_token: "abc", nested: { client_secret: "s" }, amount: "1.00" } });
    expect(e.input).toEqual({ access_token: "[redacted]", nested: { client_secret: "[redacted]" }, amount: "1.00" });
  });
});
