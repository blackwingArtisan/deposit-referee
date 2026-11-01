/** Booking records. Shared by server and browser, so types only. */
import type { HoldClock } from "./rules";

export type PhotoSlot = "check_in" | "check_out";

export type BookingStatus =
  | "draft" //              waiting for the renter's deposit
  | "held" //               deposit on hold, photos being added
  | "reviewed" //           AI proposal ready, host deciding
  | "awaiting_approval" //  charge sent through the approval gate
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

export interface Settlement {
  runId: string;
  requestedCents: number;
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
  item: string;
  renter: string;
  depositCents: number;
  status: BookingStatus;
  createdAt: string;
  orderId?: string;
  authorizationId?: string;
  authorizedCents?: number;
  holdExpiresAt?: string;
  photos: Partial<Record<PhotoSlot, BookingPhoto>>;
  review?: DamageReview;
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
