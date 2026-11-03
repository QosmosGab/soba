// What happens after a decision stands: the callback to the buyer, the written
// confirmation, the order card to the rep, and the outcomes that come back
// from the callback (confirmed, declined, changed, no answer, bought elsewhere).
// The buyer only ever hears numbers a rep or a price rule approved.
import { and, desc, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { fmtMoney, orderCard } from "./card";
import { loadCustomer, cardRecipients, dispatchCard, notifyOtherRecipients } from "./cards";
import { sendToBuyer, sendToRep } from "./messaging";
import { placeCallback } from "./providers/elevenlabs";
import { buyerText, fillConfirmation, langOf, pickupWord, saysNo, saysYes, type Lang } from "./buyer-text";
import { env } from "./env";
import { inngestSend } from "@/inngest/send";

type Request = typeof schema.requests.$inferSelect;
type Line = typeof schema.orderLines.$inferSelect;
type Decision = typeof schema.decisions.$inferSelect;

const lineDesc = (l: Line) => [l.size, l.product, l.pack].filter(Boolean).join(" ");
/** One line: "4x4 Vine-ripe tomatoes 25 lb". Several: each with its cases and price, since the price variable then stays blank. */
const orderDesc = (lines: Line[]) => lines.length === 1 ? lineDesc(lines[0])
  : lines.map((l) => `${l.cases ?? ""} cs ${lineDesc(l)}${l.finalPrice ?? l.priceOffered ? ` at ${fmtMoney(Number(l.finalPrice ?? l.priceOffered))}` : ""}`.trim()).join(", ");

/** The offer a callback carries: the rep's counter, or the buyer's own ask (approve), capped by a partial quantity. */
export function offerFor(decision: Decision, line: Line) {
  const price = decision.counterPrice != null ? Number(decision.counterPrice) : line.priceOffered != null ? Number(line.priceOffered) : null;
  const cases = decision.quantity != null && line.cases != null ? Math.min(decision.quantity, line.cases) : decision.quantity ?? line.cases;
  return { price, cases };
}

async function repOf(db: Db, memberId: string | null) {
  if (!memberId) return null;
  const [m] = await db.select().from(schema.teamMembers).where(eq(schema.teamMembers.id, memberId));
  return m ?? null;
}

/**
 * A deal is done: final prices on the lines, status set, the buyer gets the written
 * confirmation, the reps get the order card. Used by auto-clear, approvals, accepted
 * counters and text-channel approvals alike. `price` and `cases` apply to single-line orders.
 */
export async function confirmDeal(db: Db, args: {
  requestId: string; now: Date; source: "auto" | "approve" | "counter" | "text";
  byMemberId?: string | null; price?: number | null; cases?: number | null;
}) {
  const [request] = await db.select().from(schema.requests).where(eq(schema.requests.id, args.requestId));
  if (!request) throw new Error("request not found");
  const [prior] = await db.select({ id: schema.events.id }).from(schema.events).where(and(eq(schema.events.requestId, request.id), eq(schema.events.type, "deal.confirmed"))).limit(1);
  if (prior) return { status: request.status, already: true as const };
  const { customer, settings } = await loadCustomer(db, request.customerId);
  const lines = await db.select().from(schema.orderLines).where(eq(schema.orderLines.requestId, request.id));
  const buyer = request.buyerId ? (await db.select().from(schema.buyers).where(eq(schema.buyers.id, request.buyerId)))[0] : null;
  const lang = langOf(request.language);

  const single = lines.length === 1;
  for (const l of lines) {
    const price = (single ? args.price : null) ?? (l.finalPrice != null ? Number(l.finalPrice) : l.priceOffered != null ? Number(l.priceOffered) : null);
    const cases = (single ? args.cases : null) ?? l.cases;
    await db.update(schema.orderLines).set({ finalPrice: price != null ? price.toFixed(2) : null, cases }).where(eq(schema.orderLines.id, l.id));
  }
  const status = args.source === "auto" ? "auto_cleared" : "approved";
  await db.update(schema.requests).set({ status, decidedById: args.byMemberId ?? null }).where(eq(schema.requests.id, request.id));
  await db.insert(schema.events).values({ customerId: request.customerId, requestId: request.id, type: "deal.confirmed", payload: { source: args.source, by: args.byMemberId ?? null, price: args.price ?? null, cases: args.cases ?? null } });

  const fresh = await db.select().from(schema.orderLines).where(eq(schema.orderLines.requestId, request.id));
  const first = fresh[0];
  // Written confirmation to the buyer, by text, in their language.
  if (request.callbackNumber && request.callbackPermission !== false && first && !buyer?.doNotContact) {
    const body = fillConfirmation(lang === "es" ? settings.confirmationTemplateEs : settings.confirmationTemplate, {
      company: customer.name, cases: single ? first.cases : null, product: orderDesc(fresh),
      price: single && first.finalPrice != null ? Number(first.finalPrice) : null, pickup: pickupWord(first.pickupDate, lang), ref: request.ref,
    }, lang);
    await sendToBuyer(db, { customerId: request.customerId, requestId: request.id, to: request.callbackNumber, body, now: args.now });
  }
  // Order card to the deciding rep (everyone scheduled, for auto-clears), plus order clerks.
  const members = await db.select().from(schema.teamMembers).where(and(eq(schema.teamMembers.customerId, request.customerId), eq(schema.teamMembers.active, true)));
  const scheduled = args.byMemberId ? members.filter((m) => m.id === args.byMemberId) : await cardRecipients(db, request.customerId, args.now);
  const targets = new Map<string, typeof members[number]>();
  for (const m of [...scheduled, ...members.filter((m) => m.isOrderClerk)]) targets.set(m.id, m);
  const rules = args.source === "auto" ? await db.select().from(schema.priceRules).where(eq(schema.priceRules.customerId, request.customerId)) : [];
  for (const l of fresh) {
    const rule = rules.find((r) => r.product.toLowerCase() === l.product.toLowerCase() && (!r.size || r.size === l.size));
    const text = orderCard({
      ref: request.ref, customer: buyer?.company ?? request.callerCompany ?? "Unknown buyer", city: buyer?.city ?? null, poNumber: l.poNumber,
      product: l.product, size: l.size, pack: l.pack, cases: l.cases ?? 0, price: l.finalPrice != null ? Number(l.finalPrice) : 0,
      terms: l.fulfillment === "delivered" ? `delivered${l.destination ? ` ${l.destination}` : ""}` : "FOB", pickupDate: l.pickupDate, fulfillment: l.fulfillment,
      contactName: request.callerName ?? buyer?.contactName ?? null, contactNumber: request.callbackNumber,
      rule: rule ? { cleared: rule.casesCleared, limit: rule.caseLimit } : undefined,
    });
    for (const m of targets.values()) await sendToRep(db, m, { customerId: request.customerId, requestId: request.id, body: text, template: { kind: "notice" }, now: args.now });
  }
  return { status, already: false as const };
}

/** Variables the callback agent reads from; the script says only what is in here. */
function callbackVariables(c: { customer: string; request: Request; lines: Line[]; price: number | null; cases: number | null; intent: "confirm" | "counter"; repName: string | null; lang: Lang }) {
  const first = c.lines[0];
  return {
    company_name: c.customer, buyer_name: c.request.callerName ?? "", buyer_company: c.request.callerCompany ?? "",
    ref: String(c.request.ref), intent: c.intent, product: orderDesc(c.lines), cases: c.cases != null ? String(c.cases) : "",
    price: c.lines.length === 1 && c.price != null ? c.price.toFixed(2) : "", pickup: pickupWord(first?.pickupDate ?? null, c.lang), reason: "", rep_name: c.repName ?? "the team",
    original_cases: first?.cases != null ? String(first.cases) : "", original_price: first?.priceOffered != null ? Number(first.priceOffered).toFixed(2) : "",
    language: c.lang, request_id: c.request.id,
  };
}

/**
 * Runs once the undo window has passed. Approve and counter reach the buyer on the channel
 * they used; reject tells them by text, with the rep's reason if any.
 */
export async function executeDecision(db: Db, decisionId: string, now: Date) {
  const [decision] = await db.select().from(schema.decisions).where(eq(schema.decisions.id, decisionId));
  if (!decision || decision.undone) return { skipped: "undone" as const };
  const [request] = await db.select().from(schema.requests).where(eq(schema.requests.id, decision.requestId));
  if (!request || request.status !== "in_progress") return { skipped: "closed" as const };
  const already = await db.select().from(schema.callbacks).where(eq(schema.callbacks.decisionId, decision.id));
  if (already.length) return { skipped: "already_executed" as const };
  const { customer, settings } = await loadCustomer(db, request.customerId);
  const lines = await db.select().from(schema.orderLines).where(eq(schema.orderLines.requestId, request.id));
  const line = lines[0];
  const rep = await repOf(db, decision.memberId);
  const lang = langOf(request.language);

  if (decision.action === "reject") {
    await db.update(schema.requests).set({ status: "rejected", decidedById: decision.memberId }).where(eq(schema.requests.id, request.id));
    await db.insert(schema.events).values({ customerId: request.customerId, requestId: request.id, type: "request.rejected", payload: { by: decision.memberId, reason: decision.reason } });
    if (request.callbackNumber && request.callbackPermission !== false) {
      await sendToBuyer(db, { customerId: request.customerId, requestId: request.id, to: request.callbackNumber, body: buyerText.cannotFill(customer.name, request.ref, decision.reason, lang), now });
    }
    return { done: "rejected" as const };
  }
  if (!line || !request.callbackNumber || request.callbackPermission === false) return { skipped: "unreachable" as const };

  const { price, cases } = offerFor(decision, line);
  const [cb] = await db.insert(schema.callbacks).values({
    requestId: request.id, channel: request.channel === "call" ? "voice" : "sms", decisionId: decision.id,
    offerCases: cases, offerPrice: price != null ? price.toFixed(2) : null,
  }).returning();

  // Approve on a text request: the buyer's own ask is accepted, so the confirmation is the callback.
  if (request.channel === "text" && decision.action === "approve") {
    await db.update(schema.callbacks).set({ outcome: "confirmed", attempts: 1, lastAttemptAt: now, buyerYesAt: request.receivedAt }).where(eq(schema.callbacks.id, cb.id));
    await confirmDeal(db, { requestId: request.id, now, source: "approve", byMemberId: decision.memberId, price, cases });
    return { done: "confirmed_by_text" as const };
  }
  if (request.channel === "text") {
    const body = buyerText.offer({ company: customer.name, cases, product: orderDesc(lines), price, pickup: pickupWord(line.pickupDate, lang), ref: request.ref }, lang);
    await sendToBuyer(db, { customerId: request.customerId, requestId: request.id, to: request.callbackNumber, body, now });
    await db.update(schema.callbacks).set({ attempts: 1, lastAttemptAt: now }).where(eq(schema.callbacks.id, cb.id));
    return { done: "counter_texted" as const };
  }
  return placeBuyerCall(db, { request, lines, callbackId: cb.id, price, cases, intent: decision.action === "counter" ? "counter" : "confirm", repName: rep?.name ?? null, now, customer: customer.name, textFirst: settings.textFirstBeforeCall, lang });
}

async function placeBuyerCall(db: Db, a: { request: Request; lines: Line[]; callbackId: string; price: number | null; cases: number | null; intent: "confirm" | "counter"; repName: string | null; now: Date; customer: string; textFirst: boolean; lang: Lang }) {
  const { request } = a;
  const [voice] = await db.select().from(schema.lines).where(and(eq(schema.lines.customerId, request.customerId), eq(schema.lines.kind, "voice")));
  if (a.textFirst) await sendToBuyer(db, { customerId: request.customerId, requestId: request.id, to: request.callbackNumber!, body: buyerText.callingBack(a.customer, request.ref, a.lang), now: a.now });
  const variables = callbackVariables({ customer: a.customer, request, lines: a.lines, price: a.price, cases: a.cases, intent: a.intent, repName: a.repName, lang: a.lang });
  const call = await placeCallback({ agentId: env.dryRun ? "dry" : env.eleven.callbackAgentId, agentPhoneNumberId: voice?.elevenPhoneNumberId ?? (env.dryRun ? "dry" : ""), to: request.callbackNumber!, variables });
  await db.update(schema.callbacks).set({ lastAttemptAt: a.now, providerConversationId: call.conversationId }).where(eq(schema.callbacks.id, a.callbackId));
  await db.insert(schema.messages).values({ customerId: request.customerId, requestId: request.id, direction: "out", party: "desk", channel: "voice", body: `Callback (${a.intent}): ${variables.cases} cs ${variables.product} at $${variables.price}`, providerId: call.conversationId, sentAt: a.now });
  await db.insert(schema.events).values({ customerId: request.customerId, requestId: request.id, type: "callback.placed", payload: { callbackId: a.callbackId, intent: a.intent, conversationId: call.conversationId } });
  return { done: "called" as const, conversationId: call.conversationId };
}

export type CallbackOutcome = { outcome: "confirmed" | "declined" | "changed" | "no_answer" | "bought_elsewhere"; notes?: string | null; changeDetails?: string | null; competitor?: string | null; competitorPrice?: string | null; transcript?: string | null };

/** The callback agent's post-call result, matched to the callback by conversation id. A repeated webhook is ignored. */
export async function handleCallbackOutcome(db: Db, conversationId: string, o: CallbackOutcome, now: Date) {
  const [cb] = await db.select().from(schema.callbacks).where(eq(schema.callbacks.providerConversationId, conversationId));
  if (!cb) return { ignored: "unknown callback" as const };
  const [request] = await db.select().from(schema.requests).where(eq(schema.requests.id, cb.requestId));
  const fresh = await db.insert(schema.messages).values({ customerId: request.customerId, requestId: request.id, direction: "in", party: "buyer", channel: "voice", body: o.transcript ?? o.notes ?? null, providerId: `${conversationId}:in`, sentAt: now }).onConflictDoNothing().returning({ id: schema.messages.id });
  if (!fresh.length || cb.outcome !== "pending") return { ignored: "already settled" as const };
  const decision = cb.decisionId ? (await db.select().from(schema.decisions).where(eq(schema.decisions.id, cb.decisionId)))[0] : null;
  const { customer, settings } = await loadCustomer(db, request.customerId);
  const lang = langOf(request.language);
  const first = request.callerName?.split(" ")[0] ?? "The buyer";
  const repNotify = async (text: string) => {
    const m = await repOf(db, decision?.memberId ?? null);
    if (m) await sendToRep(db, m, { customerId: request.customerId, requestId: request.id, body: text, template: { kind: "notice" }, now });
  };
  const event = (type: string, payload: Record<string, unknown>) => db.insert(schema.events).values({ customerId: request.customerId, requestId: request.id, type, payload });

  switch (o.outcome) {
    case "confirmed": {
      await db.update(schema.callbacks).set({ outcome: "confirmed", buyerYesAt: now, notes: o.notes ?? null }).where(eq(schema.callbacks.id, cb.id));
      await confirmDeal(db, { requestId: request.id, now, source: decision?.action === "counter" ? "counter" : "approve", byMemberId: decision?.memberId ?? null, price: cb.offerPrice != null ? Number(cb.offerPrice) : null, cases: cb.offerCases });
      return { done: "confirmed" as const };
    }
    case "declined": {
      await db.update(schema.callbacks).set({ outcome: "declined", notes: o.notes ?? null }).where(eq(schema.callbacks.id, cb.id));
      await db.update(schema.requests).set({ status: "rejected" }).where(eq(schema.requests.id, request.id));
      await event("callback.declined", { notes: o.notes ?? null });
      await repNotify(`${first} declined ${cb.offerPrice != null ? fmtMoney(Number(cb.offerPrice)) : "the offer"} on ref ${request.ref}. Reply TAKE to take it over.`);
      return { done: "declined" as const };
    }
    case "bought_elsewhere": {
      await db.update(schema.callbacks).set({ outcome: "declined", notes: [o.competitor, o.competitorPrice].filter(Boolean).join(" at ") || o.notes || null }).where(eq(schema.callbacks.id, cb.id));
      await db.update(schema.requests).set({ status: "rejected", takeOverOutcome: "lost" }).where(eq(schema.requests.id, request.id));
      await event("callback.bought_elsewhere", { competitor: o.competitor ?? null, price: o.competitorPrice ?? null });
      await repNotify(`${first} bought elsewhere${o.competitor ? ` (${o.competitor}${o.competitorPrice ? ` at ${o.competitorPrice}` : ""})` : ""}. Ref ${request.ref} closed.`);
      return { done: "lost" as const };
    }
    case "changed": {
      // Back to the reps as a fresh card on the same reference, flagged with what changed.
      await db.update(schema.callbacks).set({ outcome: "changed", notes: o.changeDetails ?? o.notes ?? null }).where(eq(schema.callbacks.id, cb.id));
      const flags = Array.from(new Set([...request.flags.filter((f) => f !== "repeat_caller"), "changed"]));
      await db.update(schema.requests).set({ claimedById: null, claimedAt: null, decidedById: null, flags, summary: `Buyer changed the order on callback: ${o.changeDetails ?? "see notes"}` }).where(eq(schema.requests.id, request.id));
      await event("callback.changed", { details: o.changeDetails ?? null });
      await dispatchCard(db, request.id, now);
      return { done: "changed" as const };
    }
    case "no_answer": {
      if (cb.attempts < 1) {
        await db.update(schema.callbacks).set({ attempts: 1, lastAttemptAt: now }).where(eq(schema.callbacks.id, cb.id));
        await inngestSend({ name: "soba/callback.retry", data: { callbackId: cb.id, requestId: request.id, customerId: request.customerId } });
        return { done: "retry_scheduled" as const };
      }
      await db.update(schema.callbacks).set({ outcome: "no_answer" }).where(eq(schema.callbacks.id, cb.id));
      if (settings.noAnswerAction !== "none" && request.callbackNumber) {
        const lines = await db.select().from(schema.orderLines).where(eq(schema.orderLines.requestId, request.id));
        const body = buyerText.missedYou({ company: customer.name, cases: cb.offerCases, product: orderDesc(lines), price: cb.offerPrice != null ? Number(cb.offerPrice) : null, pickup: pickupWord(lines[0]?.pickupDate ?? null, lang), ref: request.ref }, lang);
        await sendToBuyer(db, { customerId: request.customerId, requestId: request.id, to: request.callbackNumber, body, channel: settings.noAnswerAction === "whatsapp" ? "whatsapp" : "sms", now });
        // The text is now the live offer; a YES settles it.
        await db.update(schema.callbacks).set({ outcome: "pending", channel: "sms", attempts: 2, lastAttemptAt: now }).where(eq(schema.callbacks.id, cb.id));
      }
      await event("callback.no_answer", { attempts: cb.attempts + 1 });
      return { done: "no_answer" as const };
    }
  }
}

/** Second attempt after no answer. */
export async function retryCallback(db: Db, callbackId: string, now: Date) {
  const [cb] = await db.select().from(schema.callbacks).where(eq(schema.callbacks.id, callbackId));
  if (!cb || cb.outcome !== "pending" || cb.attempts !== 1) return { skipped: true };
  const [request] = await db.select().from(schema.requests).where(eq(schema.requests.id, cb.requestId));
  if (!request || request.status !== "in_progress" || !request.callbackNumber) return { skipped: true };
  const decision = cb.decisionId ? (await db.select().from(schema.decisions).where(eq(schema.decisions.id, cb.decisionId)))[0] : null;
  const lines = await db.select().from(schema.orderLines).where(eq(schema.orderLines.requestId, request.id));
  const { customer, settings } = await loadCustomer(db, request.customerId);
  const rep = await repOf(db, decision?.memberId ?? null);
  await db.update(schema.callbacks).set({ attempts: 2 }).where(eq(schema.callbacks.id, cb.id));
  return placeBuyerCall(db, { request, lines, callbackId: cb.id, price: cb.offerPrice != null ? Number(cb.offerPrice) : null, cases: cb.offerCases, intent: decision?.action === "counter" ? "counter" : "confirm", repName: rep?.name ?? null, now, customer: customer.name, textFirst: settings.textFirstBeforeCall, lang: langOf(request.language) });
}

/** A buyer's YES / NO text after a counter or no-answer offer. */
export async function handleBuyerOfferReply(db: Db, requestId: string, text: string, now: Date): Promise<"confirmed" | "declined" | "other"> {
  const [cb] = await db.select().from(schema.callbacks).where(and(eq(schema.callbacks.requestId, requestId), eq(schema.callbacks.outcome, "pending"))).orderBy(desc(schema.callbacks.lastAttemptAt)).limit(1);
  if (!cb) return "other";
  const decision = cb.decisionId ? (await db.select().from(schema.decisions).where(eq(schema.decisions.id, cb.decisionId)))[0] : null;
  if (saysYes(text)) {
    await db.update(schema.callbacks).set({ outcome: "confirmed", buyerYesAt: now }).where(eq(schema.callbacks.id, cb.id));
    await confirmDeal(db, { requestId, now, source: decision?.action === "counter" ? "counter" : "approve", byMemberId: decision?.memberId ?? null, price: cb.offerPrice != null ? Number(cb.offerPrice) : null, cases: cb.offerCases });
    return "confirmed";
  }
  if (saysNo(text)) {
    const [request] = await db.select().from(schema.requests).where(eq(schema.requests.id, requestId));
    await db.update(schema.callbacks).set({ outcome: "declined", notes: text }).where(eq(schema.callbacks.id, cb.id));
    await db.update(schema.requests).set({ status: "rejected" }).where(eq(schema.requests.id, requestId));
    await db.insert(schema.events).values({ customerId: request.customerId, requestId, type: "callback.declined", payload: { notes: text } });
    const m = await repOf(db, decision?.memberId ?? null);
    if (m) {
      await sendToRep(db, m, { customerId: request.customerId, requestId, body: `${request.callerName ?? "The buyer"} declined ${cb.offerPrice != null ? fmtMoney(Number(cb.offerPrice)) : "the offer"} on ref ${request.ref}. Reply TAKE to take it over.`, template: { kind: "notice" }, now });
      await notifyOtherRecipients(db, requestId, m.id, "buyer declined", now);
    }
    return "declined";
  }
  return "other";
}
