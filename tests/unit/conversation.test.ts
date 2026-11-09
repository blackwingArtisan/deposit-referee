import { describe, expect, it } from "vitest";
import { conversation, shortName } from "@/lib/deposit/conversation";
import type { Booking, ChargeLine } from "@/lib/deposit/types";

const gouge: ChargeLine = { id: "ai-0", description: "Long gouge in the floor planks, left of centre.", amountCents: 15_000, price: { type: "scratch", size: "large" }, box: { x: 0.4, y: 0.6, w: 0.05, h: 0.2 } };
const stain: ChargeLine = { id: "ai-1", description: "Dark red-brown stain on the floor planks, right of centre.", amountCents: 10_000, price: { type: "stain", size: "medium" }, box: { x: 0.68, y: 0.59, w: 0.12, h: 0.08 } };
const proposal = { runId: "r1", kind: "charge", lines: [gouge, stain], rationale: "", engine: "", simulated: true, proposedAt: "2026-11-09T15:00:00.000Z" } as unknown as Booking["proposal"];
const base = { status: "proposed", authorizedCents: 30_000, heldAt: "2026-11-09T14:00:00.000Z", proposal, renterState: { deadline: "2026-11-11T15:00:00.000Z" } } as Pick<Booking, "status" | "authorizedCents" | "heldAt" | "proposal" | "renterState" | "partCapture" | "secondLook" | "settlement">;
const texts = (b: typeof base) => conversation(b).map((e) => e.text);

describe("the host's conversation rail", () => {
  it("names each line by the damage word in it", () => {
    expect(shortName(gouge)).toBe("Gouge");
    expect(shortName(stain)).toBe("Stain");
    expect(shortName({ description: "Something odd near the door", price: { type: "dent", size: "small" } })).toBe("Dent");
    expect(shortName({ description: "Something odd near the door" })).toBe("Something odd near");
  });

  it("before the renter opens it: the hold, then an answer due by the deadline", () => {
    expect(conversation(base)).toEqual([
      expect.objectContaining({ who: "renter", text: "Placed the $300 hold", at: base.heldAt }),
      expect.objectContaining({ who: "renter", text: "Answer due", at: "2026-11-11T15:00:00.000Z", waiting: true }),
    ]);
  });

  it("a split answer with a photo, the part capture, the second look, the counter and the settlement, in order", () => {
    const at = "2026-11-09T15:10:00.000Z";
    const booking: typeof base = {
      ...base,
      status: "settled",
      renterState: {
        deadline: "2026-11-11T15:00:00.000Z",
        openedAt: "2026-11-09T15:05:00.000Z",
        response: { decision: "contested", note: "It was there.", acceptedLineIds: ["ai-0"], amountCents: 25_000, at, evidence: { "ai-1": { photo: { src: "/x", mediaType: "image/jpeg" } as never } } },
      },
      // After the part capture the proposal holds only the contested line.
      proposal: { ...proposal!, lines: [{ ...stain, amountCents: 0 }] },
      partCapture: { runId: "p", lines: [gouge], requestedCents: 15_000, captureId: "CAP1", capturedCents: 15_000, capturedAt: "2026-11-09T15:11:00.000Z" },
      secondLook: { status: "accepted", startedAt: at, finishedAt: "2026-11-09T15:12:00.000Z", lines: [{ lineId: "ai-1", description: stain.description, verdict: "already_there", reasoning: "", fromCents: 10_000, toCents: 0, withPhoto: true }], mocked: true, costUsd: 0, sentAt: "2026-11-09T15:13:00.000Z", acceptedAt: "2026-11-09T15:14:00.000Z" },
      settlement: { runId: "s", kind: "release", requestedCents: 0, capturedCents: 15_000, releasedCents: 15_000, settledAt: "2026-11-09T15:15:00.000Z" },
    };
    expect(texts(booking)).toEqual([
      "Placed the $300 hold",
      "Opened the proposal",
      "Gouge accepted",
      "Stain contested with a photo",
      "$150.00 captured for what they accepted",
      "Second look: stain already there",
      "Counter sent: $0.00",
      "Accepted the counter",
      "$150 captured · $150 released",
    ]);
    expect(conversation(booking).every((e) => !e.waiting)).toBe(true);
  });

  it("an accept of everything is one entry, and nothing is waiting on the renter", () => {
    const booking = { ...base, status: "awaiting_approval", renterState: { deadline: "2026-11-11T15:00:00.000Z", response: { decision: "accepted", amountCents: 25_000, at: "2026-11-09T15:10:00.000Z" } } } as typeof base;
    expect(texts(booking)).toEqual(["Placed the $300 hold", "Accepted all 2 items"]);
  });

  it("before the hold, the rail says so", () => {
    expect(conversation({ status: "draft" } as typeof base)).toEqual([expect.objectContaining({ text: "Hasn't placed the hold yet", waiting: true })]);
  });
});
