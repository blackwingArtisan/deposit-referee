/** Booking records. Shared by server and browser, so types only. */
import type { HoldClock } from "./rules";

export type PhotoSlot = "check_in" | "check_out";

export type BookingStatus =
  | "draft" //              waiting for the renter's deposit
  | "held" //               deposit on hold, photos being added
  | "reviewed" //           photos compared, the settlement agent has not proposed yet
  | "proposed" //           the agent stopped with a proposal; the host decides, the renter can see it
  | "contested" //          the renter contested; back with the host, with their note
  | "awaiting_approval" //  the host's decision is at the Guard's approval gate
  | "captured" //           charge taken, rest of the hold not released yet
  | "settled"; //           charge taken and rest released, confirmed from PayPal

export type PhotoSource =
  | { kind: "demo"; title: string; author: string; licence: string; pageUrl: string; note: string }
  | { kind: "upload"; addedAt: string };

export interface BookingPhoto {
  src: string;
  mediaType: "image/jpeg" | "image/png" | "image/webp";
  source: PhotoSource;
}

/** Fractions of the check-out photo, 0 to 1. */
export interface DamageBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DamageItem {
  description: string;
  box: DamageBox | null;
  chargeCents: number;
}

export interface DamageReview {
  newDamage: boolean;
  items: DamageItem[];
  reasoning: string;
  confidence: "high" | "medium" | "low";
  /** Sum of the items, limited to the hold. Added up in code. */
  suggestedCents: number;
  /** The items add up to more than the hold. */
  cappedToHold: boolean;
  mocked: boolean;
  model?: string;
  costUsd: number;
}

/** One line of the charge. The capture limit is the sum of these lines. */
export interface ChargeLine {
  id: string;
  description: string;
  box: DamageBox | null;
  amountCents: number;
  /** The agent's amount for this line. Absent on a line the host added. */
  aiCents?: number;
  /** The agent's reason for this line. */
  note?: string;
}

/** What the settlement agent stopped with. `lines` can be changed by the host; `aiCents` never changes. */
export interface Proposal {
  runId: string;
  kind: "charge" | "release";
  /** The agent's total. 0 for a full release. */
  aiCents: number;
  lines: ChargeLine[];
  rationale: string;
  proposedAt: string;
  engine: string;
  simulated: boolean;
}

export interface RenterResponse {
  decision: "accepted" | "contested";
  note?: string;
  /** The charge the renter was answering. */
  amountCents: number;
  at: string;
}

export interface RenterState {
  /** With no answer by this time, the host may go ahead. */
  deadline: string;
  response?: RenterResponse;
}

export interface Settlement {
  runId: string;
  kind: "charge" | "release";
  requestedCents: number;
  /** The host had the renter's contest in front of them when they made this decision. */
  contestHeard?: boolean;
  captureId?: string;
  captureStatus?: string;
  capturedCents?: number;
  releasedCents?: number;
  authorizationStatus?: string;
  settledAt?: string;
  /** Why the last attempt stopped, in words the host can act on. */
  error?: string;
}

export interface Booking {
  id: string;
  /** Seeded example data, labelled as such wherever it shows. */
  sample?: boolean;
  item: string;
  renter: string;
  depositCents: number;
  status: BookingStatus;
  createdAt: string;
  /** Opens the renter's own page. There are no logins, so the link is the only key. */
  renterToken: string;
  orderId?: string;
  authorizationId?: string;
  authorizedCents?: number;
  holdExpiresAt?: string;
  photos: Partial<Record<PhotoSlot, BookingPhoto>>;
  review?: DamageReview;
  proposal?: Proposal;
  /** Why the agent stopped without a proposal. */
  agentError?: string;
  renterState?: RenterState;
  settlement?: Settlement;
}

export interface PendingApproval {
  id: string;
  summary: string;
  reason: string;
  amountValue?: string;
}

/** What the browser receives: the record plus values worked out at read time. */
export interface BookingView extends Booking {
  hold: HoldClock | null;
  approval: PendingApproval | null;
}

/** What the renter's page receives. No PayPal ids, no host controls. */
export interface RenterView {
  item: string;
  renter: string;
  depositCents: number;
  status: BookingStatus;
  chargeCents: number;
  releaseCents: number;
  proposal: Pick<Proposal, "kind" | "lines" | "rationale" | "engine" | "simulated"> | null;
  confidence: DamageReview["confidence"] | null;
  photos: Booking["photos"];
  renterState: RenterState | null;
  canAccept: boolean;
  canContest: boolean;
  settled: { capturedCents: number; releasedCents: number } | null;
}
