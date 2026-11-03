// The tool the intake agent calls mid-call. Authenticated by a shared secret
// header set on the ElevenLabs tool. Actions:
//   lookup      who is calling, what the desk may say, tonight's price for a product
//   try_clear   book the order on the spot if it meets tonight's rules (after hours only)
import { and, eq, gt } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { env } from "@/lib/env";
import { json, lineByNumber } from "@/lib/http";
import { loadCustomer } from "@/lib/cards";
import { isOffHours } from "@/lib/hours";
import { createRequest, toE164, tryAutoClear } from "@/lib/requests";
import { resolveLine, type ExtractedRequest } from "@/lib/extract";
import { confirmDeal } from "@/lib/callbacks";
import { normalizeProduct, normalizeSize, normalizePack } from "@/lib/produce";
import { fmtMoney } from "@/lib/card";

const Body = z.object({
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
  callback_permission: z.coerce.boolean().nullable().optional(),
});

export async function POST(req: Request) {
  if (process.env.SOBA_SKIP_SIGNATURES !== "1" && req.headers.get("x-soba-tool-secret") !== env.eleven.toolSecret) return json({ error: "unauthorized" }, 401);
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return json({ error: "bad request", issues: parsed.error.issues }, 400);
  const b = parsed.data;
  const db = await getDb();
  const now = new Date();
  const line = await lineByNumber(db, b.called_number);
  if (!line) return json({ error: "unknown line" }, 404);
  const { customer, settings } = await loadCustomer(db, line.customerId);
  const offHours = isOffHours(now, settings.hours, customer.timezone, settings.holidays);
  const rules = await db.select().from(schema.priceRules).where(and(eq(schema.priceRules.customerId, customer.id), gt(schema.priceRules.expiresAt, now), eq(schema.priceRules.on, true)));

  if (b.action === "lookup") {
    const phone = toE164(b.caller_id);
    const buyer = phone ? (await db.select().from(schema.buyers).where(and(eq(schema.buyers.customerId, customer.id), sqlPhone(phone))))[0] : null;
    const product = b.product ? normalizeProduct(b.product) : null;
    const size = b.product ? normalizeSize(`${b.product} ${b.size ?? ""}`) : null;
    const rule = product ? rules.find((r) => r.product === product && (!r.size || !size || r.size === size) && r.caseLimit > r.casesCleared) : null;
    return json({
      known_buyer: buyer ? { name: buyer.contactName, company: buyer.company, city: buyer.city, usual_pickup: buyer.usualPickup } : null,
      business_info: settings.businessInfo, spanish: settings.spanish, timing_promises: settings.timingPromises,
      after_hours: offHours, auto_clear_possible: offHours && settings.autoClear && rules.length > 0,
      tonight_price: settings.quotePrices && rule ? { product: rule.product, size: rule.size, pack: rule.pack, price: Number(rule.minPrice), cases_left: rule.caseLimit - rule.casesCleared, say: `Tonight's price on ${[rule.size, rule.product].filter(Boolean).join(" ")} is ${fmtMoney(Number(rule.minPrice))} a case.` } : null,
      products_on_sheet: Array.from(new Set(rules.map((r) => r.product))),
    });
  }

  // try_clear: build the line, create the request now, apply the rules atomically.
  const product = b.product ? normalizeProduct(b.product) : null;
  const ctx = { name: customer.name, timezone: customer.timezone, now };
  const extractedLine = resolveLine({ product: b.product ?? "", size: b.size ? normalizeSize(b.size) ?? b.size : null, pack: b.pack ? normalizePack(b.pack) ?? b.pack : null, cases: b.cases ?? null, priceOffered: b.price ?? null, pickup: b.pickup ?? null, fulfillment: b.fulfillment ?? "collect", destination: null, poNumber: null }, ctx);
  const extracted: ExtractedRequest & { resolvedLines: typeof extractedLine[] } = {
    type: "new_order", callerName: b.buyer_name ?? null, callerCompany: b.company ?? null, callerCity: b.city ?? null,
    callbackNumber: b.callback_number ?? b.caller_id ?? null, callbackPermission: b.callback_permission ?? null, preferredChannel: "call",
    lines: [extractedLine], language: "en", flags: [], summary: `${b.buyer_name ?? "Buyer"} wants ${b.cases ?? "?"} cs ${b.size ?? ""} ${product ?? b.product} at ${b.price != null ? fmtMoney(b.price) : "?"}`,
    complaint: null, resolvedLines: [extractedLine],
  };
  const created = await createRequest(db, { customerId: customer.id, channel: "call", now, extracted, providerConversationId: b.conversation_id ?? undefined });
  if (created.merged) return json({ cleared: false, ref: created.request.ref, say: "This buyer already has an open request with the team." });
  const decision = await tryAutoClear(db, { requestId: created.request.id, customerId: customer.id, lines: [extractedLine], now, offHours, settings });
  if (!decision.clear) return json({ cleared: false, ref: created.request.ref, reason: decision.reason, say: "I'll pass this to the team and they'll get back to you." });
  await confirmDeal(db, { requestId: created.request.id, now, source: "auto" });
  const l = decision.lines[0];
  return json({ cleared: true, ref: created.request.ref, price: l.price, cases: l.cases,
    say: `${l.cases} cases ${[extractedLine.size, extractedLine.productCanonical ?? extractedLine.product, extractedLine.pack].filter(Boolean).join(" ")}, pickup ${extractedLine.pickup ?? "as discussed"} at ${fmtMoney(l.price)}. You're confirmed, reference ${created.request.ref}.` });
}

import { sql } from "drizzle-orm";
const sqlPhone = (phone: string) => sql`${schema.buyers.phones} @> ${JSON.stringify([phone])}::jsonb`;
