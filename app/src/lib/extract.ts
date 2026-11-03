// Turns a call transcript or a text thread into a structured request.
// One Claude call with structured output, then deterministic clean-up in code
// (canonical product names, pickup dates in the customer's time zone).
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { llm, MODEL } from "./llm";
import { normalizeProduct, resolvePickupDate } from "./produce";

export const RequestTypeSchema = z.enum(["new_order", "availability", "hold", "change", "complaint", "pickup", "other"]);

export const ExtractedLineSchema = z.object({
  product: z.string().describe("Product as the buyer said it, e.g. 'vine-ripes', 'romas', 'red bells', 'jitomate bola'"),
  size: z.string().nullable().describe("Size as said: '4x4', '5x6', 'XL', or null"),
  pack: z.string().nullable().describe("Pack as said: '25 lb two-layer', '10 lb flat', or null"),
  cases: z.number().int().nullable().describe("Number of cases, or null if not given"),
  priceOffered: z.number().nullable().describe("Price per case the buyer offered or asked for, in dollars, or null"),
  pickup: z.string().nullable().describe("Pickup timing exactly as said: 'Monday', 'el lunes', 'tomorrow', 'next week', or null"),
  fulfillment: z.enum(["collect", "delivered"]).nullable().describe("collect = buyer's truck picks up (FOB); delivered = wants it delivered"),
  destination: z.string().nullable().describe("Delivery city if delivered, else null"),
  poNumber: z.string().nullable(),
});

export const ExtractedRequestSchema = z.object({
  type: RequestTypeSchema,
  callerName: z.string().nullable(),
  callerCompany: z.string().nullable(),
  callerCity: z.string().nullable(),
  callbackNumber: z.string().nullable().describe("Digits as given, e.g. '312-555-0142'; null if not given"),
  callbackPermission: z.boolean().nullable().describe("Did the buyer agree to be called or texted back? null if not asked"),
  preferredChannel: z.enum(["call", "text", "whatsapp"]).nullable(),
  lines: z.array(ExtractedLineSchema),
  language: z.enum(["en", "es", "mixed"]),
  flags: z.array(z.enum(["incomplete", "unclear", "wants_quote", "urgent", "insists_on_person", "spam"])),
  summary: z.string().describe("One line for the rep, in English, buyer-first: who, what, how many, price, when"),
  complaint: z.object({
    load: z.string().nullable(), arrivedAt: z.string().nullable(), problem: z.string().nullable(),
    shareAffected: z.string().nullable(), wants: z.enum(["credit", "reject", "unknown"]).nullable(),
  }).nullable(),
});
export type ExtractedRequest = z.infer<typeof ExtractedRequestSchema>;

export type CustomerContext = {
  name: string;            // "Del Campo Supreme"
  timezone: string;        // "America/Phoenix"
  products?: string[];     // tonight's product list, if any
  now: Date;
};

const SYSTEM = `You read transcripts of calls and texts to a fresh-produce sales desk after hours and turn each one into a structured request for the sales reps.

You know produce trade talk:
- "4x4", "4x5", "5x6" are tomato sizes (tomatoes per row in a layer; fewer per row = bigger fruit). "VR" or "vine-ripes" are vine-ripe tomatoes. "TOV" is tomatoes on the vine. "Romas" are Roma tomatoes. "Red bells" are red bell peppers; sizes XL, L, M.
- "cs" means cases. "25 lb two-layer" is a pack. "FOB" or "collect" means the buyer's own truck picks up at the warehouse. "Delivered" means the seller arranges freight.
- Spanish and Spanglish are common: jitomate bola = vine-ripe tomatoes, jitomate saladette = Roma tomatoes, chile morrón = bell pepper, calabacita = squash, pepino = cucumber, cajas = cases, el lunes = Monday, mañana = tomorrow, recoger = collect.
- Buyers say numbers loosely: "three hundred", "a load", "a pallet". Only fill 'cases' when a case count is actually said; a pallet or a load is not a case count.

Rules:
- Several products in one call are several lines of ONE request.
- Never invent a price, quantity, size or date. Leave it null and add the flag "incomplete" when something an order needs is missing (buyer, callback number, product, quantity, pickup day).
- Add "unclear" when the transcript is garbled or contradictory; "wants_quote" when the buyer asks what the price is; "urgent" when a load is being rejected right now; "insists_on_person" when the buyer demands a human after being told the team will call back; "spam" for robocalls and sales pitches.
- Request types: new_order (an order or a priced quote request), availability (what do you have), hold (hold product), change (change an existing order), complaint (arrival problem, rejection, credit), pickup (truck, driver, pickup time), other.
- 'pickup' on a line is the timing phrase exactly as said; the application resolves it to a date.
- The summary is one plain line a rep reads in two seconds.`;

export async function extractRequest(transcript: string, ctx: CustomerContext): Promise<ExtractedRequest & { resolvedLines: ResolvedLine[] }> {
  const nowLocal = ctx.now.toLocaleString("en-US", { timeZone: ctx.timezone, weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" });
  const context = [
    `Customer (the produce company whose line this is): ${ctx.name}`,
    `Time zone: ${ctx.timezone}. It is now ${nowLocal}.`,
    ctx.products?.length ? `Products on tonight's price sheet: ${ctx.products.join("; ")}` : "No price sheet loaded tonight.",
  ].join("\n");

  const response = await llm().messages.parse({
    model: MODEL,
    max_tokens: 4000,
    output_config: { effort: "medium", format: zodOutputFormat(ExtractedRequestSchema) },
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: `${context}\n\nTranscript:\n${transcript}` }],
  });
  if (response.stop_reason === "refusal") throw new Error(`Extraction refused: ${response.stop_details?.explanation ?? "no explanation"}`);
  const parsed = response.parsed_output;
  if (!parsed) throw new Error("Extraction returned no structured output");
  return { ...parsed, resolvedLines: parsed.lines.map((l) => resolveLine(l, ctx)) };
}

export type ResolvedLine = z.infer<typeof ExtractedLineSchema> & { productCanonical: string | null; pickupDate: string | null };

export function resolveLine(line: z.infer<typeof ExtractedLineSchema>, ctx: CustomerContext): ResolvedLine {
  return {
    ...line,
    productCanonical: normalizeProduct(line.product),
    pickupDate: line.pickup ? resolvePickupDate(line.pickup, ctx.now, ctx.timezone) : null,
  };
}
