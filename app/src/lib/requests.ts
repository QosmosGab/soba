// Request service: turns an extraction into rows, allocates the human reference
// number, matches the buyer by phone, merges repeat contacts, and applies
// auto-clear atomically against the rule's remaining cases.
import { and, desc, eq, gt, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import type { ExtractedRequest, ResolvedLine } from "./extract";
import { decideAutoClear, ruleMatches, type LiveRule, type AutoClearResult } from "./autoclear";

export const FIRST_REF = 1001;
export const REPEAT_WINDOW_MS = 3 * 60 * 60 * 1000;

export type Extracted = ExtractedRequest & { resolvedLines: ResolvedLine[] };

/** Digits only; a leading US country code is dropped so 1-312… and 312… match. */
export const digits = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "").replace(/^011(\d{10,})$/, "$1").replace(/^1(\d{10})$/, "$1");
/** E.164 for US/Canada (10 digits) and anything longer with its own country code; shorter is not a phone number. */
export const toE164 = (s: string | null | undefined): string | null => {
  const d = digits(s);
  if (d.length === 10) return `+1${d}`;
  if (d.length >= 11 && d.length <= 15) return `+${d}`;
  return null;
};

/** Next reference for a customer. The unique index catches a race; the caller retries. */
async function nextRef(db: Db, customerId: string): Promise<number> {
  const [row] = await db.select({ max: sql<number>`coalesce(max(${schema.requests.ref}), ${FIRST_REF - 1})` })
    .from(schema.requests).where(eq(schema.requests.customerId, customerId));
  return Number(row.max) + 1;
}

const isUniqueViolation = (err: unknown) => /unique|duplicate key/i.test(String((err as { message?: string })?.message ?? err));

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

/** The request already created for this provider conversation (mid-call booking), if any. */
export async function findByConversation(db: Db, customerId: string, providerConversationId: string | null | undefined) {
  if (!providerConversationId) return null;
  const [r] = await db.select().from(schema.requests).where(and(eq(schema.requests.customerId, customerId), eq(schema.requests.providerConversationId, providerConversationId)));
  return r ?? null;
}

/** Flags the card needs beyond what the extractor set. */
export function derivedFlags(x: Extracted, isNewBuyer: boolean, isTest = false): string[] {
  const flags = new Set<string>(x.flags);
  if (isNewBuyer) flags.add("new_buyer");
  if (isTest) flags.add("test");
  if (x.resolvedLines.some((l) => !l.productCanonical)) flags.add("not_on_sheet");
  if (!toE164(x.callbackNumber) || x.callbackPermission === false) flags.add("no_callback");
  return Array.from(flags);
}

export type CreateRequestInput = {
  customerId: string; channel: "call" | "text"; now: Date; extracted: Extracted;
  providerConversationId?: string; transcriptUrl?: string; isTest?: boolean;
};

export async function createRequest(db: Db, input: CreateRequestInput) {
  const { customerId, channel, now, extracted: x } = input;
  const phone = toE164(x.callbackNumber);

  const repeat = await findRecentOpenRequest(db, customerId, x.callbackNumber, now);
  if (repeat) {
    const flags = Array.from(new Set([...repeat.flags, "repeat_caller"]));
    const acted = await db.select({ id: schema.decisions.id }).from(schema.decisions).where(and(eq(schema.decisions.requestId, repeat.id), eq(schema.decisions.undone, false))).limit(1);
    // Nobody has acted yet: the newest version of the order is the one on the card.
    if (!acted.length && x.type === "new_order" && x.resolvedLines.length) await replaceLines(db, repeat.id, x.resolvedLines);
    await db.update(schema.requests).set({ flags, callbackPermission: x.callbackPermission ?? repeat.callbackPermission }).where(eq(schema.requests.id, repeat.id));
    await db.insert(schema.events).values({ customerId, requestId: repeat.id, type: "request.repeat_contact", payload: { channel, at: now.toISOString(), summary: x.summary } });
    return { request: { ...repeat, flags }, merged: true as const };
  }

  const { buyer, isNew } = await findOrCreateBuyer(db, customerId, x);
  const flags = derivedFlags(x, isNew, input.isTest);
  let request: typeof schema.requests.$inferSelect | undefined;
  for (let attempt = 0; attempt < 3 && !request; attempt++) {
    const ref = await nextRef(db, customerId);
    try {
      [request] = await db.insert(schema.requests).values({
        customerId, ref, channel, buyerId: buyer.id, receivedAt: now, type: x.type, flags, language: x.language,
        callerName: x.callerName, callerCompany: x.callerCompany, callbackNumber: phone,
        callbackPermission: x.callbackPermission, summary: x.summary, isTest: input.isTest ?? false,
        providerConversationId: input.providerConversationId, transcriptUrl: input.transcriptUrl,
      }).returning();
    } catch (err) {
      if (!isUniqueViolation(err) || attempt === 2) throw err;
    }
  }
  if (!request) throw new Error("could not allocate a reference number");
  if (!request.transcriptUrl) await db.update(schema.requests).set({ transcriptUrl: `${process.env.APP_URL ?? "http://localhost:3000"}/panel/requests/${request.id}` }).where(eq(schema.requests.id, request.id));
  await replaceLines(db, request.id, x.resolvedLines);
  await db.insert(schema.events).values({ customerId, requestId: request.id, type: "request.created", payload: { channel, type: x.type, flags, language: x.language } });
  return { request, merged: false as const, buyer, isNew };
}

/** Rewrites a request's order lines (used when the post-call transcript refines a mid-call booking attempt). */
export async function replaceLines(db: Db, requestId: string, lines: ResolvedLine[]) {
  await db.delete(schema.orderLines).where(eq(schema.orderLines.requestId, requestId));
  if (!lines.length) return;
  await db.insert(schema.orderLines).values(lines.map((l) => ({
    requestId, product: l.productCanonical ?? l.product, size: l.size, pack: l.pack, cases: l.cases,
    priceOffered: l.priceOffered != null ? l.priceOffered.toFixed(2) : null, pickupDate: l.pickupDate,
    fulfillment: l.fulfillment, destination: l.destination, poNumber: l.poNumber, notOnSheet: !l.productCanonical,
  })));
}

export async function liveRules(db: Db, customerId: string, now: Date): Promise<LiveRule[]> {
  const rows = await db.select().from(schema.priceRules).where(and(eq(schema.priceRules.customerId, customerId), gt(schema.priceRules.expiresAt, now)));
  return rows.map((r) => ({ id: r.id, product: r.product, size: r.size, pack: r.pack, minPrice: Number(r.minPrice), caseLimit: r.caseLimit, casesCleared: r.casesCleared, on: r.on, expiresAt: r.expiresAt }));
}

/**
 * Decide and, if it clears, apply: bump each rule's sold count with a guarded UPDATE so two
 * buyers at once can't oversell, then mark the request auto-cleared with final prices. All
 * increments happen in one transaction, so a lost race on the second line rolls back the first.
 */
export async function tryAutoClear(db: Db, args: {
  requestId: string; customerId: string; lines: ResolvedLine[]; now: Date; offHours: boolean;
  settings: { autoClear: boolean; implausiblePricePct: number };
}): Promise<AutoClearResult> {
  const rules = await liveRules(db, args.customerId, args.now);
  const decision = decideAutoClear({ lines: args.lines, rules, settings: args.settings, offHours: args.offHours, now: args.now });
  const declined = async (d: Extract<AutoClearResult, { clear: false }>) => {
    await db.insert(schema.events).values({ customerId: args.customerId, requestId: args.requestId, type: "autoclear.declined", payload: { reason: d.reason, condition: d.condition } });
    return d;
  };
  if (!decision.clear) return declined(decision);

  const lost = { clear: false as const, reason: "cases taken by another order moments ago", condition: 4 as const };
  const applied = await db.transaction(async (tx) => {
    for (const l of decision.lines) {
      const updated = await tx.update(schema.priceRules)
        .set({ casesCleared: sql`${schema.priceRules.casesCleared} + ${l.cases}` })
        .where(and(eq(schema.priceRules.id, l.rule.id), sql`${schema.priceRules.casesCleared} + ${l.cases} <= ${schema.priceRules.caseLimit}`))
        .returning({ id: schema.priceRules.id });
      if (!updated.length) { tx.rollback(); }
    }
    const dbLines = await tx.select().from(schema.orderLines).where(eq(schema.orderLines.requestId, args.requestId));
    for (const dl of dbLines) {
      const line: ResolvedLine = { product: dl.product, productCanonical: dl.notOnSheet ? null : dl.product, size: dl.size, pack: dl.pack, cases: dl.cases, priceOffered: null, pickup: null, pickupDate: null, fulfillment: null, destination: null, poNumber: null };
      const match = decision.lines.find((l) => ruleMatches(l.rule, line) && l.cases === dl.cases);
      if (match) await tx.update(schema.orderLines).set({ finalPrice: match.price.toFixed(2) }).where(eq(schema.orderLines.id, dl.id));
    }
    await tx.update(schema.requests).set({ status: "auto_cleared" }).where(eq(schema.requests.id, args.requestId));
    return true;
  }).catch((err: unknown) => { if (/rollback/i.test(String(err))) return false; throw err; });
  if (!applied) return declined(lost);
  await db.insert(schema.events).values({ customerId: args.customerId, requestId: args.requestId, type: "autoclear.cleared", payload: { lines: decision.lines.map((l) => ({ rule: l.rule.id, cases: l.cases, price: l.price })) } });
  return decision;
}
