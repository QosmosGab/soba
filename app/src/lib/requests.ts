// Request service: turns an extraction into rows, allocates the human reference
// number, matches the buyer by phone, merges repeat contacts, and applies
// auto-clear atomically against the rule's remaining cases.
import { and, desc, eq, gt, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import type { ExtractedRequest, ResolvedLine } from "./extract";
import { decideAutoClear, type LiveRule, type AutoClearResult } from "./autoclear";

export const FIRST_REF = 1001;
export const REPEAT_WINDOW_MS = 3 * 60 * 60 * 1000;

export const digits = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "").replace(/^1(\d{10})$/, "$1");
export const toE164 = (s: string | null | undefined) => { const d = digits(s); return d.length === 10 ? `+1${d}` : d ? `+${d}` : null; };

async function nextRef(db: Db, customerId: string): Promise<number> {
  const [row] = await db.select({ max: sql<number>`coalesce(max(${schema.requests.ref}), ${FIRST_REF - 1})` })
    .from(schema.requests).where(eq(schema.requests.customerId, customerId));
  return Number(row.max) + 1;
}

export async function findOrCreateBuyer(db: Db, customerId: string, x: Pick<ExtractedRequest, "callerName" | "callerCompany" | "callerCity" | "callbackNumber">) {
  const phone = toE164(x.callbackNumber);
  if (phone) {
    const existing = await db.select().from(schema.buyers)
      .where(and(eq(schema.buyers.customerId, customerId), sql`${schema.buyers.phones} @> ${JSON.stringify([phone])}::jsonb`)).limit(1);
    if (existing[0]) {
      const patch: Partial<typeof schema.buyers.$inferInsert> = {};
      if (!existing[0].company && x.callerCompany) patch.company = x.callerCompany;
      if (!existing[0].contactName && x.callerName) patch.contactName = x.callerName;
      if (!existing[0].city && x.callerCity) patch.city = x.callerCity;
      if (Object.keys(patch).length) await db.update(schema.buyers).set(patch).where(eq(schema.buyers.id, existing[0].id));
      return { buyer: existing[0], isNew: false };
    }
  }
  const [buyer] = await db.insert(schema.buyers).values({
    customerId, company: x.callerCompany, city: x.callerCity, contactName: x.callerName, phones: phone ? [phone] : [],
  }).returning();
  return { buyer, isNew: true };
}

/** An open request from the same number in the last few hours means this is the same buyer again. */
export async function findRecentOpenRequest(db: Db, customerId: string, callbackNumber: string | null, now: Date) {
  const phone = toE164(callbackNumber);
  if (!phone) return null;
  const rows = await db.select().from(schema.requests).where(and(
    eq(schema.requests.customerId, customerId),
    eq(schema.requests.callbackNumber, phone),
    eq(schema.requests.status, "in_progress"),
    gt(schema.requests.receivedAt, new Date(now.getTime() - REPEAT_WINDOW_MS)),
  )).orderBy(desc(schema.requests.receivedAt)).limit(1);
  return rows[0] ?? null;
}

export type CreateRequestInput = {
  customerId: string; channel: "call" | "text"; now: Date;
  extracted: ExtractedRequest & { resolvedLines: ResolvedLine[] };
  providerConversationId?: string; transcriptUrl?: string;
};

export async function createRequest(db: Db, input: CreateRequestInput) {
  const { customerId, channel, now, extracted: x } = input;
  const phone = toE164(x.callbackNumber);

  const repeat = await findRecentOpenRequest(db, customerId, x.callbackNumber, now);
  if (repeat) {
    const flags = Array.from(new Set([...repeat.flags, "repeat_caller"]));
    await db.update(schema.requests).set({ flags }).where(eq(schema.requests.id, repeat.id));
    await db.insert(schema.events).values({ customerId, requestId: repeat.id, type: "request.repeat_contact", payload: { channel, at: now.toISOString(), summary: x.summary } });
    return { request: { ...repeat, flags }, merged: true as const, autoClear: null };
  }

  const { buyer, isNew } = await findOrCreateBuyer(db, customerId, x);
  const ref = await nextRef(db, customerId);
  const flags: string[] = [...x.flags];
  if (isNew) flags.push("new_buyer");
  if (x.resolvedLines.some((l) => !l.productCanonical)) flags.push("not_on_sheet");

  const [request] = await db.insert(schema.requests).values({
    customerId, ref, channel, buyerId: buyer.id, receivedAt: now, type: x.type, flags,
    callerName: x.callerName, callerCompany: x.callerCompany, callbackNumber: phone,
    callbackPermission: x.callbackPermission, summary: x.summary,
    providerConversationId: input.providerConversationId, transcriptUrl: input.transcriptUrl,
  }).returning();

  if (x.resolvedLines.length) {
    await db.insert(schema.orderLines).values(x.resolvedLines.map((l) => ({
      requestId: request.id, product: l.productCanonical ?? l.product, size: l.size, pack: l.pack, cases: l.cases,
      priceOffered: l.priceOffered != null ? l.priceOffered.toFixed(2) : null, pickupDate: l.pickupDate,
      fulfillment: l.fulfillment, destination: l.destination, poNumber: l.poNumber, notOnSheet: !l.productCanonical,
    })));
  }
  await db.insert(schema.events).values({ customerId, requestId: request.id, type: "request.created", payload: { channel, type: x.type, flags, language: x.language } });
  return { request, merged: false as const, buyer, isNew };
}

export async function liveRules(db: Db, customerId: string, now: Date): Promise<LiveRule[]> {
  const rows = await db.select().from(schema.priceRules).where(and(eq(schema.priceRules.customerId, customerId), gt(schema.priceRules.expiresAt, now)));
  return rows.map((r) => ({ id: r.id, product: r.product, size: r.size, pack: r.pack, minPrice: Number(r.minPrice), caseLimit: r.caseLimit, casesCleared: r.casesCleared, on: r.on, expiresAt: r.expiresAt }));
}

/**
 * Decide and, if it clears, apply: bump each rule's sold count with a guarded UPDATE so two
 * buyers at once can't oversell, then mark the request auto-cleared with final prices.
 * Returns the decision; a lost race comes back as condition 4.
 */
export async function tryAutoClear(db: Db, args: {
  requestId: string; customerId: string; lines: ResolvedLine[]; now: Date; offHours: boolean;
  settings: { autoClear: boolean; implausiblePricePct: number };
}): Promise<AutoClearResult> {
  const rules = await liveRules(db, args.customerId, args.now);
  const decision = decideAutoClear({ lines: args.lines, rules, settings: args.settings, offHours: args.offHours, now: args.now });
  if (!decision.clear) {
    await db.insert(schema.events).values({ customerId: args.customerId, requestId: args.requestId, type: "autoclear.declined", payload: { reason: decision.reason, condition: decision.condition } });
    return decision;
  }
  // Guarded increments: fail if another clear got there first.
  for (const l of decision.lines) {
    const updated = await db.update(schema.priceRules)
      .set({ casesCleared: sql`${schema.priceRules.casesCleared} + ${l.cases}` })
      .where(and(eq(schema.priceRules.id, l.rule.id), sql`${schema.priceRules.casesCleared} + ${l.cases} <= ${schema.priceRules.caseLimit}`))
      .returning({ id: schema.priceRules.id });
    if (!updated.length) {
      const lost = { clear: false as const, reason: "cases taken by another order moments ago", condition: 4 as const };
      await db.insert(schema.events).values({ customerId: args.customerId, requestId: args.requestId, type: "autoclear.declined", payload: lost });
      return lost;
    }
  }
  const dbLines = await db.select().from(schema.orderLines).where(eq(schema.orderLines.requestId, args.requestId));
  for (const dl of dbLines) {
    const match = decision.lines.find((l) => l.rule.product.toLowerCase() === dl.product.toLowerCase() && (!l.rule.size || l.rule.size === dl.size));
    if (match) await db.update(schema.orderLines).set({ finalPrice: match.price.toFixed(2) }).where(eq(schema.orderLines.id, dl.id));
  }
  await db.update(schema.requests).set({ status: "auto_cleared" }).where(eq(schema.requests.id, args.requestId));
  await db.insert(schema.events).values({ customerId: args.customerId, requestId: args.requestId, type: "autoclear.cleared", payload: { lines: decision.lines.map((l) => ({ rule: l.rule.id, cases: l.cases, price: l.price })) } });
  return decision;
}
