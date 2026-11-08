"use client";

/**
 * Buyer approval button.
 *   - PAYPAL_MODE=sandbox: the real PayPal JS SDK v6 button (@paypal/react-paypal-js/sdk-v6),
 *     environment hard-coded to "sandbox".
 *     Sandbox demo recordings (DEMO_TEST_CARD=1) also get a test-card button, because the
 *     real button needs a buyer login.
 *   - PAYPAL_MODE=mock: a clearly labelled "Simulate PayPal approval" button + dialog that
 *     follows the same server flow (create order -> buyer approves -> onApprove).
 *
 *   <CheckoutButton
 *     createOrder={async () => ({ orderId: (await kitFetch("/api/paypal/orders", { json: {...} })).id })}
 *     onApprove={async ({ orderId }) => { await kitFetch(`/api/paypal/orders/${orderId}/capture`, { method: "POST" }) }}
 *   />
 */
import { useRef, useState } from "react";
import { PayPalGuestPaymentButton, PayPalOneTimePaymentButton, PayPalProvider } from "@paypal/react-paypal-js/sdk-v6";
import { CreditCard, FlaskConical, ShieldCheck, Wallet } from "lucide-react";
import { Button } from "../ui/button";
import { Modal } from "../ui/modal";
import { Skeleton } from "../ui/skeleton";
import { useKit } from "../kit/kit-provider";

export interface CheckoutButtonProps {
  createOrder: () => Promise<{ orderId: string }>;
  onApprove: (data: { orderId: string; payerId?: string }) => Promise<void>;
  onCancel?: () => void;
  onError?: (error: Error) => void;
  /** Shown in the simulated checkout dialog, e.g. "$120.00". */
  amountLabel?: string;
  disabled?: boolean;
  label?: string;
}

const SANDBOX = "sandbox" as const; // never read from env: v6 picks the environment from this prop only

export function CheckoutButton(props: CheckoutButtonProps) {
  const { status } = useKit();
  if (!status) return <Skeleton className="h-11 w-full max-w-sm rounded-lg" />;
  if (status.paypal.mode === "mock") return <MockCheckoutButton {...props} buyerEmail={status.paypal.buyerEmail} />;
  if (!status.paypal.clientId) return <p className="text-sm text-red-600">PAYPAL_CLIENT_ID is missing.</p>;
  return (
    <div className="w-full max-w-sm" data-testid="paypal-v6-button">
      {/* PayPal draws its buttons a moment after the page; the space is kept so nothing jumps. */}
      <div className="min-h-[104px]">
        <PayPalProvider clientId={status.paypal.clientId} environment={SANDBOX} components={["paypal-payments", "paypal-guest-payments"]} pageType="checkout">
          <PayPalOneTimePaymentButton
            presentationMode="auto"
            disabled={props.disabled}
            createOrder={props.createOrder}
            onApprove={async (data) => {
              await props.onApprove({ orderId: data.orderId, payerId: data.payerId });
            }}
            onCancel={() => props.onCancel?.()}
            onError={(e) => props.onError?.(new Error(e?.message ?? "PayPal checkout error"))}
          />
          {/* Card checkout in PayPal's own form, for a renter with no PayPal login. */}
          <div className="mt-2" data-testid="paypal-guest-button">
            <PayPalGuestPaymentButton
              disabled={props.disabled}
              createOrder={props.createOrder}
              onApprove={async (data) => {
                await props.onApprove({ orderId: data.orderId, payerId: data.payerId });
              }}
              onCancel={() => props.onCancel?.()}
              onError={(e) => props.onError?.(new Error(e?.message ?? "PayPal checkout error"))}
            />
          </div>
        </PayPalProvider>
      </div>
      <p className="mt-2 flex items-start gap-1.5 text-xs text-zinc-500" data-testid="paypal-card-hint">
        <ShieldCheck className="mt-px size-3.5 shrink-0" />
        <span>
          No PayPal login? Choose <span className="font-medium text-zinc-700">Debit or Credit Card</span> and enter PayPal&rsquo;s sandbox card <span className="font-mono text-zinc-700">4111 1111 1111 1111</span>, any future date and any 3 digits.
        </span>
      </p>
      {status.paypal.testCard ? <TestCardButton {...props} /> : null}
    </div>
  );
}

function TestCardButton({ createOrder, onApprove, onError, disabled }: CheckoutButtonProps) {
  const { kitFetch } = useKit();
  const [busy, setBusy] = useState(false);

  async function pay() {
    setBusy(true);
    try {
      const { orderId } = await createOrder();
      await kitFetch(`/api/dev/sandbox/approve-order/${orderId}`, { method: "POST" });
      await onApprove({ orderId });
    } catch (e) {
      onError?.(e as Error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button variant="secondary" className="mt-3 w-full" icon={<CreditCard className="size-4" />} loading={busy} disabled={disabled} onClick={pay} data-testid="sandbox-test-card">
      Skip the form: pay with the sandbox card in one tap
    </Button>
  );
}

function MockCheckoutButton({ createOrder, onApprove, onCancel, onError, amountLabel, disabled, label, buyerEmail }: CheckoutButtonProps & { buyerEmail: string }) {
  const { kitFetch } = useKit();
  const [orderId, setOrderId] = useState<string | null>(null);
  const [busy, setBusy] = useState<"create" | "approve" | null>(null);

  async function start() {
    setBusy("create");
    try {
      const { orderId } = await createOrder();
      open.current = true;
      setOrderId(orderId);
    } catch (e) {
      onError?.(e as Error);
    } finally {
      setBusy(null);
    }
  }

  // The dialog reports its own close as well as the Cancel button, so the renter hears it once.
  const open = useRef(false);
  function cancel() {
    if (!open.current) return;
    open.current = false;
    setOrderId(null);
    onCancel?.();
  }

  async function approve() {
    if (!orderId) return;
    setBusy("approve");
    try {
      await kitFetch(`/api/dev/mock/approve-order/${orderId}`, { json: { email: buyerEmail } });
      open.current = false;
      setOrderId(null);
      await onApprove({ orderId });
    } catch (e) {
      onError?.(e as Error);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="w-full max-w-sm">
      <button
        type="button"
        onClick={start}
        disabled={disabled || !!busy}
        data-testid="simulate-paypal-approval"
        className="group flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#ffc439] font-semibold text-[#111] shadow-sm transition hover:brightness-95 active:scale-[0.99] disabled:opacity-50"
      >
        <Wallet className="size-4" />
        {busy === "create" ? "Creating order…" : (label ?? "Simulate PayPal approval")}
        <span className="rounded bg-black/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide">Mock</span>
      </button>
      <p className="mt-2 flex items-center gap-1.5 text-xs text-zinc-500">
        <FlaskConical className="size-3.5" /> Mock mode: no real PayPal window. Same server flow as sandbox.
      </p>
      <Modal
        open={!!orderId}
        onClose={cancel}
        title="Simulated PayPal checkout"
        description="In sandbox or live mode this is PayPal's own approval window."
        footer={
          <>
            <Button variant="secondary" onClick={cancel}>
              Cancel
            </Button>
            <Button onClick={approve} loading={busy === "approve"} data-testid="mock-approve">
              Approve payment
            </Button>
          </>
        }
      >
        <div className="space-y-3 rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-sm">
          <div className="flex justify-between">
            <span className="text-zinc-500">Buyer</span>
            <span className="font-medium">{buyerEmail}</span>
          </div>
          {amountLabel ? (
            <div className="flex justify-between">
              <span className="text-zinc-500">Amount</span>
              <span className="font-semibold tabular-nums">{amountLabel}</span>
            </div>
          ) : null}
          <div className="flex justify-between">
            <span className="text-zinc-500">Order</span>
            <span className="font-mono text-xs">{orderId}</span>
          </div>
        </div>
      </Modal>
    </div>
  );
}
