// What happens after a decision stands: the callback to the buyer, the written
// confirmation, the order card to the rep, and the outcomes that come back
// from the callback (confirmed, declined, changed, no answer, bought elsewhere).
import { and, desc, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { fmtMoney, orderCard } from "./card";
import { loadCustomer, cardRecipients, dispatchCard, notifyOtherRecipients } from "./cards";
import { sendToBuyer, sendToRep } from "./messaging";
import { placeCallback } from "./providers/elevenlabs";
import { env } from "./env";
import { inngestSend } from "@/inngest/send";

type Request = typeof schema.requests.$inferSelect;
type Line = typeof schema.orderLines.$inferSelect;

const pickupWord = (iso: string | null) => iso ? new Date(iso + "T12:00:00Z").toLocaleString("en-US", { timeZone: "UTC", weekday: "short" }) : "to be set";
const lineDesc = (l: Line) => [l.size, l.product, l.pack].filter(Boolean).join(" ");

/** The offer a callback carries: the rep's counter, or the buyer's own ask (approve), capped by a partial quantity. */
export function offerFor(decision: typeof schema.decisions.$inferSelect, line: Line) {
  const price = decision.counterPrice != null ? Number(decision.counterPrice) : line.priceOffered != null ? Number(line.priceOffered) : null;
  const cases = decision.quantity != null && line.cases != null ? Math.min(decision.quantity, line.cases) : decision.quantity ?? line.cases;
  return { price, cases };
}

export function fillConfirmation(template: string, v: { company: string; cases: number | null; product: string; price: number | null; pickup: string; ref: number }) {
  return template
    .replace("{company}", v.company).replace("{cases}", v.cases != null ? String(v.cases) : "the")
    .replace("{product}", v.product).replace("${price}", v.price != null ? fmtMoney(v.price) : "the agreed price").replace("{price}", v.price != null ? fmtMoney(v.price) : "the agreed price")
    .replace("{pickup}", v.pickup).replace("{day}", v.pickup).replace("{ref}", String(v.ref));
}

/**
 * A deal is done: final prices on the lines, status set, the buyer gets the written
 * confirmation, the reps get the order card. Used by auto-clear, approvals, accepted
 * counters and text-channel approvals alike.
 */
export async function confirmDeal(db: Db, args: {
  requestId: string; now: Date; source: "auto" | "approve" | "counter" | "text";
  byMemberId?: string | null; price?: number | null; cases?: number | null;
}) {
  const [request] = await db.select().from(schema.requests).where(eq(schema.requests.id, args.requestId));
  if (!request) throw new Error("request not found");
  const { customer, settings } = await loadCustomer(db, request.customerId);
  const lines = await db.select().from(schema.orderLines).where(eq(schema.orderLines.requestId, request.id));
  const buyer = request.buyerId ? (await db.select().from(schema.buyers).where(eq(schema.buyers.id, request.buyerId)))[0] : null;

  for (const l of lines) {
    const price = args.price ?? (l.finalPrice != null ? Number(l.finalPrice) : l.priceOffered != null ? Number(l.priceOffered) : null);
    const cases = args.cases != null && lines.length === 1 ? args.cases : l.cases;
    await db.update(schema.orderLines).set({ finalPrice: price != null ? price.toFixed(2) : null, cases }).where(eq(schema.orderLines.id, l.id));
  }
  const status = args.source === "auto" ? "auto_cleared" : "approved";
  await db.update(schema.requests).set({ status, decidedById: args.byMemberId ?? null }).where(eq(schema.requests.id, request.id));
  await db.insert(schema.events).values({ customerId: request.customerId, requestId: request.id, type: "deal.confirmed", payload: { source: args.source, by: args.byMemberId ?? null, price: args.price ?? null, cases: args.cases ?? null } });

  const fresh = await db.select().from(schema.orderLines).where(eq(schema.orderLines.requestId, request.id));
  const first = fresh[0];
  // Written confirmation to the buyer, on the channel they used (WhatsApp if that is how they reached us).
  if (request.callbackNumber && request.callbackPermission !== false && first) {
    const product = fresh.length === 1 ? lineDesc(first) : fresh.map((l) => `${l.cases ?? ""} ${lineDesc(l)}`.trim()).join(", ");
    const body = fillConfirmation(settings.confirmationTemplate, {
      company: customer.name, cases: fresh.length === 1 ? first.cases : null, product,
      price: fresh.length === 1 && first.finalPrice != null ? Number(first.finalPrice) : null, pickup: pickupWord(first.pickupDate), ref: request.ref,
    });
    const channel = buyer?.phones.length && request.channel === "text" && false ? "whatsapp" : "sms";
    await sendToBuyer(db, { customerId: request.customerId, requestId: request.id, to: request.callbackNumber, body, channel, now: args.now });
  }
  // Order card to the deciding rep (or everyone scheduled, for auto-clears), plus order clerks.
  const members = await db.select().from(schema.teamMembers).where(and(eq(schema.teamMembers.customerId, request.customerId), eq(schema.teamMembers.active, true)));
  const scheduled = args.byMemberId ? members.filter((m) => m.id === args.byMemberId) : await cardRecipients(db, request.customerId, args.now);
  const targets = new Map<string, typeof members[number]>();
  for (const m of [...scheduled, ...members.filter((m) => m.isOrderClerk)]) targets.set(m.id, m);
  const rules = await db.select().from(schema.priceRules).where(eq(schema.priceRules.customerId, request.customerId));
  for (const l of fresh) {
    const rule = args.source === "auto" ? rules.find((r) => r.product.toLowerCase() === l.product.toLowerCase() && (!r.size || r.size === l.size)) : undefined;
    const text = orderCard({
      ref: request.ref, customer: buyer?.company ?? request.callerCompany ?? "Unknown buyer", city: buyer?.city ?? null, poNumber: l.poNumber,
      product: l.product, size: l.size, pack: l.pack, cases: l.cases ?? 0, price: l.finalPrice != null ? Number(l.finalPrice) : 0,
      terms: l.fulfillment === "delivered" ? `delivered${l.destination ? ` ${l.destination}` : ""}` : "FOB", pickupDate: l.pickupDate, fulfillment: l.fulfillment,
      contactName: request.callerName ?? buyer?.contactName ?? null, contactNumber: request.callbackNumber,
      rule: rule ? { cleared: rule.casesCleared, limit: rule.caseLimit } : undefined,
    });
    for (const m of targets.values()) await sendToRep(db, m, { customerId: request.customerId, requestId: request.id, body: text, template: { kind: "notice" }, now: args.now });
  }
  return { status };
}

/** Variables the callback agent reads from; the script says only what is in here. */
function callbackVariables(c: { customer: string; request: Request; line: Line; price: number | null; cases: number | null; intent: "confirm" | "counter" | "reject"; reason: string | null; repName: string | null }) {
  return {
    company_name: c.customer, buyer_name: c.request.callerName ?? "", buyer_company: c.request.callerCompany ?? "",
    ref: String(c.request.ref), intent: c.intent, product: lineDesc(c.line), cases: c.cases != null ? String(c.cases) : "",
    price: c.price != null ? c.price.toFixed(2) : "", pickup: pickupWord(c.line.pickupDate), reason: c.reason ?? "", rep_name: c.repName ?? "the team",
    original_cases: c.line.cases != null ? String(c.line.cases) : "", original_price: c.line.priceOffered != null ? Number(c.line.priceOffered).toFixed(2) : "",
    request_id: c.request.id,
  };
}

/**
 * Runs once the undo window has passed. Approve and counter reach the buyer on the channel
 * they used; reject tells them, with the rep's reason if any.
 */
export async function executeDecision(db: Db, decisionId: string, now: Date) {
  const [decision] = await db.select().from(schema.decisions).where(eq(schema.decisions.id, decisionId));
  if (!decision || decision.undone) return { skipped: "undone" as const };
  const [request] = await db.select().from(schema.requests).where(eq(schema.requests.id, decision.requestId));
  if (!request || request.status !== "in_progress") return { skipped: "closed" as const };
  const { customer, settings } = await loadCustomer(db, request.customerId);
  const [line] = await db.select().from(schema.orderLines).where(eq(schema.orderLines.requestId, request.id));
  const rep = decision.memberId ? (await db.select().from(schema.teamMembers).where(eq(schema.teamMembers.id, decision.memberId)))[0] : null;

  if (decision.action === "reject") {
    await db.update(schema.requests).set({ status: "rejected", decidedById: decision.memberId }).where(eq(schema.requests.id, request.id));
    await db.insert(schema.events).values({ customerId: request.customerId, requestId: request.id, type: "request.rejected", payload: { by: decision.memberId, reason: decision.reason } });
    if (request.callbackNumber && request.callbackPermission !== false) {
      const body = `${customer.name}: sorry, we can't fill your request (ref ${request.ref})${decision.reason ? `: ${decision.reason}` : ""}. Thanks for calling.`;
      await sendToBuyer(db, { customerId: request.customerId, requestId: request.id, to: request.callbackNumber, body, now });
    }
    return { done: "rejected" as const };
  }

  if (!line) return { skipped: "no_line" as const };
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
    const body = `${customer.name}: we can do ${cases ?? ""} cases ${lineDesc(line)} at ${price != null ? fmtMoney(price) : "the price discussed"}, pickup ${pickupWord(line.pickupDate)} (ref ${request.ref}). Reply YES to confirm or NO.`;
    await sendToBuyer(db, { customerId: request.customerId, requestId: request.id, to: request.callbackNumber!, body, now });
    await db.update(schema.callbacks).set({ attempts: 1, lastAttemptAt: now }).where(eq(schema.callbacks.id, cb.id));
    return { done: "counter_texted" as const };
  }
  return placeBuyerCall(db, { request, line, callbackId: cb.id, price, cases, intent: decision.action === "counter" ? "counter" : "confirm", repName: rep?.name ?? null, now, customer: customer.name, textFirst: settings.textFirstBeforeCall });
}

async function placeBuyerCall(db: Db, a: { request: Request; line: Line; callbackId: string; price: number | null; cases: number | null; intent: "confirm" | "counter"; repName: string | null; now: Date; customer: string; textFirst: boolean }) {
  const { request } = a;
  if (!request.callbackNumber || request.callbackPermission === false) {
    await db.update(schema.callbacks).set({ outcome: "no_answer", notes: "no callback permission" }).where(eq(schema.callbacks.id, a.callbackId));
    return { done: "no_permission" as const };
  }
  const [voice] = await db.select().from(schema.lines).where(and(eq(schema.lines.customerId, request.customerId), eq(schema.lines.kind, "voice")));
  if (a.textFirst) await sendToBuyer(db, { customerId: request.customerId, requestId: request.id, to: request.callbackNumber, body: `${a.customer} calling you back about your order (ref ${request.ref}).`, now: a.now });
  const variables = callbackVariables({ customer: a.customer, request, line: a.line, price: a.price, cases: a.cases, intent: a.intent, reason: null, repName: a.repName });
  const call = await placeCallback({ agentId: env.dryRun ? "dry" : env.eleven.callbackAgentId, agentPhoneNumberId: voice?.elevenPhoneNumberId ?? (env.dryRun ? "dry" : ""), to: request.callbackNumber, variables });
  await db.update(schema.callbacks).set({ attempts: 1, lastAttemptAt: a.now, providerConversationId: call.conversationId }).where(eq(schema.callbacks.id, a.callbackId));
  await db.insert(schema.messages).values({ customerId: request.customerId, requestId: request.id, direction: "out", party: "desk", channel: "voice", body: `Callback (${a.intent}): ${variables.cases} cs ${variables.product} at $${variables.price}`, providerId: call.conversationId, sentAt: a.now });
  await db.insert(schema.events).values({ customerId: request.customerId, requestId: request.id, type: "callback.placed", payload: { callbackId: a.callbackId, intent: a.intent, conversationId: call.conversationId } });
  return { done: "called" as const, conversationId: call.conversationId };
}

export type CallbackOutcome = { outcome: "confirmed" | "declined" | "changed" | "no_answer" | "bought_elsewhere"; notes?: string | null; changeDetails?: string | null; competitor?: string | null; competitorPrice?: string | null; transcript?: string | null };

/** The callback agent's post-call result, matched to the callback by conversation id. */
export async function handleCallbackOutcome(db: Db, conversationId: string, o: CallbackOutcome, now: Date) {
  const [cb] = await db.select().from(schema.callbacks).where(eq(schema.callbacks.providerConversationId, conversationId));
  if (!cb) return { ignored: "unknown callback" as const };
  if (cb.outcome !== "pending") return { ignored: "already settled" as const };
  const [request] = await db.select().from(schema.requests).where(eq(schema.requests.id, cb.requestId));
  const [decision] = cb.decisionId ? await db.select().from(schema.decisions).where(eq(schema.decisions.id, cb.decisionId)) : [];
  const { customer, settings } = await loadCustomer(db, request.customerId);
  await db.insert(schema.messages).values({ customerId: request.customerId, requestId: request.id, direction: "in", party: "buyer", channel: "voice", body: o.transcript ?? o.notes ?? null, providerId: `${conversationId}:in`, sentAt: now });
  const repNotify = async (text: string) => {
    if (!decision?.memberId) return;
    const [m] = await db.select().from(schema.teamMembers).where(eq(schema.teamMembers.id, decision.memberId));
    if (m) await sendToRep(db, m, { customerId: request.customerId, requestId: request.id, body: text, template: { kind: "notice" }, now });
  };
  const first = request.callerName?.split(" ")[0] ?? "The buyer";

  switch (o.outcome) {
    case "confirmed": {
      await db.update(schema.callbacks).set({ outcome: "confirmed", buyerYesAt: now, notes: o.notes ?? null }).where(eq(schema.callbacks.id, cb.id));
      await confirmDeal(db, { requestId: request.id, now, source: decision?.action === "counter" ? "counter" : "approve", byMemberId: decision?.memberId ?? null, price: cb.offerPrice != null ? Number(cb.offerPrice) : null, cases: cb.offerCases });
      return { done: "confirmed" as const };
    }
    case "declined": {
      await db.update(schema.callbacks).set({ outcome: "declined", notes: o.notes ?? null }).where(eq(schema.callbacks.id, cb.id));
      await db.update(schema.requests).set({ status: "rejected" }).where(eq(schema.requests.id, request.id));
      await db.insert(schema.events).values({ customerId: request.customerId, requestId: request.id, type: "callback.declined", payload: { notes: o.notes ?? null } });
      await repNotify(`${first} declined ${cb.offerPrice != null ? fmtMoney(Number(cb.offerPrice)) : "the offer"} on ref ${request.ref}. Reply TAKE to take it over.`);
      return { done: "declined" as const };
    }
    case "bought_elsewhere": {
      await db.update(schema.callbacks).set({ outcome: "declined", notes: [o.competitor, o.competitorPrice].filter(Boolean).join(" at ") || o.notes || null }).where(eq(schema.callbacks.id, cb.id));
      await db.update(schema.requests).set({ status: "rejected", takeOverOutcome: "lost" }).where(eq(schema.requests.id, request.id));
      await db.insert(schema.events).values({ customerId: request.customerId, requestId: request.id, type: "callback.bought_elsewhere", payload: { competitor: o.competitor ?? null, price: o.competitorPrice ?? null } });
      await repNotify(`${first} bought elsewhere${o.competitor ? ` (${o.competitor}${o.competitorPrice ? ` at ${o.competitorPrice}` : ""})` : ""}. Ref ${request.ref} closed.`);
      return { done: "lost" as const };
    }
    case "changed": {
      // Back to the reps as a fresh card on the same reference, flagged with what changed.
      await db.update(schema.callbacks).set({ outcome: "changed", notes: o.changeDetails ?? o.notes ?? null }).where(eq(schema.callbacks.id, cb.id));
      const flags = Array.from(new Set([...request.flags.filter((f) => f !== "repeat_caller"), "changed"]));
      await db.update(schema.requests).set({ claimedById: null, decidedById: null, flags, summary: `Buyer changed the order on callback: ${o.changeDetails ?? "see notes"}` }).where(eq(schema.requests.id, request.id));
      await db.insert(schema.events).values({ customerId: request.customerId, requestId: request.id, type: "callback.changed", payload: { details: o.changeDetails ?? null } });
      await dispatchCard(db, request.id, now);
      return { done: "changed" as const };
    }
    case "no_answer": {
      const attempts = cb.attempts;
      if (attempts < 2) {
        await db.update(schema.callbacks).set({ lastAttemptAt: now }).where(eq(schema.callbacks.id, cb.id));
        await inngestSend({ name: "soba/callback.retry", data: { callbackId: cb.id, requestId: request.id, customerId: request.customerId } });
        return { done: "retry_scheduled" as const };
      }
      await db.update(schema.callbacks).set({ outcome: "no_answer" }).where(eq(schema.callbacks.id, cb.id));
      if (settings.noAnswerAction !== "none" && request.callbackNumber) {
        const [line] = await db.select().from(schema.orderLines).where(eq(schema.orderLines.requestId, request.id));
        const body = `${customer.name}: we tried to reach you about ref ${request.ref}. We can do ${cb.offerCases ?? line?.cases ?? ""} cases ${line ? lineDesc(line) : ""} at ${cb.offerPrice != null ? fmtMoney(Number(cb.offerPrice)) : "the price discussed"}, pickup ${pickupWord(line?.pickupDate ?? null)}. Reply YES to confirm.`;
        await sendToBuyer(db, { customerId: request.customerId, requestId: request.id, to: request.callbackNumber, body, channel: settings.noAnswerAction === "whatsapp" ? "whatsapp" : "sms", now });
      }
      await db.insert(schema.events).values({ customerId: request.customerId, requestId: request.id, type: "callback.no_answer", payload: { attempts } });
      return { done: "no_answer" as const };
    }
  }
}

/** Second attempt after no answer. */
export async function retryCallback(db: Db, callbackId: string, now: Date) {
  const [cb] = await db.select().from(schema.callbacks).where(eq(schema.callbacks.id, callbackId));
  if (!cb || cb.outcome !== "pending") return { skipped: true };
  const [request] = await db.select().from(schema.requests).where(eq(schema.requests.id, cb.requestId));
  if (!request || request.status !== "in_progress") return { skipped: true };
  const [decision] = cb.decisionId ? await db.select().from(schema.decisions).where(eq(schema.decisions.id, cb.decisionId)) : [];
  const [line] = await db.select().from(schema.orderLines).where(eq(schema.orderLines.requestId, request.id));
  const { customer, settings } = await loadCustomer(db, request.customerId);
  const rep = decision?.memberId ? (await db.select().from(schema.teamMembers).where(eq(schema.teamMembers.id, decision.memberId)))[0] : null;
  await db.update(schema.callbacks).set({ attempts: cb.attempts + 1 }).where(eq(schema.callbacks.id, cb.id));
  return placeBuyerCall(db, { request, line, callbackId: cb.id, price: cb.offerPrice != null ? Number(cb.offerPrice) : null, cases: cb.offerCases, intent: decision?.action === "counter" ? "counter" : "confirm", repName: rep?.name ?? null, now, customer: customer.name, textFirst: settings.textFirstBeforeCall });
}

/** A buyer's YES / NO text after a counter or no-answer offer. */
export async function handleBuyerOfferReply(db: Db, requestId: string, text: string, now: Date): Promise<"confirmed" | "declined" | "other"> {
  const t = text.trim().toLowerCase();
  const [cb] = await db.select().from(schema.callbacks).where(and(eq(schema.callbacks.requestId, requestId), eq(schema.callbacks.outcome, "pending"))).orderBy(desc(schema.callbacks.lastAttemptAt)).limit(1);
  if (!cb) return "other";
  const [decision] = cb.decisionId ? await db.select().from(schema.decisions).where(eq(schema.decisions.id, cb.decisionId)) : [];
  if (/^(yes|y|si|sí|ok|okay|confirm|confirmed|dale|yes please|yep|yeah)\b/.test(t)) {
    await db.update(schema.callbacks).set({ outcome: "confirmed", buyerYesAt: now }).where(eq(schema.callbacks.id, cb.id));
    await confirmDeal(db, { requestId, now, source: decision?.action === "counter" ? "counter" : "approve", byMemberId: decision?.memberId ?? null, price: cb.offerPrice != null ? Number(cb.offerPrice) : null, cases: cb.offerCases });
    return "confirmed";
  }
  if (/^(no|n|nope|pass|no thanks|no gracias)\b/.test(t)) {
    await db.update(schema.callbacks).set({ outcome: "declined", notes: text }).where(eq(schema.callbacks.id, cb.id));
    await db.update(schema.requests).set({ status: "rejected" }).where(eq(schema.requests.id, requestId));
    await db.insert(schema.events).values({ requestId, type: "callback.declined", payload: { notes: text } });
    const [request] = await db.select().from(schema.requests).where(eq(schema.requests.id, requestId));
    if (decision?.memberId) {
      const [m] = await db.select().from(schema.teamMembers).where(eq(schema.teamMembers.id, decision.memberId));
      if (m) await sendToRep(db, m, { customerId: request.customerId, requestId, body: `${request.callerName ?? "The buyer"} declined ${cb.offerPrice != null ? fmtMoney(Number(cb.offerPrice)) : "the offer"} on ref ${request.ref}. Reply TAKE to take it over.`, template: { kind: "notice" }, now });
      await notifyOtherRecipients(db, requestId, decision.memberId, "buyer declined", now);
    }
    return "declined";
  }
  return "other";
}
