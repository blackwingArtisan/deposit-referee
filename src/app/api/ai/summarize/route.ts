import { route } from "@/lib/http";
import { streamText, textStreamResponse } from "@/lib/ai";
import { ledger } from "@/lib/paypal";
import { formatMoney } from "@/lib/money";

/** Example streaming AI route: a plain-English summary of recent PayPal activity. */
export const POST = route(
  async () => {
    const rows = ledger.list().slice(0, 25).map((e) => `${e.kind} ${e.paypalId} ${e.status} ${e.amount ? formatMoney(e.amount) : ""} ${e.description ?? ""}`);
    const stream = await streamText({
      feature: "activity summary",
      system: "You summarize a merchant's PayPal activity for a busy owner. Plain English, 2-4 short sentences, mention totals. No markdown.",
      prompt: rows.length ? `Recent activity, newest first:\n${rows.join("\n")}` : "There is no activity yet. Say so in one sentence.",
      maxTokens: 1024,
      mock: rows.length
        ? `You have ${rows.length} recent PayPal records. Payments were authorized and partly captured, and remaining holds were voided so buyers got their funds back. (AI mock mode: set ANTHROPIC_API_KEY for a real summary.)`
        : "No PayPal activity yet. (AI mock mode)",
    });
    return textStreamResponse(stream);
  },
  { rateLimit: "ai" },
);
