/** Booking records. Shared by server and browser, so types only. */
import type { DamageSize, PriceRow } from "./prices";
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
  | { kind: "upload"; addedAt: string; by?: "renter" };

export interface BookingPhoto {
  src: string;
  mediaType: "image/jpeg" | "image/png" | "image/webp";
  source: PhotoSource;
}

/** Which check-out photo a finding is boxed on: the host's, unless the renter's own shows it. */
export type FindingPhoto = "check_out" | "renter_check_out";

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
  /** From the price table for `price`, never from the model. */
  chargeCents: number;
  /** The price-table row the amount came from. */
  price?: PriceRow;
  /** The photo the box is on. Absent means the host's check-out photo. */
  photo?: FindingPhoto;
}

export interface DamageReview {
  newDamage: boolean;
  items: DamageItem[];
  /** Marks the AI noticed but wouldn't charge. No total includes these unless the host adds one. */
  worthALook?: DamageItem[];
  reasoning: string;
  confidence: "high" | "medium" | "low";
  /** Sum of the items, limited to the hold. Added up in code. */
  suggestedCents: number;
  /** The items add up to more than the hold. */
  cappedToHold: boolean;
  mocked: boolean;
  model?: string;
  costUsd: number;
  /** The renter's own photos the comparison weighed. */
  renterPhotos?: PhotoSlot[];
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
  /** The price-table row the AI's amount came from. */
  price?: PriceRow;
  /** The photo the box is on. Absent means the host's check-out photo. */
  photo?: FindingPhoto;
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
  /** The host's one-line reason for changing the AI's figures. The renter sees it. */
  hostReason?: string;
}

export interface RenterResponse {
  decision: "accepted" | "contested";
  note?: string;
  /** On a contest: the lines the renter accepts. Those can be charged at once, on their own. */
  acceptedLineIds?: string[];
  /** The charge the renter was answering. */
  amountCents: number;
  /** On a contest: the renter's own photo for a contested line, by line id. */
  evidence?: Record<string, { photo: BookingPhoto }>;
  at: string;
}

/** What Claude's second look found on one contested line, against the renter's evidence. */
export type SecondLookVerdict = "new" | "already_there" | "smaller" | "unsure";

export interface SecondLookLine {
  lineId: string;
  description: string;
  verdict: SecondLookVerdict;
  /** With "smaller": the size of the part Claude still sees as new. */
  newSize?: DamageSize;
  reasoning: string;
  /** The line before the second look. */
  fromCents: number;
  /** The line after it, worked out by code (second-look-rules.ts). Never above fromCents. */
  toCents: number;
  /** The price-table row the lower amount comes from, when it changed row. */
  price?: PriceRow;
  /** The renter sent a photo for this line. */
  withPhoto: boolean;
}

/** The agent's counter-offer, built from the second look. It moves no money. */
export interface Counter {
  runId: string;
  rationale: string;
  engine: string;
  simulated: boolean;
  proposedAt: string;
}

/**
 * The renter contested with their own evidence; Claude re-read each contested line against it.
 * running -> ready (the agent has a counter) -> sent (the host sent it to the renter) -> accepted.
 */
export interface SecondLook {
  status: "running" | "ready" | "sent" | "accepted" | "failed";
  startedAt: string;
  finishedAt?: string;
  lines: SecondLookLine[];
  mocked: boolean;
  model?: string;
  costUsd: number;
  counter?: Counter;
  sentAt?: string;
  acceptedAt?: string;
  /** Why it stopped, in words the host can act on. */
  error?: string;
}

export interface RenterState {
  /** With no answer by this time, the host may go ahead. */
  deadline: string;
  /** The first time the renter opened their page with this proposal on it. */
  openedAt?: string;
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

/** The accepted items, charged on their own from the hold before the contested part is settled. */
export interface PartCapture {
  runId: string;
  /** The accepted items, as they were when the renter answered. */
  lines: ChargeLine[];
  requestedCents: number;
  /** What the renter contested when they answered, so later edits by the host don't change the record. */
  contestedCents?: number;
  captureId?: string;
  captureStatus?: string;
  capturedCents?: number;
  /** PayPal's own flag, read back: false, so the hold stays open for the contested part. */
  finalCapture?: boolean;
  capturedAt?: string;
  /** Why the last attempt stopped, in words the host can act on. */
  error?: string;
}

export interface Booking {
  id: string;
  /** Seeded example data, labelled as such wherever it shows. */
  sample?: boolean;
  /** The browser that made it (visitor.ts), so lists show each visitor their own bookings. */
  visitorId?: string;
  item: string;
  renter: string;
  depositCents: number;
  status: BookingStatus;
  createdAt: string;
  /** Opens the renter's own page. There are no logins, so the link is the only key. */
  renterToken: string;
  /** The host's key to act on this booking, in an httpOnly cookie on the browser that made it (host-key.ts). Never sent in a view. */
  hostSecret?: string;
  /** One-time links that open this booking as the host on another device (host-key.ts). Only hashes are kept. Never sent in a view. */
  hostLinks?: HostLink[];
  orderId?: string;
  authorizationId?: string;
  /** Set once the hold was refreshed after PayPal's 3-day honor period. Charges come from this one; a release voids the original, which voids both. */
  refreshedAuthorizationId?: string;
  authorizedCents?: number;
  holdExpiresAt?: string;
  /** When PayPal placed the hold. */
  heldAt?: string;
  photos: Partial<Record<PhotoSlot, BookingPhoto>>;
  /** The renter's own photos, added on their page before the comparison. */
  renterPhotos?: Partial<Record<PhotoSlot, BookingPhoto>>;
  review?: DamageReview;
  proposal?: Proposal;
  /** Why the agent stopped without a proposal. */
  agentError?: string;
  renterState?: RenterState;
  settlement?: Settlement;
  partCapture?: PartCapture;
  /** A PayPal dispute the renter opened on one of this booking's charges. */
  dispute?: BookingDispute;
  /** Claude's second look at the lines the renter contested, and the agent's counter. */
  secondLook?: SecondLook;
}

/** Sending the evidence pack to PayPal, through the Guard's approval gate. */
export interface EvidenceSubmission {
  runId: string;
  requestedAt: string;
  submittedAt?: string;
  /** The file PayPal received. */
  fileName?: string;
  /** Why the last attempt stopped, in words the host can act on. */
  error?: string;
}

/** A dispute as PayPal last reported it, read back with get_dispute. */
export interface BookingDispute {
  disputeId: string;
  /** The charge it is about. */
  captureId: string;
  reason: string;
  /** PayPal's status, e.g. WAITING_FOR_SELLER_RESPONSE, UNDER_REVIEW, RESOLVED. */
  status: string;
  amountCents: number;
  openedAt: string;
  /** PayPal wants the host's answer by this time. */
  responseDueAt?: string;
  /** What the renter wrote to PayPal. */
  buyerMessage?: string;
  /** PayPal's outcome once resolved. */
  outcome?: string;
  /** When the app last read it from PayPal. */
  readAt: string;
  evidence?: EvidenceSubmission;
}

export interface PendingApproval {
  id: string;
  summary: string;
  reason: string;
  amountValue?: string;
}

/** A one-time "open on another device" link: the hash of its code, and when it was used. */
export interface HostLink {
  hash: string;
  createdAt: string;
  expiresAt: string;
  usedAt?: string;
}

/**
 * What the browser receives: the record plus values worked out at read time. The renter's link
 * (`renterToken`) is only there for the host's browser; a visitor's copy has no such field.
 */
export interface BookingView extends Omit<Booking, "renterToken"> {
  renterToken?: string;
  hold: HoldClock | null;
  approval: PendingApproval | null;
  /** Waiting at the gate: sending the evidence pack to PayPal. */
  disputeApproval: PendingApproval | null;
  /** Set by GET /api/bookings/[id]: whether this browser holds the host's secret. A visitor sees no renter link. */
  viewer?: "host" | "visitor";
}

/** One row of the bookings list: no renter link. */
export type BookingListItem = Omit<BookingView, "renterToken">;

/** What the renter's page receives. No PayPal ids, no host controls. */
export interface RenterView {
  item: string;
  renter: string;
  depositCents: number;
  status: BookingStatus;
  /** The hold the renter placed from this page, once PayPal returns it. Its PayPal id stays with the host. */
  hold: { authorizedCents: number; expiresAt?: string } | null;
  chargeCents: number;
  releaseCents: number;
  proposal: Pick<Proposal, "kind" | "lines" | "rationale" | "engine" | "simulated" | "hostReason"> | null;
  confidence: DamageReview["confidence"] | null;
  photos: Booking["photos"];
  renterPhotos: NonNullable<Booking["renterPhotos"]>;
  /** Until the host compares the photos, the renter can add or replace their own. */
  canAddPhotos: boolean;
  renterState: RenterState | null;
  canAccept: boolean;
  canContest: boolean;
  settled: { capturedCents: number; releasedCents: number } | null;
  /** The renter accepted some items and contested the rest. chargedCents once the accepted part is charged. */
  split: { acceptedCents: number; contestedCents: number; chargedCents?: number } | null;
  /** Claude's second look: "running" while it reads the renter's evidence, the counter once the host sends it. */
  secondLook: { status: "running" | "with_host" | "sent" | "accepted"; lines?: SecondLookLine[]; rationale?: string; canAccept: boolean } | null;
  /** Once settled: the same ruling the host sees, PayPal's ids included. */
  ruling: RulingView | null;
}

/** The settled result both sides see on one page: amounts and ids as PayPal returned them, the photos with the final boxes. */
export type RulingView = Pick<
  Booking,
  "renter" | "item" | "status" | "authorizedCents" | "settlement" | "partCapture" | "proposal" | "review" | "photos" | "renterPhotos" | "orderId" | "authorizationId" | "secondLook"
>;
