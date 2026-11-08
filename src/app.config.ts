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
    { label: "Dashboard", href: "/insights" },
    { label: "Activity", href: "/activity" },
  ],

  landing: {
    eyebrow: "For hosts who rent out cabins, rooms or gear on their own, with no AirCover",
    headline: "A $300 deposit. A new scratch. Two different stories.",
    subheadline:
      "When you rent outside Airbnb or Turo, no platform settles the argument. Here the money stays on a PayPal hold; only what you approve is captured. Claude compares the check-in and check-out photos and boxes the new damage, and the renter sees the same evidence and can contest before anything moves.",
    holdNote: "A PayPal hold is guaranteed for 3 days and capturable until day 29, so it suits stays and gear rentals, not long leases.",
    primaryCta: { label: "Open bookings", href: "/bookings" },
    secondaryCta: { label: "See the dashboard", href: "/insights" },
    steps: [
      { title: "Hold the deposit", body: "The renter approves a PayPal hold. Nothing is charged. PayPal guarantees it for 3 days, and it can be captured until day 29." },
      { title: "Compare the photos", body: "Claude looks at check-in and check-out, draws a red box on new damage and suggests a charge with its reasons." },
      { title: "Approve the charge", body: "The renter can accept or contest. You set the exact amount, PayPal captures that and releases the rest." },
    ],
    features: [
      { title: "Money stays on hold", body: "The deposit is authorized, not taken. Only the amount you approve is ever captured, and the app's code refuses anything over the hold." },
      { title: "Evidence both sides read", body: "Both photos side by side, the damage boxed, and reasons the renter sees on their own link before any charge." },
      { title: "Not another inspection tool", body: "Damage-inspection apps stop at a report. This one keeps the money on a PayPal hold until the host and renter have seen the same evidence." },
    ],
  },

  /** Guard policy (merged over DEFAULT_POLICY). A deposit charge or release always waits for the host. */
  agentPolicy: {
    approvalThreshold: "50.00",
    maxPerAction: "500.00",
    maxPerDay: "2000.00",
    requireApprovalFor: ["capture_deposit", "capture_accepted_items", "release_deposit", "submit_dispute_evidence", "accept_dispute_claim"],
  } satisfies Partial<GuardPolicy>,
};

export type AppConfig = typeof appConfig;
