// Reads what a rep sends back on a card: a button tap, or plain words like
// "yes but only 200", "tell him 8.75", "no, we're short", "take", "let me think".
// Fast path in code for the unambiguous shapes; Claude for the rest; one
// clarifying question when neither is sure.
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { llm, MODEL } from "./llm";

export const RepReplySchema = z.object({
  action: z.enum(["approve", "counter", "reject", "take_over", "undo", "won", "lost", "skip", "acknowledged", "unclear"]),
  cases: z.number().int().nullable().describe("A quantity cap the rep set, e.g. 'only 200' → 200; null otherwise"),
  price: z.number().nullable().describe("A counter price in dollars per case, e.g. 'tell him 8.75' → 8.75; null otherwise"),
  reason: z.string().nullable().describe("A reason to pass to the buyer on a reject, e.g. 'we're short'; null otherwise"),
  clarify: z.string().nullable().describe("If action is unclear: ONE short question to ask the rep"),
});
export type RepReply = z.infer<typeof RepReplySchema>;

const r = (action: RepReply["action"], extra: Partial<RepReply> = {}): RepReply => ({ action, cases: null, price: null, reason: null, clarify: null, ...extra });

/** Button payloads and the plain shapes we can read without a model. Returns null when unsure. */
export function parseRepReplyFast(text: string): RepReply | null {
  const t = text.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[.!]+$/, "");
  if (!t) return null;
  const button: Record<string, RepReply["action"]> = {
    approve: "approve", counter: "counter", reject: "reject", "take over": "take_over", takeover: "take_over", take: "take_over",
    undo: "undo", won: "won", lost: "lost", skip: "skip",
  };
  if (button[t]) return r(button[t]);
  if (/^(yes|yep|yeah|ok|okay|si|dale|va|orale|approved|go|do it|book it)$/.test(t)) return r("approve");
  if (/^(no|nope|nah|pass|reject it|no way)$/.test(t)) return r("reject");
  if (/^(let me think|thinking|hold on|gimme a minute|give me a minute|un momento|dejame ver|wait)$/.test(t)) return r("acknowledged");
  // "8.50", "8.50 max 200", "$8.5", "9 max 150"
  const counter = t.match(/^\$?\s*(\d{1,3}(?:\.\d{1,2})?)\s*(?:max(?:imum)?|up to|only|solo)?\s*(\d{1,5})?\s*(?:cs|cases?|cajas?)?$/);
  if (counter && Number(counter[1]) > 0 && Number(counter[1]) < 500) {
    return r("counter", { price: Number(counter[1]), cases: counter[2] ? Number(counter[2]) : null });
  }
  // "yes but only 200", "ok 200 only", "yes max 250"
  const partial = t.match(/^(?:yes|yep|yeah|ok|okay|si|dale)\b.*?\b(?:only|max|up to|solo|nomas)\s*(\d{1,5})\b/);
  if (partial) return r("approve", { cases: Number(partial[1]) });
  return null;
}

const SYSTEM = `You read short replies a produce sales rep sends on WhatsApp about a buyer's order request and classify them. Buttons are Approve, Counter, Reject, Take over; reps often type instead. English, Spanish and Spanglish.

Meanings:
- approve: yes, book it, go, ok, dale, órale; "yes but only 200" is approve with cases=200.
- counter: a single final price, e.g. "tell him 8.75", "8.50 max 200" (price 8.5, cases 200), "ofrécele nueve".
- reject: no, we're short, no stock, not at that price with no new price given. Put the reason the buyer may hear in 'reason' (e.g. "we're short this week"); do NOT include anything a buyer shouldn't hear.
- take_over: "take", "I'll call him", "mine", "yo le hablo", "déjame a mí".
- undo: "undo", "wait no", "cancel that".
- won / lost: after a take-over, how it ended.
- skip: skipping an optional question.
- acknowledged: "let me think", "hold on", "in a minute": no action yet.
- unclear: anything else. Then write ONE short clarifying question in 'clarify', e.g. "Is that a yes at $8.25 for all 300, or a counter?"

Never invent a price or quantity that wasn't said.`;

export async function parseRepReply(text: string, context?: { buyerFirst?: string; cases?: number | null; priceOffered?: number | null }): Promise<RepReply> {
  const fast = parseRepReplyFast(text);
  if (fast) return fast;
  const ctxLine = context ? `The request: ${context.buyerFirst ?? "the buyer"} wants ${context.cases ?? "?"} cases at ${context.priceOffered != null ? `$${context.priceOffered.toFixed(2)}` : "no stated price"}.` : "";
  const response = await llm().messages.parse({
    model: MODEL,
    max_tokens: 800,
    output_config: { effort: "low", format: zodOutputFormat(RepReplySchema) },
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: `${ctxLine}\nRep's reply: "${text}"`.trim() }],
  });
  if (response.stop_reason === "refusal" || !response.parsed_output) return r("unclear", { clarify: "Sorry, I didn't get that. Approve, counter with a price, reject, or take over?" });
  return response.parsed_output;
}
