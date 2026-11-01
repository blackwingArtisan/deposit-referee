/**
 * APP-OWNED: identity, copy and policy for this app. scripts/new-app.sh rewrites the lines
 * marked `kit:` — keep those markers. Everything here is safe to show in the browser.
 */
import type { GuardPolicy } from "@/lib/agent/policy";

export const appConfig = {
  name: "Deposit Referee", // kit:name
  slug: "deposit-referee", // kit:slug
  brandColor: "#0f766e", // kit:brand
  brandForeground: "#FFFFFF", // kit:brand-foreground
  tagline: "AI agents that move money safely with PayPal.",
  description: "A starter for PayPal AI Hackathon apps: guarded agent tools, live timeline, mock + sandbox PayPal.",
  repoUrl: "",
  videoUrl: "",

  nav: [
    { label: "Dashboard", href: "/dashboard" },
    { label: "Example flow", href: "/example" },
    { label: "Activity", href: "/activity" },
  ],

  landing: {
    eyebrow: "Built on PayPal + Claude",
    headline: "Let an AI agent run the payments busywork, with a human in the loop.",
    subheadline:
      "Authorize, capture, refund, invoice and pay out through PayPal. Every step the agent takes is visible, capped and auditable, and anything above your threshold waits for your approval.",
    primaryCta: { label: "Open the app", href: "/dashboard" },
    secondaryCta: { label: "See the example flow", href: "/example" },
    steps: [
      { title: "Connect PayPal", body: "Sandbox credentials or zero-setup mock mode. Orders, payments, payouts, invoicing and disputes are ready." },
      { title: "Give the agent a goal", body: "Claude plans the work and calls PayPal Agent Toolkit tools, plus guarded extensions for authorizations and payouts." },
      { title: "Approve what matters", body: "Caps, allowlists and approval thresholds are enforced on every money-moving call, and each decision is logged." },
    ],
    features: [
      { title: "Live agent timeline", body: "Every model step and PayPal call appears as a card with status, amount and debug id." },
      { title: "Human approval", body: "Money above your threshold pauses for a one-click approval. No silent transfers." },
      { title: "Audit trail", body: "An append-only, hash-chained log of every request, approval and result." },
    ],
  },

  /** Guard policy for this app's agents (merged over DEFAULT_POLICY). */
  agentPolicy: {
    approvalThreshold: "50.00",
    maxPerAction: "500.00",
    maxPerDay: "2000.00",
  } satisfies Partial<GuardPolicy>,
};

export type AppConfig = typeof appConfig;
