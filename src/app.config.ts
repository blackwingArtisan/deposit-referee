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
  tagline: "Damage deposits, settled from two photos.",
  description: "Hold a rental deposit with PayPal, compare check-in and check-out photos with AI, and charge only what the host approves.",
  repoUrl: "",
  videoUrl: "",

  nav: [
    { label: "Bookings", href: "/bookings" },
    { label: "Activity", href: "/activity" },
  ],

  landing: {
    eyebrow: "For hosts who rent out rooms, tools and gear",
    headline: "Stop arguing over damage deposits.",
    subheadline:
      "The renter's deposit sits on hold with PayPal, not in your account. AI compares the check-in and check-out photos and marks the damage. You approve the exact charge, and the rest goes straight back.",
    primaryCta: { label: "Open bookings", href: "/bookings" },
    secondaryCta: { label: "See activity", href: "/activity" },
    steps: [
      { title: "Hold the deposit", body: "The renter approves a PayPal hold. Nothing is charged, and it lasts up to 29 days." },
      { title: "Compare the photos", body: "AI looks at check-in and check-out, draws a red box on new damage and suggests a charge with its reasons." },
      { title: "Approve the charge", body: "You set the exact amount. PayPal takes that and releases everything else." },
    ],
    features: [
      { title: "Money stays on hold", body: "The deposit is authorized, not taken. Only the amount you approve is ever captured." },
      { title: "Evidence on the page", body: "Both photos side by side, the damage marked, and reasons a renter can read." },
      { title: "Every step on record", body: "Each PayPal call and approval goes into a log that shows if anything was changed." },
    ],
  },

  /** Guard policy (merged over DEFAULT_POLICY). A deposit charge always waits for the host. */
  agentPolicy: {
    approvalThreshold: "50.00",
    maxPerAction: "500.00",
    maxPerDay: "2000.00",
    requireApprovalFor: ["capture_deposit", "accept_dispute_claim"],
  } satisfies Partial<GuardPolicy>,
};

export type AppConfig = typeof appConfig;
