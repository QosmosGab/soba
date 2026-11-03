// The desk by text: a buyer texts the business line, the desk asks for what an
// order needs (in the buyer's language), and when the request is complete the
// thread goes through the shared intake. Replies to a confirmation become a
// change request; YES/NO after a counter settle the callback.
import { z } from "zod";
import { and, desc, eq, gt, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { generateJson, LlmRefusal } from "./llm";
import { loadCustomer } from "./cards";
import { handleIntake } from "./intake";
import { sendToBuyer } from "./messaging";
import { handleBuyerOfferReply, reopenAsChanged } from "./callbacks";
import { buyerText, saysStop } from "./buyer-text";
import { isOffHours } from "./hours";
import { toE164 } from "./requests";

const THREAD_WINDOW_MS = 3 * 60 * 60 * 1000;
/** An offer by text stops being answerable after a day; a later YES starts a new conversation instead. */
const OFFER_TTL_MS = 24 * 60 * 60 * 1000;
const CONFIRM_WINDOW_MS = 36 * 60 * 60 * 1000;

const TurnSchema = z.object({
  reply: z.string().describe("The desk's next text to the buyer, in the buyer's language, under 300 characters, no emojis"),
  complete: z.boolean().describe("True when everything an order needs has been given (who, callback number, product, size, pack, quantity, pickup day, collect or delivered) or when the buyer clearly has nothing more to add"),
  type: z.enum(["new_order", "availability", "hold", "change", "complaint", "pickup", "other"]),
  language: z.enum(["en", "es", "mixed"]),
});

const SYSTEM = `You are the after-hours text desk of a fresh-produce sales company. You answer buyers who text the order line, in English or Spanish (follow the buyer), short and plain, like a competent dispatcher. You never say you are an AI unless asked directly; if asked, answer honestly.

Your job: collect what an order needs, one or two questions at a time, then say you're passing it to the team. Required for an order: buyer name and company, callback number (the number they're texting from counts if they confirm it), product, size, pack, number of cases, pickup day, collect (their truck) or delivered (then destination). Nice to have: price offered, PO number.
- Read numbers back before finishing: "300 cs 4x4 vine-ripes, 25 lb, Monday pickup at $8.25, your truck. I'll pass it to the team."
- If a price is on tonight's list and the buyer asks, you may state it as "tonight's price". Never invent a price, quantity or date. Never promise when they'll hear back.
- If they're not ordering (availability, pickup question, complaint, change to an order), get the essentials for that and close with "I'll pass it to the team."
- Mark complete=true once the request is usable, or once the buyer says that's all. Keep replies under 300 characters.`;

type Msg = { direction: string; body: string | null; sentAt: Date };

function threadText(msgs: Msg[]): string {
  return msgs.filter((m) => m.body).map((m) => `${m.direction === "in" ? "Buyer" : "Desk"}: ${m.body}`).join("\n");
}

export async function deskTextTurn(msgs: Msg[], ctx: { customer: string; timezone: string; rules: string[]; quotePrices: boolean; now: Date; priorRef?: number | null }): Promise<z.infer<typeof TurnSchema>> {
  const nowLocal = ctx.now.toLocaleString("en-US", { timeZone: ctx.timezone, weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" });
  const context = [
    `Company: ${ctx.customer}. Local time: ${nowLocal}.`,
    ctx.quotePrices && ctx.rules.length ? `Tonight's prices you may quote: ${ctx.rules.join("; ")}` : "Do not quote prices; say the team will confirm the price.",
    ctx.priorRef ? `This buyer is replying to the confirmation of ref ${ctx.priorRef}; treat the message as a change request to that order.` : "",
  ].filter(Boolean).join("\n");
  try {
    return await generateJson({ schema: TurnSchema, system: SYSTEM, user: `${context}\n\nConversation so far:\n${threadText(msgs)}\n\nWrite the desk's next reply.`, effort: "low", maxTokens: 1200 });
  } catch (err) {
    if (err instanceof LlmRefusal) return { reply: "Got it. I'll pass this to the team and they'll get back to you.", complete: true, type: "other", language: "en" };
    throw err;
  }
}

export type BuyerTextInput = { customerId: string; lineId: string | null; from: string; body: string; providerId: string | null; now: Date };

/** One inbound SMS from a buyer. Returns what the desk did. */
export async function handleBuyerText(db: Db, input: BuyerTextInput): Promise<{ action: string; requestId?: string }> {
  const { customerId, now } = input;
  const phone = toE164(input.from) ?? input.from;
  const { customer, settings } = await loadCustomer(db, customerId);

  // 0. STOP: record the opt-out on every buyer with this number; Twilio blocks sends on its own.
  if (saysStop(input.body)) {
    await db.update(schema.buyers).set({ doNotContact: true }).where(and(eq(schema.buyers.customerId, customerId), sql`${schema.buyers.phones} @> ${JSON.stringify([phone])}::jsonb`));
    await db.insert(schema.events).values({ customerId, type: "buyer.opted_out", payload: { phone } });
    return { action: "opted_out" };
  }

  // 1. A YES/NO to a pending offer (counter by text, or the no-answer text).
  const pendingOffers = await db.select({ requestId: schema.callbacks.requestId }).from(schema.callbacks).innerJoin(schema.requests, eq(schema.requests.id, schema.callbacks.requestId))
    .where(and(eq(schema.requests.customerId, customerId), eq(schema.requests.callbackNumber, phone), eq(schema.callbacks.outcome, "pending"), eq(schema.requests.status, "in_progress"), gt(schema.callbacks.lastAttemptAt, new Date(now.getTime() - OFFER_TTL_MS))))
    .orderBy(desc(schema.callbacks.lastAttemptAt)).limit(1);
  if (pendingOffers[0]) {
    await db.insert(schema.messages).values({ customerId, requestId: pendingOffers[0].requestId, direction: "in", party: "buyer", channel: "sms", body: input.body, providerId: input.providerId, sentAt: now }).onConflictDoNothing();
    const r = await handleBuyerOfferReply(db, pendingOffers[0].requestId, input.body, now);
    if (r !== "other") return { action: `offer_${r}`, requestId: pendingOffers[0].requestId };
    // Anything else is a change: back to the reps.
    const [request] = await db.select().from(schema.requests).where(eq(schema.requests.id, pendingOffers[0].requestId));
    await db.update(schema.callbacks).set({ outcome: "changed", notes: input.body }).where(and(eq(schema.callbacks.requestId, request.id), eq(schema.callbacks.outcome, "pending")));
    await reopenAsChanged(db, request, `Buyer replied to the offer: ${input.body}`, input.body, now);
    await sendToBuyer(db, { customerId, requestId: request.id, to: phone, body: buyerText.passedOn(customer.name, request.language === "es" ? "es" : "en"), now });
    return { action: "offer_changed", requestId: request.id };
  }

  // 2. An open text thread, or a new one.
  let [thread] = await db.select().from(schema.buyerThreads).where(and(eq(schema.buyerThreads.customerId, customerId), eq(schema.buyerThreads.buyerPhone, phone), eq(schema.buyerThreads.state, "open"), gt(schema.buyerThreads.lastAt, new Date(now.getTime() - THREAD_WINDOW_MS)))).orderBy(desc(schema.buyerThreads.lastAt)).limit(1);
  let priorRef: number | null = null;
  if (!thread) {
    // "Reply here to change": a recent confirmed order from this number makes this a change request.
    const [confirmed] = await db.select().from(schema.requests).where(and(eq(schema.requests.customerId, customerId), eq(schema.requests.callbackNumber, phone), inArray(schema.requests.status, ["auto_cleared", "approved"]), gt(schema.requests.receivedAt, new Date(now.getTime() - CONFIRM_WINDOW_MS)))).orderBy(desc(schema.requests.receivedAt)).limit(1);
    priorRef = confirmed?.ref ?? null;
    [thread] = await db.insert(schema.buyerThreads).values({ customerId, lineId: input.lineId, buyerPhone: phone, startedAt: now, lastAt: now }).returning();
  }
  const inserted = await db.insert(schema.messages).values({ customerId, threadId: thread.id, direction: "in", party: "buyer", channel: "sms", body: input.body, providerId: input.providerId, sentAt: now }).onConflictDoNothing().returning({ id: schema.messages.id });
  if (!inserted.length) return { action: "duplicate" };
  await db.update(schema.buyerThreads).set({ lastAt: now }).where(eq(schema.buyerThreads.id, thread.id));

  const msgs = await db.select().from(schema.messages).where(eq(schema.messages.threadId, thread.id)).orderBy(schema.messages.sentAt);
  const offHours = isOffHours(now, settings.hours, customer.timezone, settings.holidays);
  const rules = offHours && settings.quotePrices
    ? (await db.select().from(schema.priceRules).where(and(eq(schema.priceRules.customerId, customerId), gt(schema.priceRules.expiresAt, now), eq(schema.priceRules.on, true)))).map((r) => `${[r.size, r.product, r.pack].filter(Boolean).join(" ")} $${Number(r.minPrice).toFixed(2)}/case`)
    : [];
  let turn: Awaited<ReturnType<typeof deskTextTurn>>;
  try {
    turn = await deskTextTurn(msgs, { customer: customer.name, timezone: customer.timezone, rules, quotePrices: settings.quotePrices, now, priorRef });
  } catch (err) {
    // The model is down: don't leave the buyer hanging, and hand the thread to the reps as is.
    await db.insert(schema.events).values({ customerId, type: "textdesk.failed", payload: { threadId: thread.id, error: String(err).slice(0, 500) } });
    turn = { reply: /[áéíóñ¿¡]|\b(hola|cajas|buenas)\b/i.test(input.body) ? "Recibido. El equipo le responde en breve." : "Got it. The team will get back to you shortly.", complete: true, type: "other", language: "en" };
  }
  await sendToBuyer(db, { customerId, threadId: thread.id, to: phone, body: turn.reply, now });
  if (!turn.complete) return { action: "asked" };

  const transcript = `${priorRef ? `(Buyer is replying to the confirmation of ref ${priorRef}; this is a change request.)\n` : ""}${threadText([...msgs, { direction: "out", body: turn.reply, sentAt: now }])}`;
  const result = await handleIntake(db, { customerId, channel: "text", transcript, now, callerId: phone, threadId: thread.id, providerConversationId: `thread:${thread.id}` });
  await db.update(schema.buyerThreads).set({ state: "done" }).where(eq(schema.buyerThreads.id, thread.id));
  if ("requestId" in result) {
    await db.update(schema.messages).set({ requestId: result.requestId }).where(eq(schema.messages.threadId, thread.id));
    return { action: result.outcome, requestId: result.requestId };
  }
  return { action: result.outcome };
}
