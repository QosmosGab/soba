// What a rep's message on WhatsApp (or SMS) does: claims the card, records the
// decision with its undo window, asks the one follow-up question (final price,
// reject reason, or a clarification), and tells the other reps.
import { and, desc, eq, gt, inArray, isNull, lt, or } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { afterTap, fmtMoney, undoWord } from "./card";
import { notifyOtherRecipients, loadCustomer } from "./cards";
import { sendToRep } from "./messaging";
import { parseRepReply, parseRepReplyFast, type RepReply } from "./reply";
import { inngestSend } from "@/inngest/send";

type Member = typeof schema.teamMembers.$inferSelect;
type Thread = typeof schema.repThreads.$inferSelect;
type Request = typeof schema.requests.$inferSelect;

/** A claim with no decision behind it frees up after this long, so one rep tapping Counter and walking away can't block the others. */
export const STALE_CLAIM_MS = 10 * 60 * 1000;
const ACTIONS = ["approve", "counter", "reject", "take_over", "undo", "won", "lost", "skip"] as const;
const DECIDING = ["approve", "counter", "reject"];

export async function getThread(db: Db, memberId: string): Promise<Thread> {
  const [t] = await db.select().from(schema.repThreads).where(eq(schema.repThreads.memberId, memberId));
  if (t) return t;
  const [n] = await db.insert(schema.repThreads).values({ memberId }).returning();
  return n;
}

export async function setThread(db: Db, memberId: string, patch: Partial<Thread>) {
  await db.update(schema.repThreads).set({ ...patch, updatedAt: new Date() }).where(eq(schema.repThreads.memberId, memberId));
}

/** The request a reply is about: the button's payload, a "ref 1042" in the text, the thread's live card, else the latest open card this rep got. */
export async function resolveTargetRequest(db: Db, member: Member, thread: Thread, buttonPayload: string | null, text: string): Promise<Request | null> {
  const own = (r: Request | undefined) => (r && r.customerId === member.customerId ? r : null);
  const fromPayload = buttonPayload?.match(/^[a-z_]+:([0-9a-f-]{36})$/i)?.[1];
  if (fromPayload) return own((await db.select().from(schema.requests).where(eq(schema.requests.id, fromPayload)))[0]);
  const refInText = text.match(/\b(?:ref|#)\s*(\d{4,6})\b/i)?.[1];
  if (refInText) {
    const r = await db.select().from(schema.requests).where(and(eq(schema.requests.customerId, member.customerId), eq(schema.requests.ref, Number(refInText))));
    if (r[0]) return r[0];
  }
  if (thread.requestId) {
    const r = own((await db.select().from(schema.requests).where(eq(schema.requests.id, thread.requestId)))[0]);
    if (r && r.status === "in_progress") return r;
  }
  const sent = await db.select({ requestId: schema.messages.requestId }).from(schema.messages)
    .where(and(eq(schema.messages.memberId, member.id), eq(schema.messages.direction, "out")))
    .orderBy(desc(schema.messages.sentAt)).limit(20);
  const ids = Array.from(new Set(sent.map((s) => s.requestId).filter((x): x is string => Boolean(x))));
  if (!ids.length) return null;
  const open = await db.select().from(schema.requests).where(and(inArray(schema.requests.id, ids), eq(schema.requests.customerId, member.customerId), eq(schema.requests.status, "in_progress"))).orderBy(desc(schema.requests.receivedAt));
  return open.find((r) => !r.claimedById || r.claimedById === member.id) ?? open[0] ?? null;
}

/** First answer wins. A claim without a decision goes stale after STALE_CLAIM_MS. */
export async function claimRequest(db: Db, requestId: string, memberId: string, now: Date): Promise<{ ok: true } | { ok: false; by: Member | null }> {
  const stale = new Date(now.getTime() - STALE_CLAIM_MS);
  const taken = await db.update(schema.requests).set({ claimedById: memberId, claimedAt: now })
    .where(and(eq(schema.requests.id, requestId), eq(schema.requests.status, "in_progress"),
      or(isNull(schema.requests.claimedById), eq(schema.requests.claimedById, memberId), and(isNull(schema.requests.decidedById), lt(schema.requests.claimedAt, stale)))))
    .returning({ id: schema.requests.id });
  if (taken.length) return { ok: true };
  const [r] = await db.select().from(schema.requests).where(eq(schema.requests.id, requestId));
  const by = r?.claimedById ? (await db.select().from(schema.teamMembers).where(eq(schema.teamMembers.id, r.claimedById)))[0] ?? null : null;
  return { ok: false, by };
}

/** Decisions still inside their undo window on this request, newest first. */
async function pendingDecisions(db: Db, requestId: string, now: Date) {
  return db.select().from(schema.decisions).where(and(eq(schema.decisions.requestId, requestId), eq(schema.decisions.undone, false), gt(schema.decisions.undoDeadline, now))).orderBy(desc(schema.decisions.createdAt));
}

async function memberName(db: Db, id: string | null) {
  if (!id) return null;
  const [m] = await db.select({ name: schema.teamMembers.name }).from(schema.teamMembers).where(eq(schema.teamMembers.id, id));
  return m?.name ?? null;
}

export type RepMessageResult = { replies: string[]; action: string; requestId: string | null };

/**
 * One inbound message from a rep. `buttonPayload` is the quick-reply id (e.g. "approve:<requestId>")
 * when a button was tapped; `text` is what they typed or the button's label. `silent` (panel) records
 * the replies without sending them.
 */
export async function handleRepMessage(db: Db, args: { member: Member; text: string; buttonPayload?: string | null; now: Date; silent?: boolean }): Promise<RepMessageResult> {
  const { member, now } = args;
  const text = args.text.trim();
  const thread = await getThread(db, member.id);
  const { settings } = await loadCustomer(db, member.customerId);
  const replies: string[] = [];
  const say = async (body: string, requestId?: string | null) => { replies.push(body); if (args.silent) return; await sendToRep(db, member, { customerId: member.customerId, requestId: requestId ?? null, body, template: { kind: "notice" }, now }); };
  const done = (action: string, requestId: string | null = null): RepMessageResult => ({ replies, action, requestId });

  const request = await resolveTargetRequest(db, member, thread, args.buttonPayload ?? null, text);
  const lines = request ? await db.select().from(schema.orderLines).where(eq(schema.orderLines.requestId, request.id)) : [];
  const line = lines[0] ?? null;
  const first = request?.callerName?.split(" ")[0] ?? "the buyer";
  const ctx = { buyerFirst: first, cases: line?.cases ?? null, priceOffered: line?.priceOffered != null ? Number(line.priceOffered) : null };
  const buttonAction = args.buttonPayload?.split(":")[0] ?? null;

  // What the rep means: a button, an answer to our question, or free text.
  let reply: RepReply;
  if (buttonAction && (ACTIONS as readonly string[]).includes(buttonAction)) {
    reply = { action: buttonAction as RepReply["action"], cases: null, price: null, reason: null, clarify: null };
  } else if (thread.state === "awaiting_counter" && request) {
    const fast = parseRepReplyFast(text);
    if (fast?.action === "counter") reply = fast;
    else if (fast && ["approve", "reject", "take_over", "undo"].includes(fast.action)) reply = fast; // changed their mind
    else if (/^(cancel|never mind|nevermind|forget it)$/i.test(text)) { await setThread(db, member.id, { state: "idle" }); await say(`OK, no counter sent. Ref ${request.ref} is still open.`, request.id); return done("cancelled", request.id); }
    else {
      const parsed = await parseRepReply(text, ctx);
      if (parsed.action === "counter" && parsed.price != null) reply = parsed;
      else { await say(`What's the final price for ${first}? Reply like "8.50" or "8.50 max 200".`, request.id); return done("ask_counter_again", request.id); }
    }
  } else if (thread.state === "awaiting_reason" && request) {
    const skip = /^(skip|none|no reason|-|no)$/i.test(text);
    reply = { action: "reject", cases: null, price: null, reason: skip ? null : text, clarify: null };
  } else {
    reply = await parseRepReply(text, ctx);
  }

  if (!request) {
    if (reply.action === "acknowledged") return done("acknowledged");
    await say("No open request is waiting on you right now.");
    return done("no_request");
  }

  // Guards before anything is recorded. The thread remembers the card so the rep's next line lands on it.
  const isOrder = request.type === "new_order" || request.type === "change";
  if (DECIDING.includes(reply.action)) {
    await setThread(db, member.id, { requestId: request.id });
    if (!isOrder) { await say(`Ref ${request.ref} isn't an order (${request.type.replace("_", " ")}). Reply TAKE to take it over.`, request.id); return done("not_an_order", request.id); }
    if (!member.canApprove) { await say(`Your account can't approve orders. Reply TAKE to take ref ${request.ref} over, or ask a manager.`, request.id); return done("not_allowed", request.id); }
    if (reply.action !== "reject" && (!request.callbackNumber || request.callbackPermission === false)) {
      await say(`Ref ${request.ref}: ${request.callbackNumber ? `${first} asked not to be called back` : "no callback number was captured"}. Reply TAKE to handle it yourself, or REJECT.`, request.id);
      return done("no_callback", request.id);
    }
    if (reply.action === "approve" && (line?.cases == null || line.priceOffered == null)) {
      await say(`Ref ${request.ref} has no ${line?.cases == null ? "quantity" : "price"} from the buyer. Reply with a price like "8.50 max 200" to offer one, or TAKE to call ${first}.`, request.id);
      return done("incomplete", request.id);
    }
    if (reply.action === "counter" && reply.price != null && lines.length > 1) {
      await say(`Ref ${request.ref} has ${lines.length} products. Reply APPROVE to confirm all as asked, or TAKE to work it out with ${first}.`, request.id);
      return done("multi_line_counter", request.id);
    }
    if (reply.cases != null && reply.cases < 1) { await say(`How many cases? Reply like "yes but only 200".`, request.id); return done("bad_cases", request.id); }
  }

  const undoDeadline = new Date(now.getTime() + settings.undoSeconds * 1000);
  const undo = undoWord(settings.undoSeconds);
  const record = async (values: Omit<typeof schema.decisions.$inferInsert, "requestId" | "memberId" | "createdAt">, eventType: string, payload: Record<string, unknown>) => {
    // A new decision inside someone's undo window replaces it: only one thing reaches the buyer.
    for (const p of await pendingDecisions(db, request.id, now)) await db.update(schema.decisions).set({ undone: true }).where(eq(schema.decisions.id, p.id));
    const [d] = await db.insert(schema.decisions).values({ requestId: request.id, memberId: member.id, createdAt: now, ...values }).returning();
    await db.insert(schema.events).values({ customerId: member.customerId, requestId: request.id, type: eventType, payload: { by: member.id, ...payload } });
    await setThread(db, member.id, { state: "idle", requestId: request.id });
    return d;
  };

  switch (reply.action) {
    case "undo": {
      const [d] = await pendingDecisions(db, request.id, now);
      if (!d) { await say(`Nothing to undo on ref ${request.ref}: the desk already acted, or there was no decision.`, request.id); return done("nothing_to_undo", request.id); }
      if (d.memberId !== member.id && !member.canEditSettings) { await say(`That decision was someone else's. Only they, or a manager, can undo it.`, request.id); return done("not_yours", request.id); }
      await db.update(schema.decisions).set({ undone: true }).where(eq(schema.decisions.id, d.id));
      await db.update(schema.requests).set({ claimedById: null, claimedAt: null, decidedById: null }).where(eq(schema.requests.id, request.id));
      await db.insert(schema.events).values({ customerId: member.customerId, requestId: request.id, type: "decision.undone", payload: { decisionId: d.id, by: member.id } });
      await setThread(db, member.id, { state: "idle", requestId: request.id });
      await say(`Undone. Ref ${request.ref} is open again: Approve, Counter, Reject or Take over.`, request.id);
      await notifyOtherRecipients(db, request.id, member.id, "undid that; it's open again", now);
      return done("undone", request.id);
    }
    case "acknowledged": {
      await db.insert(schema.events).values({ customerId: member.customerId, requestId: request.id, type: "rep.acknowledged", payload: { by: member.id, text } });
      await setThread(db, member.id, { requestId: request.id });
      return done("acknowledged", request.id);
    }
    case "unclear": {
      await setThread(db, member.id, { state: "awaiting_clarify", requestId: request.id });
      await say(reply.clarify ?? "Sorry, I didn't get that. Approve, counter with a price, reject, or take over?", request.id);
      return done("clarify", request.id);
    }
    case "won": case "lost": {
      const [takeover] = await db.select().from(schema.decisions).where(and(eq(schema.decisions.requestId, request.id), eq(schema.decisions.action, "take_over"))).orderBy(desc(schema.decisions.createdAt)).limit(1);
      if (!takeover) { await say(`Ref ${request.ref} wasn't taken over. Reply TAKE first, then WON or LOST when it's settled.`, request.id); return done("not_taken_over", request.id); }
      if (takeover.memberId !== member.id && !member.canEditSettings) { await say(afterTap.alreadyTaken((await memberName(db, takeover.memberId)) ?? "someone"), request.id); return done("taken", request.id); }
      if (request.status !== "in_progress") { await say(`Ref ${request.ref} is already settled.`, request.id); return done("already_settled", request.id); }
      await db.insert(schema.decisions).values({ requestId: request.id, memberId: member.id, action: reply.action, createdAt: now });
      await db.update(schema.requests).set({ status: reply.action === "won" ? "approved" : "rejected", decidedById: member.id, takeOverOutcome: reply.action, assisted: reply.action === "won" }).where(eq(schema.requests.id, request.id));
      await db.insert(schema.events).values({ customerId: member.customerId, requestId: request.id, type: `takeover.${reply.action}`, payload: { by: member.id } });
      await setThread(db, member.id, { state: "idle" });
      await say(reply.action === "won" ? `Logged as won, ref ${request.ref}. Nice.` : `Logged as lost, ref ${request.ref}.`, request.id);
      return done(reply.action, request.id);
    }
    case "skip": {
      await say(`Nothing pending to skip on ref ${request.ref}.`, request.id);
      return done("skip", request.id);
    }
  }

  if (request.status !== "in_progress") { await say(`Ref ${request.ref} is already settled.`, request.id); return done("already_settled", request.id); }
  const claim = await claimRequest(db, request.id, member.id, now);
  if (!claim.ok) { await say(afterTap.alreadyTaken(claim.by?.name ?? "someone"), request.id); return done("taken", request.id); }

  switch (reply.action) {
    case "approve": {
      const cases = reply.cases ?? line?.cases ?? null;
      const price = line?.priceOffered != null ? Number(line.priceOffered) : null;
      const d = await record({ action: "approve", quantity: reply.cases, undoDeadline }, "decision.approve", { cases: reply.cases });
      await say(afterTap.approve(first, cases, price, request.channel, undo), request.id);
      await notifyOtherRecipients(db, request.id, member.id, `approved${cases != null ? ` ${cases} cs` : ""}`, now);
      await inngestSend({ name: "soba/decision.made", data: { decisionId: d.id, requestId: request.id, customerId: member.customerId } });
      return done("approve", request.id);
    }
    case "counter": {
      if (reply.price == null) {
        await setThread(db, member.id, { state: "awaiting_counter", requestId: request.id });
        await say(afterTap.counterAsk(), request.id);
        return done("ask_counter", request.id);
      }
      const d = await record({ action: "counter", counterPrice: reply.price.toFixed(2), quantity: reply.cases, undoDeadline }, "decision.counter", { price: reply.price, cases: reply.cases });
      await say(afterTap.counterSet(first, reply.price, reply.cases, request.channel, undo), request.id);
      await notifyOtherRecipients(db, request.id, member.id, `countered ${fmtMoney(reply.price)}`, now);
      await inngestSend({ name: "soba/decision.made", data: { decisionId: d.id, requestId: request.id, customerId: member.customerId } });
      return done("counter", request.id);
    }
    case "reject": {
      const answeringOurQuestion = thread.state === "awaiting_reason";
      const reasonGiven = reply.reason != null || /^(no|nope|reject)\b.*\S{3,}/i.test(text);
      if (!answeringOurQuestion && !reasonGiven) {
        await setThread(db, member.id, { state: "awaiting_reason", requestId: request.id });
        await say(afterTap.rejectAsk(), request.id);
        return done("ask_reason", request.id);
      }
      const d = await record({ action: "reject", reason: reply.reason, undoDeadline }, "decision.reject", { reason: reply.reason });
      await say(`Telling ${first} we can't fill it${reply.reason ? ` (${reply.reason})` : ""}. ${undo}`, request.id);
      await notifyOtherRecipients(db, request.id, member.id, "rejected", now);
      await inngestSend({ name: "soba/decision.made", data: { decisionId: d.id, requestId: request.id, customerId: member.customerId } });
      return done("reject", request.id);
    }
    case "take_over": {
      await record({ action: "take_over" }, "decision.take_over", {});
      await db.update(schema.requests).set({ decidedById: member.id }).where(eq(schema.requests.id, request.id));
      await say(afterTap.takeOver(request.callerName, request.callbackNumber), request.id);
      await notifyOtherRecipients(db, request.id, member.id, "took it over", now);
      return done("take_over", request.id);
    }
  }
  return done("noop", request.id);
}
