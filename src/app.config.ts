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
  repoUrl: "https://github.com/blackwingArtisan/deposit-referee",
  videoUrl: "",

  nav: [
    { label: "Bookings", href: "/bookings" },
    { label: "Dashboard", href: "/insights" },
    { label: "Activity", href: "/activity" },
  ],

  landing: {
    eyebrow: "For hosts who rent out cabins, rooms or gear on their own, with no AirCover",
    headline: "More than half of hosts have had a guest damage their place.",
    /** Both polls say more than half: 53% (Aviva) and 60% (Hospitable). The page says the lower claim. */
    headlineSources: [
      { label: "Aviva poll of 1,000 UK hosts, 2019", href: "https://www.yourmoney.com/insurance/theft-warning-for-home-share-hosts/" },
      { label: "Hospitable survey, 2026", href: "https://en.10minhotel.com/?p=215240" },
    ],
    subheadline:
      "When you rent outside Airbnb or Turo, no platform settles the argument. Here the deposit stays on a PayPal hold; only what you approve is captured. Claude compares the check-in and check-out photos and boxes the new damage, and the renter sees the same evidence and can contest before anything moves.",
    holdNote: "A PayPal hold is guaranteed for 3 days and capturable until day 29, so it suits stays and gear rentals, not long leases.",
    primaryCta: { label: "Open bookings", href: "/bookings" },
    secondaryCta: { label: "See the dashboard", href: "/insights" },
    steps: [
      { title: "Hold the deposit", body: "The renter places a PayPal hold from their own link. Nothing is charged. PayPal guarantees it for 3 days, and it can be captured until day 29." },
      { title: "Compare the photos", body: "Claude looks at check-in and check-out, draws a red box on new damage and suggests a charge with its reasons." },
      { title: "Approve the charge", body: "The renter can accept or contest. You set the exact amount, PayPal captures that and releases the rest." },
    ],
    /** From round4/research/deposit-referee.md. Every figure links to where it was read. */
    painPoints: [
      {
        title: "Damage is common, and hosts often pay for it themselves",
        body: "Of hosts with guest damage in the past year, 66% paid for the repairs themselves. Airbnb's host damage protection applies when you host on Airbnb.",
        answer: "The deposit sits on a PayPal hold, so there is money to draw on without a platform.",
        sources: [
          { label: "Hospitable, 2026", href: "https://en.10minhotel.com/?p=215240" },
          { label: "Airbnb Help Center", href: "https://www.airbnb.com/help/article/3733" },
        ],
      },
      {
        title: "Nobody can prove what was there before",
        body: "\u201cIt was already there\u201d came up in 7 of the 14 host and guest stories we read. In a poll of 1,000 UK guests, 13% who broke something blamed someone else.",
        answer: "Check-in photos from the host and the renter, and Claude boxes only what is new at check-out.",
        sources: [
          { label: "Rick Steves Travel Forum, 2024", href: "https://community.ricksteves.com/travel-forum/tourist-scams/sos-airbnb-host-accused-me-of-damage" },
          { label: "Aviva via YourMoney, 2019", href: "https://www.yourmoney.com/insurance/theft-warning-for-home-share-hosts/" },
        ],
      },
      {
        title: "Charges look inflated and fall apart under questions",
        body: "In one forum case a claim of about 600 EUR fell to 150 EUR once the guest asked for receipts, then lapsed.",
        answer: "Every line has its photo and a price-table row, and the renter can contest one line, not the whole deposit.",
        sources: [{ label: "Rick Steves Travel Forum, 2024", href: "https://community.ricksteves.com/travel-forum/tourist-scams/sos-airbnb-host-accused-me-of-damage" }],
      },
      {
        title: "Card holds run out, and a kept deposit invites a chargeback",
        body: "Online card holds through Stripe usually last 7 days. A PayPal authorization is valid for 29 days, and you can capture from it more than once.",
        answer: "The renter's accept is on record, and the evidence pack is ready if they dispute. That lowers the chargeback risk; it can't remove it.",
        sources: [
          { label: "Stripe docs", href: "https://docs.stripe.com/payments/capture-later" },
          { label: "PayPal docs", href: "https://developer.paypal.com/docs/checkout/standard/customize/authorization/" },
          { label: "OwnerRez forum, 2024", href: "https://www.ownerrez.com/forums/general-help/airbnb-reservation-and-api-connected-damage-deposit-collected-directly-via-stripe" },
        ],
      },
    ],
    /** When the AI isn't sure, it says so and charges nothing. Shown with the blind test. */
    lookRule: {
      title: "Worth a look, nothing charged",
      body: "When Claude sees a mark but isn\u2019t sure it\u2019s new, it goes under Worth a look with an amber box on the photo. It is never charged unless you add it, and the renter sees anything you add.",
    },
    /**
     * Existing tools, each described only from its own public page (read 2026-11-08). We say what
     * each page says, not what it lacks: a missing feature on a page is not proof.
     */
    differs: {
      intro: "Each one below is described only from its own page, read in November 2026, and linked so you can check.",
      tools: [
        { name: "Witnessed", kind: "AI inspection", what: "Compares photos from the start and end of a stay or rental, tells wear from possible damage, and makes shareable PDF reports.", href: "https://www.producthunt.com/products/witnessed" },
        { name: "RentSolve AI", kind: "AI inspection", what: "Itemized deduction reports with photo evidence and repair estimates, emailed to the tenant.", href: "https://rentsolve-site.pages.dev/features/damage-deduction-reports" },
        { name: "CheckEasy", kind: "AI inspection", what: "AI check-in and check-out reports for short-term rentals. It saves the guest\u2019s card \u201cwithout holding anything\u201d and charges after damage.", href: "https://www.checkeasy.co/en" },
        { name: "VerifyAI (Switch Labs)", kind: "Photo API", what: "An API and SDKs that compare checkout and return photos for new damage and missing parts.", href: "https://verify.switchlabs.dev/use-cases/rental-return-verification" },
        { name: "Truvi (formerly Superhog)", kind: "Damage protection", what: "Damage protection with \u201cno guest deposits or waivers required\u201d; payouts go to the host.", href: "https://truvi.com/damage-protection" },
        { name: "Waivo", kind: "Damage waiver", what: "A non-refundable guest fee that \u201creplaces traditional security deposits\u201d, with $1,500 of cover.", href: "https://www.futurestay.com/built-in-partners/waivo" },
        { name: "Obligo", kind: "Lease deposit alternative", what: "Renters link a payment method instead of paying a lease deposit; owners can charge up to the deposit amount. A non-refundable fee applies.", href: "https://www.obligo.com/blog/obligo-a-better-security-deposit-alternative" },
      ],
      ours: [
        { title: "The hold stays on PayPal", body: "The renter\u2019s money is authorized on PayPal, not taken and not replaced by a fee. Only what the host approves is captured; the rest is released." },
        { title: "Several captures on one hold", body: "Lines the renter accepts are captured straight away, and the contested part stays on the same PayPal hold until the host decides." },
        { title: "The renter contests line by line", body: "The renter sees each line with its photo and price row, and accepts or contests each one before anything moves." },
      ],
    },
    features: [
      { title: "Money stays on hold", body: "The deposit is authorized, not taken. Only the amount you approve is ever captured, and the app's code refuses anything over the hold." },
      { title: "Evidence both sides read", body: "Both photos side by side, the damage boxed, and reasons the renter sees on their own link before any charge." },
      { title: "Every PayPal call named", body: "The activity strip shows each PayPal call with the Agent Toolkit tool that made it, and says plainly where the Toolkit has no tool for a step." },
    ],
  },

  /** Guard policy (merged over DEFAULT_POLICY). A deposit charge or release always waits for the host. */
  agentPolicy: {
    approvalThreshold: "50.00",
    maxPerAction: "500.00",
    // The mock e2e suite moves more mock money in a day than this; it may raise the cap for mock PayPal only, never the sandbox.
    maxPerDay: process.env.PAYPAL_MODE === "mock" && /^\d+\.\d\d$/.test(process.env.MOCK_MAX_PER_DAY ?? "") ? process.env.MOCK_MAX_PER_DAY! : "2000.00",
    requireApprovalFor: ["capture_deposit", "capture_accepted_items", "release_deposit", "submit_dispute_evidence", "accept_dispute_claim"],
  } satisfies Partial<GuardPolicy>,
};

export type AppConfig = typeof appConfig;
