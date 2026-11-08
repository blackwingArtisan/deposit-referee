# KIT-GUIDE: building a PayPal AI Hackathon app on this kit

You are building one app for the PayPal AI Hackathon (Devpost, deadline **Nov 12, 2026**). Judges score depth of PayPal use, depth of AI use, product completeness, real-world impact, innovation and the video. The video is a **silent, captioned screen recording under 3 minutes**, so everything the agent does must be visible on screen.

This kit gives you: a typed PayPal layer (mock + sandbox), a guarded Claude agent built on PayPal's Agent Toolkit, a live timeline UI, an AG Grid ledger, a design system, a landing page, seed data, a demo-video recorder and deploy config. Build your app's idea on top; do not rebuild these pieces.

## Golden rules

1. **Never live PayPal.** `PAYPAL_MODE` is `mock` or `sandbox`; anything else refuses to start. The only API host in code is `https://api-m.sandbox.paypal.com` and the JS SDK environment is hard-coded to `"sandbox"`. A unit test fails if a live host appears in `src/`.
2. **Every money-moving agent action goes through the Guard.** Never call `getPayPal()` write methods from an agent tool except inside a tool defined with `defineTool` (or a kit tool), because those run behind caps, allowlists, approvals, idempotency and the audit log.
3. **Mock mode must always demo end to end**: no credentials, no API key. Give every AI call a `mock` fixture and every agent a `mockScript`.
4. **Keep the timeline on screen** in your main flow.
5. **Never print or commit secrets.** Credentials live in `../../.env.shared` (gitignored). Don't log env values.
6. Run `npm run check` (lint + typecheck + tests + build) before calling anything done.

## Quick start

```bash
npm ci
PAYPAL_MODE=mock npm run dev        # no credentials needed; open http://localhost:3000
npm run dev                         # uses ../../.env.shared (sandbox + Claude when keys are set)
npm run seed                        # demo data for the current mode (PAYPAL_MODE=mock npm run seed:reset to start clean)
npm run seed:sandbox                # shared data on the real sandbox; refuses mock; a rerun adds nothing
npm test                            # unit tests (mock PayPal, guard, safety)
npm run test:sandbox                # real sandbox smoke test (skipped without credentials)
npm run test:e2e                    # Playwright: example flow, mock PayPal, mock AI (E2E_AI_MODE=live for Claude)
npm run demo:record                 # records videos/demo-*.webm from demo/demo.spec.ts
npm run demo:mp4                    # newest recording -> MP4 for YouTube (fails at 3:00 or longer)
```

Environment load order (first wins): real env → `.env.local` → `../../.env.shared` → `../.env.shared`. Keys: `PAYPAL_MODE`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID` (may be empty), `PAYPAL_SANDBOX_SELLER_EMAIL`, `PAYPAL_SANDBOX_BUYER_EMAIL`, `ANTHROPIC_API_KEY`, `AI_DAILY_CAP_USD`. Optional: `AI_MODE=mock`, `AI_RATE_LIMIT_PER_MINUTE`, `AI_RATE_LIMIT_PER_DAY`, `API_RATE_LIMIT_PER_MINUTE`, `MOCK_PAYPAL_LATENCY_MS`, `KIT_DATA_DIR`. See `.env.example`.

The shell env wins, so `PAYPAL_MODE=mock npm run dev` works even when the shared file says sandbox.

## Project map

```
src/
  app.config.ts          APP-OWNED  name, brand colour, nav, landing copy, agent policy
  agents/                APP-OWNED  your agents (index.ts registry; settlement.ts is the example)
  app/
    page.tsx             landing page (sections from components/marketing/landing.tsx)
    (app)/dashboard      APP TEMPLATE  logged-in home: KPIs, ledger grid, timeline, AI summary
    (app)/example        KIT EXAMPLE  authorize -> partial capture -> void (delete when done)
    (app)/activity       audit log + webhooks
    api/                 route handlers (all use route() from lib/http.ts)
  components/
    ui/                  Button, Card, Input/Field/MoneyInput, Modal, EmptyState, Skeleton, Badge/StatusPill, Stat
    agent/               ToolCallTimeline, ApprovalPrompt
    paypal/              CheckoutButton (JS SDK v6 / mock)
    data-grid.tsx        AG Grid wrapper + col helpers;  ledger/ledger-grid.tsx
    money-badge.tsx, toast.tsx, caption.tsx, shell/, marketing/, kit/ (KitProvider, useTimeline, useLedger)
  lib/
    paypal/              PayPalApi interface, sandbox.ts, mock/, webhooks, ledger, instrument
    ai/                  config (models, prices), structured, vision, stream, budget (daily cap), rate-limit
    agent/               define, tool, guard, policy, approvals, audit, idempotency, loop, scripted, runs, tools/
    events/              timeline bus (server) + types (shared)
    store/               JSON-file persistence (collection<T>())
    demo/                seed.ts (+ app-data.ts APP-OWNED)
    http.ts, env.ts, money.ts
tests/unit/              vitest (mock PayPal, guard, safety, sandbox smoke)
tests/e2e/               Playwright e2e
demo/                    Playwright demo-video template + caption helpers
scripts/                 new-app.sh, seed.ts, webm-to-mp4.sh, paypal-mcp.mjs
```

## Modules

### PayPal: `@/lib/paypal`

```ts
import { getPayPal, getMockPayPal, isPayPalError, ledger } from "@/lib/paypal";

const pp = getPayPal(); // mock or sandbox per PAYPAL_MODE; every call is on the timeline + in the ledger
const order = await pp.orders.create({
  intent: "AUTHORIZE",
  purchase_units: [{ amount: { currency_code: "USD", value: "120.00" }, description: "Order #1042" }],
});
// ...buyer approves (CheckoutButton)...
const authorized = await pp.orders.authorize(order.id);
const auth = authorized.purchase_units![0].payments!.authorizations![0];
await pp.payments.captureAuthorization(auth.id, { amount: { currency_code: "USD", value: "80.00" }, final_capture: false });
await pp.payments.voidAuthorization(auth.id);

try { await pp.payments.refundCapture(captureId, { amount: { currency_code: "USD", value: "500.00" } }); }
catch (e) { if (isPayPalError(e, "REFUND_AMOUNT_EXCEEDED")) { /* e.debugId, e.status, e.details */ } }
```

Coverage (same methods in mock and sandbox):

| Area | Methods |
|---|---|
| Orders v2 | `orders.create` (CAPTURE/AUTHORIZE, vault_id, save-on-success), `get`, `capture`, `authorize` |
| Payments v2 | `payments.getAuthorization`, `captureAuthorization` (partial + final_capture), `voidAuthorization`, `reauthorize`, `getCapture`, `refundCapture` (full/partial), `getRefund` |
| Payouts | `payouts.create`, `get` |
| Invoicing v2 | `invoicing.generateNextNumber`, `create` (draft), `send`, `remind`, `cancel`, `get`, `list`, `recordPayment` |
| Disputes | `disputes.list`, `get`, `provideEvidence` (multipart), `acceptClaim` |
| Transaction Search | `transactions.search` |
| Webhooks | `webhooks.verify` (sandbox: PayPal postback API with the raw body; mock: local HMAC) |
| Vault v3 | `vault.createSetupToken`, `getSetupToken`, `createPaymentToken`, `getPaymentToken`, `listPaymentTokens`, `deletePaymentToken` |

- **Idempotency**: pass `{ requestId }` as the last argument of writes; it becomes `PayPal-Request-Id`. Omitted = random UUID. The mock replays stored results for a reused id like PayPal does.
- **Negative testing**: `{ mockResponse: { mock_application_codes: "INSTRUMENT_DECLINED" } }` (sandbox Orders/Payments; the mock honours it too).
- **Errors**: `PayPalApiError` has `status`, `paypalName` (e.g. `UNPROCESSABLE_ENTITY`), `issue` (e.g. `ORDER_NOT_APPROVED`), `details`, `debugId`. Route handlers return them as JSON with the debug id.
- **Ledger** (`ledger.list()`, `GET /api/paypal/ledger`): every PayPal object the app touched, filled from responses and webhooks. Use it for grids. PayPal has no list-orders API, and sandbox Transaction Search lags.
- **Mock-only helpers** (`getMockPayPal()`, null in sandbox): `simulateBuyerApproval(orderId, buyer?)`, `simulateInvoicePayment(id)`, `simulateDispute({ captureId, reason })`, `simulateDisputeResolution(id, "SELLER_FAVOR" | "BUYER_FAVOR")`, `approveSetupToken(id)`, `advanceTime(ms)` (honor period, expiry), `advancePayouts()`, `events()`, `reset()`, `snapshot()`. Mock-only routes: `/api/dev/mock/approve-order/:id`, `/api/dev/seed`, `/api/dev/reset`, `/api/dev/time` (`{days}`), `/api/dev/webhooks` and `/api/dev/webhooks/replay` (`{eventId}` | `{eventType}` | `{last}`).
- Mock state persists in `.data/paypal-mock.json` and reloads when another process (seed) writes it. Operations are atomic: a failed call changes nothing and emits no webhook.

### Webhooks

`POST /api/paypal/webhooks` verifies, de-duplicates by event id (PayPal retries for 3 days), records to the ledger and timeline, then runs your handlers. Register handlers in **`src/lib/paypal/handlers.ts`**:

```ts
onWebhook("PAYMENT.CAPTURE.COMPLETED", async (event) => {
  const capture = event.resource;                       // typed Capture
  await markPaid(capture.supplementary_data?.related_ids.order_id);
});
onWebhook("INVOICING.INVOICE.PAID", async (event) => { const inv = invoiceFromEvent(event); });
```

Sandbox: create a webhook in the developer dashboard for `https://<deployed-app>/api/paypal/webhooks`, then set `PAYPAL_WEBHOOK_ID`. With it empty, incoming webhooks are rejected with 503 (secure default). Mock: events are signed locally and delivered through the same handler; replay any of them from the Activity page.

### Checkout UI: `<CheckoutButton>`

```tsx
<CheckoutButton
  createOrder={async () => ({ orderId: (await kitFetch<Order>("/api/paypal/orders", { json: { intent: "CAPTURE", amount: "25.00" } })).id })}
  onApprove={async ({ orderId }) => { await kitFetch(`/api/paypal/orders/${orderId}/capture`, { method: "POST" }); }}
  amountLabel="$25.00"
/>
```

- Sandbox: PayPal JS SDK **v6** through `@paypal/react-paypal-js/sdk-v6` (`PayPalProvider` + `PayPalOneTimePaymentButton`), `environment="sandbox"` hard-coded, client ID from `/api/kit/status`. Verified: loads `www.sandbox.paypal.com/web-sdk/v6/core` (v6.70.0) and opens PayPal's sandbox checkout window.
- Mock: a clearly labelled **"Simulate PayPal approval"** button opens a dialog and then follows the same server flow.
- Create orders on the server and compute amounts from your own data. The example route takes `amount` from the client only to stay generic.

### AI: `@/lib/ai`

Models live in `src/lib/ai/config.ts`: `default` = **`claude-haiku-5-5`**, `smart` = **`claude-sonnet-5-5`** (vision, hard reasoning). Every call goes through `guardedClaudeCall`, which:
1. estimates the worst case (input estimate + the full `max_tokens`, doubled for Sonnet's server-side refusal fallback) and reserves it against `AI_DAILY_CAP_USD` (persisted per UTC day in `.data/ai-spend.json`), refusing with `AiBudgetExceededError` (HTTP 402) past the cap;
2. calls `client.beta.messages` (Sonnet gets `fallbacks: "default"`; Haiku has no fallback);
3. checks `stop_reason: "refusal"` (`AiRefusalError`);
4. commits the real cost from `usage` and puts a card on the timeline.

```ts
import { generateObject, extractReceipt, compareImages, streamText, textStreamResponse, enforceRateLimit } from "@/lib/ai";

const { data, mocked } = await generateObject({
  schema: z.object({ category: z.enum(["refund", "question", "complaint"]), confidence: z.number() }),
  prompt: `Classify: ${message}`,
  mock: () => ({ category: "refund", confidence: 0.92 }),     // used with no API key
});

const { data: receipt } = await extractReceipt({ image: { dataUrl } });        // Sonnet 5.5, ReceiptSchema
const { data: verdict } = await compareImages({ images: [{ dataUrl: listing }, { dataUrl: delivered }], labels: ["Listing", "Delivered"], question: "Is the delivered item damaged?", schema, mock });

export const POST = route(async (req) => {          // streaming text route
  const stream = await streamText({ prompt: "...", mock: "Fallback text…" });
  return textStreamResponse(stream);
}, { rateLimit: "ai" });                             // per-IP limit; then readTextStream() in the browser
```

Rules: images max 5 MB (`imageBlock` checks it); never send `temperature`/`top_p` (400 since 2026-10-21); thinking is adaptive and effort is set per feature in `FEATURE_DEFAULTS`; don't force `tool_choice`. Use `enforceRateLimit(req, "ai")` (or `route(..., { rateLimit: "ai" })`) on every route that calls Claude.

### Agents: `@/lib/agent`

An agent is instructions + tools + a guard policy + a mock script. Register it in `src/agents/index.ts`; start it with `POST /api/agent/runs { agentId, goal, context }`; follow it on the timeline; approve on the card.

```ts
// src/agents/refunds.ts
export const refundAgent = defineAgent({
  id: "refunds",
  name: "Refund agent",
  description: "Reviews refund requests and refunds what policy allows.",
  system: `You handle refund requests for ${appConfig.name}. Refund at most the item price...`,
  tools: () => [...paypalTools({ toolkit: ["get_order", "create_refund", "list_transactions"], extensions: ["get_capture"] }), lookupOrderTool],
  policy: { approvalThreshold: "25.00", maxPerAction: "200.00" },
  effort: "low",
  mockScript: (input) => [
    { say: "Checking the capture first.", tool: "get_capture", input: { capture_id: String(input.context?.capture_id) }, as: "cap" },
    { say: "Refunding $18.00 for the damaged mug.", tool: "create_refund", input: (r) => ({ capture_id: r.cap.capture_id, amount: { currency_code: "USD", value: "18.00" } }) },
    { say: "Done: refunded $18.00." },
  ],
});
```

- **Claude loop** (`loop.ts`): a manual loop over `client.beta.messages.create`. Each turn passes the spend cap first; text, thinking summaries and tool calls stream to the timeline; all tool results go back in one user message; the conversation is append-only. It stops on `end_turn`, `refusal` or `maxTurns`.
- **Scripted runner** (`scripted.ts`): used automatically when AI is in mock mode. It runs the same tools, Guard, timeline and audit; only the decisions are scripted, and it is labelled "simulated" on screen.
- **Tools available** (`paypalTools()`):
  - PayPal Agent Toolkit 1.11 tools (source `paypal-agent-toolkit`): `create_order`, `get_order`, `pay_order`, `create_refund`, `get_refund`, `list_transactions`, `create_invoice`, `list_invoices`, `get_invoice`, `send_invoice`, `send_invoice_reminder`, `cancel_sent_invoice`, `record_payment_for_invoice`, `list_disputes`, `get_dispute`, `accept_dispute_claim`. In sandbox they run through the toolkit's own `PayPalAPI` executor; in mock, through adapters with identical argument handling.
  - Kit extensions, toolkit-style (source `kit-extension`): `create_authorization_order`, `authorize_order`, `get_authorization`, `capture_authorization`, `void_authorization`, `reauthorize_authorization`, `get_capture`, `create_payout`, `get_payout`, `charge_saved_payment_method`.
- **Guard** (`guard.ts`) applies, in order: blocked tools → idempotent replay (same tool + input in a run, or the same explicit `idempotency_key`, returns the stored result without calling PayPal) → resolve impact (amount + payees, may read PayPal) → per-action cap → payee allowlist → daily cap across runs → human approval (above `approvalThreshold`, or tools in `requireApprovalFor`) → execute with the idempotency key as `PayPal-Request-Id` → hash-chained audit entry. Denials go back to the model as `DENIED_BY_GUARD` with a reason.
- **Policy**: `DEFAULT_POLICY` in `policy.ts`, merged with `appConfig.agentPolicy` and the agent's `policy`. Defaults: $500 per action, $2,000 per day, approval above $50, payees `*@example.com`/sandbox domains, `accept_dispute_claim` always needs approval, approvals expire after 5 minutes.
- **Audit log**: `GET /api/audit` (entries plus `integrity` from hash-chain verification). Append-only `.data/audit.jsonl`; secrets are redacted.

### Timeline and UI components

```tsx
const { steps } = useTimeline();                       // this tab's session + global webhooks (SSE /api/events)
<ToolCallTimeline steps={steps} className="max-h-[700px]" />   // pending approvals render inline with Approve/Decline
<ApprovalPrompt approvalId={id} summary="Refund $18.00" amount={m} />   // standalone if you need it elsewhere
<MoneyBadge amount={{ currency_code: "USD", value: "45.00" }} direction="in" />   // in | out | hold | neutral
<DataGrid rows={rows} getRowId={(r) => r.id} columns={[col.date("createdAt"), col.status("status"), col.money("amount", "Amount", { direction: (r) => r.direction }), col.id("paypalId")]} />
<LedgerGrid entries={useLedger().entries} />
const { toast } = useToast(); toast({ title: "Captured $45.00", variant: "success" });
const { caption } = useCaption(); caption("The agent captures $80 for shipped items");   // ?captions=1 auto-captions agent messages
```

Server code emits timeline events automatically for PayPal calls, AI calls, tool calls, approvals and webhooks. Add your own with `timeline.emit({ kind: "info", status: "info", title: "Matched 3 receipts" })` or `startStep(...)` from `@/lib/events/bus`. Browser calls must use `kitFetch` from `useKit()` (it sends the `x-kit-session` header that routes events to the tab).

Design system: `@/components/ui` (Button/ButtonLink, Card/CardHeader/CardBody/CardFooter, Input/Textarea/Select/Field/MoneyInput, Modal, EmptyState, Skeleton/SkeletonCard, Badge/StatusPill, Stat). Re-skin with **`brandColor` in `src/app.config.ts`** only; every `brand-50…900` shade derives from it. Tailwind v4, Geist font, light theme. The app layout is `components/shell/app-shell.tsx` (sidebar, mode badges, AI spend meter) plus `PageHeader`. Landing sections (`SiteHeader`, `Hero`, `HowItWorks`, `Features`, `CtaBand`, `SiteFooter`) read `appConfig.landing`.

### Storage, seed, routes

- `collection<T>("customers")` gives a JSON-file collection with `list`/`get`/`upsert`/`remove`/`replaceAll`, re-read when the file changes.
- Mock seed: `npm run seed` or the dashboard's "Load demo data". Put app records in `src/lib/demo/app-data.ts`.
- Sandbox seed: `npm run seed:sandbox` (`src/lib/demo/sandbox-seed.ts`). It creates 6 card sales for 4 buyers and 3 fictional merchants, 2 refunds, 2 holds (one open, one part-captured then voided), an order awaiting its buyer, 3 invoices (due, paid, draft) and a payout batch. All apps share these objects: their ids are in the committed `src/lib/demo/sandbox-seed.json`, so a run in a new app only reads them, which fills that app's local ledger (`KIT_DATA_DIR`). Run it once per data dir. The file's keys are stable, so apps can import it to get a real id: `"capture:grinder"`, `"authorization:table-hold"`, `"invoice:workshop"`. Dates are the day of the seed run, because PayPal can't backdate. Disputes aren't seeded because only a buyer can open one. If PayPal expired the gift-card order the next run replaces it, so commit that one-line change.
- Route handlers: wrap every handler in `route(handler, { rateLimit?, mockOnly? })` and parse bodies with `readJson(req, zodSchema)`. Return plain objects. Errors map to JSON with the right status.

### Demo video

`demo/demo.spec.ts` is a template: scenes driven by Playwright, with `titleCard`, `caption` and `highlight` from `demo/captions.ts`, and a `DemoClock` that fails the run past 170 s. `npm run demo:record` builds, starts the production server (mock PayPal, mock AI unless `DEMO_AI_MODE=live`), records 1440×900 and saves `videos/demo-<time>.webm`.

**Record against the real sandbox:** `PAYPAL_MODE=sandbox npm run demo:record`. It starts from a clean `.data-demo` and runs the sandbox seed into it first. The real PayPal button needs a buyer login, and Playwright only records the main page, not PayPal's popup. So recordings set `DEMO_TEST_CARD=1`, which adds a "Skip the form: pay with the sandbox card in one tap" button under it (`data-testid="sandbox-test-card"`): the same server flow, approved by `POST /api/dev/sandbox/approve-order/:id`. The button and route don't exist without that flag. In your own spec, branch on `paypal.mode` from `/api/kit/status`, as `demo/demo.spec.ts` does. Mock-only steps (`/api/dev/reset`, `simulateDispute`...) don't run in sandbox.

**Make the upload file:** `npm run demo:mp4` turns the newest `videos/demo-*.webm` into an MP4 next to it (H.264, 30 fps, silent AAC track, faststart) and fails if it runs 3:00 or longer. Or `npm run demo:mp4 -- in.webm out.mp4`. It needs ffmpeg (`brew install ffmpeg`).

**Keeping it under 3 minutes:** design to length. Keep `DemoClock(170)` and tune `caption` reading times; each scene logs its timestamp. To trim a finished take without re-recording: `ffmpeg -ss 0 -i in.webm -t 175 -c copy out.webm`, then run `demo:mp4` on it.

### Deploy (Render)

`render.yaml` defines one web service: `npm ci && npm run build`, then `npm run seed:sandbox` and `next start -H 0.0.0.0` on each boot, health check `/api/kit/status`. Secrets are dashboard-only (`sync: false`). The disk is ephemeral: mock state, ledger, audit log and AI spend reset on redeploy, which is why the seed runs at boot; it only reads the committed objects, so it adds nothing to the sandbox. The free plan sleeps when idle, so open the URL a minute before judging. Set `PAYPAL_WEBHOOK_ID` after creating the webhook for the Render URL.

`DEMO_TEST_CARD=1` is on in `render.yaml` because judges have no sandbox buyer login. It only works in sandbox mode. `/api/dev/sandbox/approve-order/:id` is then public, so never set it with live credentials.

All entries share one sandbox app, and PayPal sends each app's webhook all of that app's events. `isOtherAppsEvent` in `webhook-handler.ts` drops an event that names an order, invoice or capture this app never touched, so one entry's payments stay out of another's ledger. In your own handlers, expect events only for objects this app created. Webhooks for payouts and disputes aren't filtered, because they name no order.

### PayPal MCP for your dev tools

`npm run paypal:mcp` starts PayPal's official MCP server (`@paypal/mcp@1.8.1`, stdio) against the sandbox with this app's credentials, so Claude Code can inspect sandbox data. Run `claude mcp add paypal-sandbox -- npm --prefix "$PWD" run -s paypal:mcp`. It is a development aid, not part of the app.

## Agent Toolkit / MCP: what the kit uses and why

| Option | Decision |
|---|---|
| `@paypal/agent-toolkit` 1.11 | **Used.** Its tool catalog (names, descriptions, JSON Schemas) comes from the `/openai` entry, its zod validators from `/mcp`, and its executor `PayPalAPI.run()` makes real sandbox calls. Neither entry loads `ai`. The `/ai-sdk` entry is **not** used: it builds `ai@4` tool objects, which are incompatible with `ai@7`. The kit doesn't install `ai` at all; Claude is called with `@anthropic-ai/sdk` directly. |
| Toolkit hazards we patch | `context.sandbox` defaults to **live**, so the kit always passes `sandbox: true` (a test asserts it). Its token is never refreshed, so the kit passes a fresh cached token on each call. It has no spend limits or approvals, so every tool runs behind the Guard. `accept_dispute_claim` validates `note` with the dispute-id regex (upstream issue #109), so the schema is overridden. Its errors drop PayPal's `debug_id` (known limitation). `create_order` is USD and CAPTURE only, so use `create_authorization_order` for holds. |
| Kit extensions | The toolkit has no authorization (capture/void/reauthorize), payouts or vault-charge tools, so the kit adds guarded tools in the same style. Apps can honestly say they **use PayPal's Agent Toolkit and extend it**. |
| `@paypal/mcp` (stdio) | Wrapped by `npm run paypal:mcp` for development tools only. Not in the request path: it is stdio-only and unguarded. |
| Anthropic MCP connector → PayPal hosted MCP (`https://mcp.sandbox.paypal.com/http`) | Optional, **read-only**: set `remoteMcp: () => paypalRemoteMcp()` on an agent (sandbox only; call `prefetchRemoteMcpToken()` first). Tool calls run on Anthropic's side, invisible to the Guard, so only an allowlist of read tools is enabled. **Untested**: PayPal doesn't document the exact bearer format. |
| Cost of the toolkit | It brings `ai@4`, `@langchain/core` and `openai@4` (about 240 extra packages). `npm audit` reports 11 advisories, all in that tree and in code paths the kit never loads. `mathjs` is overridden to 15.2.0 (the toolkit only calls `round`). It is marked `serverExternalPackages` in `next.config.ts`. |

## PayPal facts that matter (verified 2026-10-25)

- **JS SDK**: v6 is PayPal's recommended path; v5 (`/sdk/js?client-id=`) is deprecated and gets security fixes only. v6 needs a real sandbox client ID (no `sb`/`test`), and the environment comes from the `environment` prop, not the client ID.
- **AUTHORIZE orders** come back `CREATED` with links `self, approve, update, authorize` (verified in sandbox). The payer must approve within about 6 hours of creation. `COMPLETED` means authorized *or* captured *or* declined, so check `payments.captures[].status` before fulfilling.
- **Authorizations**: 3-day honor period, valid 29 days. Capture partially with `final_capture: false` and repeat. Total captures can reach 115% of the authorization, at most +$75 (USD). Voiding releases the uncaptured remainder; it fails once fully captured. Reauthorize only on days 4–29; it returns a **new id**, and the new authorization can't itself be voided (void the parent). PayPal's docs conflict on once vs many reauthorizations; the mock allows one.
- **Refunds**: full or repeated partials, up to 180 days after capture; no partial refunds while a dispute is open.
- **Payouts**: the batch is `PENDING` on create (verified) and finishes asynchronously, so poll `get` or use webhooks. `sender_batch_id` must be unique for 30 days. PHONE recipients are unsupported in sandbox. Test notes `ERRPYO002` / `ERRPYO005` force errors. Live Payouts needs PayPal approval; sandbox works.
- **Invoicing**: create makes a `DRAFT`; `send` goes to `SENT`, or `SCHEDULED` for a future invoice date (verified DRAFT → SENT → CANCELLED). Maximum 2 reminders per day. Drafts can't be cancelled (delete them instead). Sandbox numbers auto-increment ("0003"). Recording an external payment for the full amount gives `MARKED_AS_PAID` (verified in sandbox; docs conflict with `PAID`).
- **Disputes**: buyers open them, so use `simulateDispute` in mock. `provide-evidence` is multipart (`input` JSON part + files: PDF/PNG/JPG/GIF, ≤10 MB each, ≤50 MB total) and only allowed while `WAITING_FOR_SELLER_RESPONSE`. `accept-claim` refunds the buyer.
- **Transaction Search**: needs the reporting scope, which **this sandbox app does not have yet**, so calls get a 403. The kit turns that into `TRANSACTION_SEARCH_NOT_ENABLED` with the debug id. Once enabled: maximum 31-day range, data up to ~3 hours late. Use the ledger for demos.
- **Webhooks**: verification posts the raw body to PayPal; `PAYPAL_WEBHOOK_ID` is empty right now. PayPal retries failed deliveries up to 25 times over 3 days, so handlers must be idempotent (the kit de-duplicates by event id).
- **Vault**: enabled on this sandbox app (setup token → `PAYER_ACTION_REQUIRED`, verified). The buyer must approve the setup token in a browser before a payment token exists. Charge without the buyer using `payment_source.paypal.vault_id` + `stored_credential { MERCHANT, SUBSEQUENT }`.
- **`PayPal-Request-Id`** is honoured by Orders/Payments/Payouts/Vault writes, not by invoice create. Reusing an id replays the first result (verified on order create).
- The sandbox buyer approval step needs the sandbox buyer **password**, which only the user has. Headless tests can't complete it, so it's covered by mock tests and by a human on the example page.
- **Sandbox test card** (`4111…`, `src/lib/paypal/test-card.ts`) needs no login: an order created with `payment_source.card` completes at once, and `confirm-payment-source` with the card moves an existing order to `APPROVED`, so normal authorize/capture follows (verified 2026-11-01). Card orders have no `payer`; the ledger shows the card name as the counterparty.

## Next.js 16 notes (this is not the Next.js you remember)

- `cacheComponents: true`: pages and GET routes are prerendered unless they touch request data. `route()` calls `connection()`, so API routes are always dynamic. Keep data-fetching pages as client components (the kit's pattern), or wrap server data in `<Suspense>`.
- `export const dynamic` / `revalidate` don't exist with Cache Components. Don't add them.
- Route params are a Promise. Type the context with `RouteContext<"/api/x/[id]">` (generated by `next typegen`, which `npm run typecheck` runs).
- ESLint's React Compiler rules forbid setState synchronously in effects; set state from promise callbacks.
- Read `node_modules/next/dist/docs/` before using a Next API you haven't used in this repo.

## How to add a PayPal call to both implementations

1. Add request/response types to `src/lib/paypal/types.ts`, checked against PayPal's OpenAPI schema (`https://developer.paypal.com/api/<api>/schema.json`), not memory.
2. Add the method to the `PayPalApi` interface in `api.ts`, in the right namespace.
3. Add an entry to `OPERATIONS` in `operations.ts` (method, path with `{id}`, label, `idempotent`, `money`). The timeline and sandbox client use it.
4. **Sandbox** (`sandbox.ts`): `this.request("ns.method", { id, body, query, requestId, prefer })`.
5. **Mock** (`mock/index.ts`): implement inside `this.io("ns.method", opts, (ctx) => { ... })`. Validate first, then mutate. Throw `unprocessable(ISSUE, description)` / `notFound` / `invalidRequest` with PayPal's documented issue codes (add any invented code to `MOCK_ONLY_ISSUES`). Set `ctx.status` (201/202/204) and `this.emit(eventType, resource, summary)` for webhooks. Rollback is automatic on throw.
6. If the response isn't a resource (a link or 204), add a `REFRESH_AFTER` getter in `instrument.ts` so the ledger stays current.
7. Add a mock test in `tests/unit/paypal-mock.test.ts`. If you can, add a sandbox step to `sandbox.smoke.test.ts` and run `npm run test:sandbox`.

## How to add a guarded agent tool

```ts
// src/agents/tools/issue-credit.ts
export const issueStoreCredit = defineTool({
  name: "issue_store_credit",                       // snake_case, verb_object
  description: "Give the customer store credit instead of a refund. Use when policy says credit.",
  risk: "money",                                    // "read" | "write" | "money"
  source: "app",
  schema: z.object({ customer_email: z.string().email(), amount: z.string().regex(/^\d+(\.\d{1,2})?$/) }),
  impact: async (i) => ({ amount: money(i.amount), counterparties: [i.customer_email], summary: `Issue ${formatMoney(money(i.amount))} credit to ${i.customer_email}` }),
  execute: async (i, ctx) => credits.add(i.customer_email, i.amount, { idempotencyKey: ctx.idempotencyKey }),
  title: (i) => `Credit ${i.customer_email}`,
});
```

- `risk: "money"` **requires** `impact()` (amount + who gets paid). That drives caps, the allowlist, approvals, the card title and the money badge.
- `risk: "write"` gets idempotency + audit; amounts still count toward the per-action cap.
- PayPal tools: call `ctx.paypal.<ns>.<method>(..., { requestId: ctx.requestId })` so retries never double-charge.
- Return small JSON (ids, status, amounts). The model sees it, truncated at 8 KB.
- Add it to an agent's `tools()` and to its `mockScript`. Add a guard test if it has unusual rules.

## Conventions

- Amounts are decimal strings in `Money { currency_code, value }`. Do math with `@/lib/money` (`money`, `addMoney`, `toMinor`...), never floats. Payouts use `{ currency, value }`.
- Server-only code lives in `src/lib`. Client components never import `@/lib/paypal`, `@/lib/ai` or `@/lib/agent` (types only). Browser → API via `kitFetch`.
- API routes: `route()` + `readJson(zod)`. Rate-limit AI routes with `{ rateLimit: "ai" }`. Mark dev helpers `{ mockOnly: true }`.
- Files marked **APP-OWNED** are yours to edit freely. Keep kit modules generic; if you fix a kit bug, note it in your README.
- Small commits. No secrets in code, logs, screenshots or the video.

## Quality checklist (every app, before submission)

- [ ] **Complete flow in mock mode**: `PAYPAL_MODE=mock AI_MODE=mock npm run dev` runs the main story end to end with no credentials.
- [ ] **Sandbox path wired**: the main flow works with `PAYPAL_MODE=sandbox` (real v6 button, real sandbox calls); `npm run test:sandbox` passes; anything that needs a buyer login is noted.
- [ ] **PayPal is central**: at least two PayPal APIs beyond a basic capture, each listed in the README table.
- [ ] **AI is meaningful**: Claude makes real decisions (agent and/or structured/vision output) with a mock fixture for every call.
- [ ] **Agent actions are guarded**: money tools have `impact()`, the policy fits the app, and at least one approval happens in the demo.
- [ ] **Landing page** rewritten for the app (`appConfig.landing`): problem, three steps, CTA. No kit wording left.
- [ ] **Seed data** (`src/lib/demo/app-data.ts` + PayPal seed, `npm run seed:sandbox` in sandbox) makes the dashboard look alive.
- [ ] **Timeline visible** in the main flow; captions readable at 1440×900.
- [ ] **Playwright demo script** (`demo/demo.spec.ts`) rewritten for the app's story; `npm run demo:record` produces a webm under 3:00.
- [ ] **README sections filled** (from README.template.md), including the honest note that it was built with Claude Code.
- [ ] **LICENSE** (MIT) present with the app name.
- [ ] **Clean `npm run check`**: lint, typecheck, unit tests and build all pass. `npm run test:e2e` is updated for the app's flow and passes.
- [ ] `render.yaml` service name set; deployed URL works (or "runnable locally" is documented).
- [ ] Kit example removed or kept deliberately (`/example`, `src/agents/settlement.ts`).
- [ ] No secrets committed (`git grep -n "PAYPAL_CLIENT_SECRET=" ` shows only empty examples).

## Troubleshooting

| Symptom | Fix |
|---|---|
| `[kit env] PAYPAL_MODE="…" is not allowed` | Use `mock` or `sandbox`. |
| Sandbox 401 / `invalid_client` | Sandbox app credentials (not live) in `../../.env.shared`. |
| `ORDER_NOT_APPROVED` | The buyer hasn't approved: use CheckoutButton, or `simulateBuyerApproval` in mock. |
| `TRANSACTION_SEARCH_NOT_ENABLED` | Enable Transaction Search on the sandbox app; until then use `ledger`. |
| Webhooks rejected 503 | Set `PAYPAL_WEBHOOK_ID`. |
| `AiBudgetExceededError` (402) | Daily cap reached; raise `AI_DAILY_CAP_USD` or wait for 00:00 UTC. AI_MODE=mock for rehearsals. |
| Timeline shows nothing | Browser calls must use `kitFetch` (session header); server work must run inside `route()` or `withContext`. |
| Two dev servers fight over `.next` | e2e/demo use `NEXT_DIST_DIR=.next-e2e` automatically; don't run them against the same port as `npm run dev`. |
