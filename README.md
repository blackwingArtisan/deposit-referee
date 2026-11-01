# Deposit Referee

> Hosts who rent out rooms, tools or gear hold a deposit with PayPal; AI compares the check-in and check-out photos and suggests a charge; the host approves the exact amount, and the rest goes back to the renter.

**Status:** runs locally against the PayPal sandbox; not deployed yet · **Video (≤3 min):** <!-- TODO: YouTube link --> · **License:** MIT

![Screenshot](docs/screenshot.png) <!-- TODO: add a 1440×900 screenshot of the main flow -->

## The problem

<!-- TODO: 3–5 sentences. Who has the problem, how often, what it costs them today (time, money, errors). Use a concrete example. -->

## What it does

1. The host creates a booking with a deposit, for example $200 for a lakeside cabin.
2. The renter places the deposit: a PayPal order with `intent=AUTHORIZE`. The money is held, not taken, for up to PayPal's 29-day limit.
3. Check-in and check-out photos go on the booking, each with its source shown.
4. Claude compares the two photos, itemizes new damage, draws a red box on it and suggests a charge with its reasons.
5. The AI suggests, the host decides: the host sets the exact charge, and it waits at the approval gate. No money moves before that approval.
6. PayPal captures exactly that amount, the rest of the hold is voided, and the result screen shows, for example, "$150 captured, $50 released", re-read from PayPal.

Money rules in code (`src/lib/deposit/rules.ts`): all amounts are integer cents, released is authorized minus captured and never comes from the AI, and a charge above the hold or on an expired hold is refused.

## How PayPal is used

All PayPal calls go to the **sandbox** (`https://api-m.sandbox.paypal.com`); there is no live mode in the code. Every call shows on the in-app timeline with its HTTP status and PayPal `debug_id`.

| PayPal API | Endpoint(s) | Where and why |
|---|---|---|
| JS SDK v6 (buyer approval) | `web-sdk/v6/core`, `PayPalOneTimePaymentButton` | <!-- TODO --> |
| Orders v2 | `POST /v2/checkout/orders`, `/authorize`, `/capture` | <!-- TODO --> |
| Payments v2 | `/v2/payments/authorizations/{id}/capture`, `/void`, `/v2/payments/captures/{id}/refund` | <!-- TODO --> |
| Payouts | `POST /v1/payments/payouts` | <!-- TODO or delete row --> |
| Invoicing v2 | `/v2/invoicing/invoices`, `/send`, `/remind` | <!-- TODO or delete row --> |
| Disputes | `/v1/customer/disputes`, `/accept-claim`, `/provide-evidence` | <!-- TODO or delete row --> |
| Transaction Search | `GET /v1/reporting/transactions` | <!-- TODO or delete row --> |
| Webhooks | `POST /v1/notifications/verify-webhook-signature` | Verified webhooks update the app's ledger and trigger <!-- TODO --> |
| Vault v3 | `/v3/vault/setup-tokens`, `/payment-tokens` | <!-- TODO or delete row --> |
| **PayPal Agent Toolkit** | `@paypal/agent-toolkit` 1.11 tools: <!-- TODO list the ones your agent uses --> | The agent's PayPal tools come from PayPal's Agent Toolkit (definitions, validation and sandbox execution), extended with guarded tools the toolkit lacks (<!-- TODO e.g. capture_authorization, void_authorization -->). |

**Safety around money:** every money-moving agent call passes a guard. It enforces a per-action cap, a daily cap, a payee allowlist and idempotency (`PayPal-Request-Id`), and makes calls above <!-- TODO $50 --> wait for a human. Every decision goes to a hash-chained, append-only audit log.

## How AI is used

| Where | Model | What it does |
|---|---|---|
| <!-- TODO e.g. Settlement agent --> | Claude Haiku 5.5 (`claude-haiku-5-5`) | Plans the task and calls the PayPal tools in a loop; explains each step on the timeline |
| <!-- TODO e.g. Receipt reading --> | Claude Sonnet 5.5 (`claude-sonnet-5-5`) | Vision: extracts structured data from photos |
| <!-- TODO --> | | |

- **Agent loop**: Claude's tool use via the Anthropic TypeScript SDK (`@anthropic-ai/sdk`), with adaptive thinking and summarized reasoning shown on the timeline.
- **Structured output**: zod schemas through the Messages API's structured outputs (`output_config.format`).
- **Cost control**: a hard daily spend cap (worst case reserved before every call), per-IP rate limits, and Haiku by default.
- **Mock mode**: without an API key the app runs a clearly labelled scripted agent, so the demo works anywhere.

**Built with AI.** This project was built with **Claude Code** (Anthropic's coding agent), which wrote the code under human direction. It started from a shared starter kit that Claude Code also wrote. The product idea, scope and review were human decisions.

## Architecture

```
Browser (Next.js 16 / React 19, Tailwind, AG Grid)
  │  PayPal JS SDK v6 button ─────────────► PayPal sandbox checkout (buyer approval)
  │  SSE /api/events (live timeline)
  ▼
Next.js route handlers (Node)
  ├─ lib/paypal   typed PayPal client: sandbox REST (OAuth cache, PayPal-Request-Id, debug_id) or in-memory mock
  ├─ lib/agent    Claude tool-use loop → Guard (caps, allowlist, approvals, idempotency, audit) → tools
  │                 tools = PayPal Agent Toolkit 1.11 + guarded extensions
  ├─ lib/ai       Claude Haiku 5.5 / Sonnet 5.5: structured output, vision, streaming; daily spend cap
  ├─ webhooks     verify → ledger → handlers
  └─ .data/       local JSON: ledger, audit log, AI spend (mock PayPal state in mock mode)
```

App code: `src/lib/deposit/` (rules, bookings, photos, AI review, settlement), `src/agents/tools/capture-deposit.ts` (the guarded charge), `src/components/deposit/`, `src/app/(app)/bookings/`, `src/app/api/bookings/`. The kit's `/example` and `/dashboard` pages are still in the code, but not in the nav.

## Run locally

Requirements: Node 24+ (developed on Node 26), npm.

```bash
npm ci
cp .env.example .env.local        # optional: values here override ../../.env.shared
PAYPAL_MODE=mock npm run dev      # no credentials needed
npm run seed                      # optional demo data
```

Open http://localhost:3000. For the real sandbox set `PAYPAL_MODE=sandbox`, `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET`. For real AI set `ANTHROPIC_API_KEY`.

Checks: `npm run check` (lint, typecheck, unit tests, build), `npm run test:e2e` (mock PayPal, mock AI), `npm run test:sandbox`.

`npm run test:e2e:sandbox` runs the whole deposit flow in a real browser on the PayPal sandbox with mock AI, then re-reads the order, capture and authorization straight from PayPal. It pays the deposit with PayPal's sandbox test card (`DEMO_TEST_CARD=1`). `E2E_AI_MODE=live npm run test:e2e:sandbox` does the same with one paid vision call.

## Sandbox test accounts

1. In the PayPal Developer Dashboard → **Testing Tools → Sandbox Accounts**, use the default Personal (buyer) and Business (seller) accounts or create new ones.
2. Create a sandbox REST app under **Apps & Credentials → Sandbox** and copy its client ID and secret.
3. At checkout, log in with the **Personal** sandbox account (password on the account's details page).
4. Optional: add a webhook for `https://<your-deploy>/api/paypal/webhooks` and set `PAYPAL_WEBHOOK_ID`.

<!-- TODO: if judges should use a specific buyer account, give its email here (never a real account). -->

## Deploy

Render Blueprint (`render.yaml`): New → Blueprint → this repo, then enter the secrets in the dashboard.

## Limitations

- Sandbox only; no live payments are possible.
- Buyer approval in sandbox needs a sandbox buyer login, so automated tests cover that step in mock mode.
- Local JSON storage: data resets on redeploy (fine for a demo, not for production).
- Sandbox Transaction Search needs the reporting feature enabled on the PayPal app, and data can lag up to 3 hours; the app keeps its own ledger.
- The optional PayPal remote MCP connector is read-only and untested.
- There are no logins yet: one browser plays both host and renter, and anyone with the page could approve.
- The wallet button needs a sandbox buyer login, so automated runs pay with the test card. The wallet path hasn't been run through to a hold.
- Vision has only been shown to be reliable on obvious damage (TK-39 spike, 5 photo pairs). Subtle damage is untested.
- The demo photos are CC0, and the floor gouge in the check-out photo is digitally added. See [PHOTO-CREDITS.md](PHOTO-CREDITS.md).
- A no-damage booking can't be settled yet: releasing a whole deposit with no charge comes later.

## License

MIT, see [LICENSE](LICENSE).
