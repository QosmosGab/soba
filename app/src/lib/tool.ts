// What the intake agent can do mid-call through its webhook tool:
//   lookup      who is calling, what the desk may say, tonight's price for a product
//   try_clear   book the order on the spot if it meets tonight's rules (after hours only)
// One request per conversation: a retried or corrected try_clear updates, never duplicates.
import { and, eq, gt, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db";
import { schema } from "@/db";
import { lineByNumber } from "./http";
import { loadCustomer } from "./cards";
import { isOffHours } from "./hours";
import { createRequest, findByConversation, replaceLines, toE164, tryAutoClear, type Extracted } from "./requests";
import { resolveLine } from "./extract";
import { confirmDeal } from "./callbacks";
import { normalizeProduct, normalizeSize, normalizePack } from "./produce";
import { fmtMoney } from "./card";

export const ToolBody = z.object({
  action: z.enum(["lookup", "try_clear"]),
  called_number: z.string(),
  caller_id: z.string().nullable().optional(),
  conversation_id: z.string().nullable().optional(),
  product: z.string().nullable().optional(),
  size: z.string().nullable().optional(),
  pack: z.string().nullable().optional(),
  cases: z.coerce.number().int().nullable().optional(),
  price: z.coerce.number().nullable().optional(),
  pickup: z.string().nullable().optional(),
  fulfillment: z.enum(["collect", "delivered"]).nullable().optional(),
  buyer_name: z.string().nullable().optional(),
  company: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  callback_number: z.string().nullable().optional(),
  callback_permission: z.union([z.boolean(), z.enum(["true", "false"]).transform((v) => v === "true")]).nullable().optional(),
  language: z.enum(["en", "es", "mixed"]).nullable().optional(),
});
export type ToolBody = z.infer<typeof ToolBody>;

export type ToolResult = { status: number; body: Record<string, unknown> };

export async function deskTool(db: Db, input: unknown, now: Date): Promise<ToolResult> {
  const parsed = ToolBody.safeParse(input);
  if (!parsed.success) return { status: 400, body: { error: "bad request", issues: parsed.error.issues } };
  const b = parsed.data;
  const line = await lineByNumber(db, b.called_number);
  if (!line) return { status: 404, body: { error: "unknown line" } };
  const { customer, settings } = await loadCustomer(db, line.customerId);
  const offHours = isOffHours(now, settings.hours, customer.timezone, settings.holidays);
  const rules = await db.select().from(schema.priceRules).where(and(eq(schema.priceRules.customerId, customer.id), gt(schema.priceRules.expiresAt, now), eq(schema.priceRules.on, true)));

  if (b.action === "lookup") {
    const phone = toE164(b.caller_id);
    const buyer = phone ? (await db.select().from(schema.buyers).where(and(eq(schema.buyers.customerId, customer.id), sql`${schema.buyers.phones} @> ${JSON.stringify([phone])}::jsonb`)))[0] : null;
    const product = b.product ? normalizeProduct(b.product) : null;
    const size = b.product ? normalizeSize(`${b.product} ${b.size ?? ""}`) : null;
    const rule = product ? rules.find((r) => r.product === product && (!r.size || !size || r.size === size) && r.caseLimit > r.casesCleared) : null;
    return { status: 200, body: {
      known_buyer: buyer ? { name: buyer.contactName, company: buyer.company, city: buyer.city, usual_pickup: buyer.usualPickup, do_not_contact: buyer.doNotContact } : null,
      business_info: settings.businessInfo, spanish: settings.spanish, timing_promises: settings.timingPromises,
      after_hours: offHours, desk_answering: settings.answering, daytime_pickup: settings.daytimeOverflow,
      auto_clear_possible: offHours && settings.answering && settings.autoClear && rules.length > 0,
      tonight_price: settings.quotePrices && rule ? { product: rule.product, size: rule.size, pack: rule.pack, price: Number(rule.minPrice), cases_left: rule.caseLimit - rule.casesCleared, say: `Tonight's price on ${[rule.size, rule.product].filter(Boolean).join(" ")} is ${fmtMoney(Number(rule.minPrice))} a case.` } : null,
      products_on_sheet: Array.from(new Set(rules.map((r) => r.product))),
    } };
  }

  // try_clear: build the line, create (or update) the request, apply the rules atomically.
  const product = b.product ? normalizeProduct(b.product) : null;
  const ctx = { name: customer.name, timezone: customer.timezone, now };
  const extractedLine = resolveLine({ product: b.product ?? "", size: b.size ? normalizeSize(b.size) ?? b.size : null, pack: b.pack ? normalizePack(b.pack) ?? b.pack : null, cases: b.cases ?? null, priceOffered: b.price ?? null, pickup: b.pickup ?? null, fulfillment: b.fulfillment ?? null, destination: null, poNumber: null }, ctx);
  const extracted: Extracted = {
    type: "new_order", callerName: b.buyer_name ?? null, callerCompany: b.company ?? null, callerCity: b.city ?? null,
    callbackNumber: b.callback_number ?? b.caller_id ?? null, callbackPermission: b.callback_permission ?? null, preferredChannel: "call",
    lines: [extractedLine], language: b.language ?? "en", flags: [], summary: `${b.buyer_name ?? "Buyer"} wants ${b.cases ?? "?"} cs ${b.size ?? ""} ${product ?? b.product} at ${b.price != null ? fmtMoney(b.price) : "?"}`,
    complaint: null, resolvedLines: [extractedLine],
  };
  const passOn = "I'll pass this to the team and they'll get back to you.";
  const existing = await findByConversation(db, customer.id, b.conversation_id);
  let request: { id: string; ref: number };
  if (existing) {
    if (existing.status !== "in_progress") return { status: 200, body: { cleared: true, ref: existing.ref, say: `That order is already confirmed, reference ${existing.ref}.` } };
    await replaceLines(db, existing.id, [extractedLine]);
    request = existing;
  } else {
    const created = await createRequest(db, { customerId: customer.id, channel: "call", now, extracted, providerConversationId: b.conversation_id ?? undefined });
    if (created.merged) return { status: 200, body: { cleared: false, ref: created.request.ref, say: "This buyer already has an open request with the team; I'll add this to it." } };
    request = created.request;
  }
  const decision = await tryAutoClear(db, { requestId: request.id, customerId: customer.id, lines: [extractedLine], now, offHours, settings });
  if (!decision.clear) return { status: 200, body: { cleared: false, ref: request.ref, reason: decision.reason, say: passOn } };
  await confirmDeal(db, { requestId: request.id, now, source: "auto" });
  const l = decision.lines[0];
  return { status: 200, body: { cleared: true, ref: request.ref, price: l.price, cases: l.cases,
    say: `${l.cases} cases ${[extractedLine.size, extractedLine.productCanonical ?? extractedLine.product, extractedLine.pack].filter(Boolean).join(" ")}, pickup ${extractedLine.pickup ?? "as discussed"} at ${fmtMoney(l.price)}. You're confirmed, reference ${request.ref}.` } };
}
