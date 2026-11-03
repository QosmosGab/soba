// What a rep's message on WhatsApp (or SMS) does: claims the card, records the
// decision with its undo window, asks the one follow-up question (final price,
// reject reason, or a clarification), and tells the other reps.
import { and, desc, eq, gt, inArray, isNull } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { afterTap, fmtMoney } from "./card";
import { notifyOtherRecipients, loadCustomer } from "./cards";
import { sendToRep } from "./messaging";
import { parseRepReply, parseRepReplyFast, type RepReply } from "./reply";
import { inngestSend } from "@/inngest/send";

type Member = typeof schema.teamMembers.$inferSelect;
type Thread = typeof schema.repThreads.$inferSelect;

export async function getThread(db: Db, memberId: string): Promise<Thread> {
  const [t] = await db.select().from(schema.repThreads).where(eq(schema.repThreads.memberId, memberId));
  if (t) return t;
  const [n] = await db.insert(schema.repThreads).values({ memberId }).returning();
  return n;
}

export async function setThread(db: Db, memberId: string, patch: Partial<Thread>) {
  await db.update(schema.repThreads).set({ ...patch, updatedAt: new Date() }).where(eq(schema.repThreads.memberId, memberId));
}

/** The request a reply is about: the button's payload, the thread's live card, else the latest open card this rep got. */
export async function resolveTargetRequest(db: Db, member: Member, thread: Thread, buttonPayload: string | null, text: string) {
  const fromPayload = buttonPayload?.match(/^[a-z_]+:([0-9a-f-]{36})$/i)?.[1];
  const refInText = text.match(/\b(?:ref|#)\s*(\d{4,6})\b/i)?.[1];
  if (fromPayload) return (await db.select().from(schema.requests).where(eq(schema.requests.id, fromPayload)))[0] ?? null;
  if (refInText) {
    const r = await db.select().from(schema.requests).where(and(eq(schema.requests.customerId, member.customerId), eq(schema.requests.ref, Number(refInText))));
    if (r[0]) return r[0];
  }
  if (thread.requestId) {
    const [r] = await db.select().from(schema.requests).where(eq(schema.requests.id, thread.requestId));
    if (r && r.status === "in_progress") return r;
  }
  const sent = await db.select({ requestId: schema.messages.requestId }).from(schema.messages)
    .where(and(eq(schema.messages.memberId, member.id), eq(schema.messages.direction, "out")))
    .orderBy(desc(schema.messages.sentAt)).limit(20);
  const ids = Array.from(new Set(sent.map((s) => s.requestId).filter((x): x is string => Boolean(x))));
  if (!ids.length) return null;
  const open = await db.select().from(schema.requests).where(and(inArray(schema.requests.id, ids), eq(schema.requests.status, "in_progress"))).orderBy(desc(schema.requests.receivedAt));
  return open.find((r) => !r.claimedById || r.claimedById === member.id) ?? open[0] ?? null;
}

/** First answer wins. Returns the claimant when someone else got there first. */
export async function claimRequest(db: Db, requestId: string, memberId: string): Promise<{ ok: true } | { ok: false; by: Member | null }> {
  const updated = await db.update(schema.requests).set({ claimedById: memberId })
    .where(and(eq(schema.requests.id, requestId), eq(schema.requests.status, "in_progress"), eq(schema.requests.claimedById, memberId)))
    .returning({ id: schema.requests.id });
  if (updated.length) return { ok: true };
  const fresh = await db.update(schema.requests).set({ claimedById: memberId })
    .where(and(eq(schema.requests.id, requestId), eq(schema.requests.status, "in_progress"), isNull(schema.requests.claimedById)))
    .returning({ id: schema.requests.id });
  if (fresh.length) return { ok: true };
  const [r] = await db.select().from(schema.requests).where(eq(schema.requests.id, requestId));
  if (r?.claimedById === memberId) return { ok: true };
  const by = r?.claimedById ? (await db.select().from(schema.teamMembers).where(eq(schema.teamMembers.id, r.claimedById)))[0] ?? null : null;
  return { ok: false, by };
}

export type RepMessageResult = { replies: string[]; action: string; requestId: string | null };

/**
 * One inbound message from a rep. `buttonPayload` is the quick-reply id (e.g. "approve:<requestId>")
 * when a button was tapped; `text` is what they typed or the button's label.
 */
export async function handleRepMessage(db: Db, args: { member: Member; text: string; buttonPayload?: string | null; now: Date }): Promise<RepMessageResult> {
  const { member, now } = args;
  const text = args.text.trim();
  const thread = await getThread(db, member.id);
  const { settings } = await loadCustomer(db, member.customerId);
  const replies: string[] = [];
  const say = async (body: string, requestId?: string | null) => { replies.push(body); await sendToRep(db, member, { customerId: member.customerId, requestId: requestId ?? null, body, template: { kind: "notice" }, now }); };

  const request = await resolveTargetRequest(db, member, thread, args.buttonPayload ?? null, text);
  const line = request ? (await db.select().from(schema.orderLines).where(eq(schema.orderLines.requestId, request.id)))[0] : null;
  const first = request?.callerName?.split(" ")[0] ?? "the buyer";
  const ctx = { buyerFirst: first, cases: line?.cases ?? null, priceOffered: line?.priceOffered != null ? Number(line.priceOffered) : null };

  // Follow-up answers to a question we asked.
  let reply: RepReply;
  const buttonAction = args.buttonPayload?.split(":")[0] ?? null;
  if (buttonAction && ["approve", "counter", "reject", "take_over", "undo", "won", "lost", "skip"].includes(buttonAction)) {
    reply = { action: buttonAction as RepReply["action"], cases: null, price: null, reason: null, clarify: null };
  } else if (thread.state === "awaiting_counter" && request) {
    const fast = parseRepReplyFast(text);
    if (fast?.action === "counter") reply = fast;
    else if (fast?.action === "undo" || /^(cancel|never mind|nevermind|forget it)$/i.test(text)) { await setThread(db, member.id, { state: "idle" }); await say(`OK, no counter sent. Ref ${request.ref} is still open.`, request.id); return { replies, action: "cancelled", requestId: request.id }; }
    else {
      const parsed = await parseRepReply(text, ctx);
      if (parsed.action === "counter" && parsed.price != null) reply = parsed;
      else { await say(`What's the final price for ${first}? Reply like "8.50" or "8.50 max 200".`, request.id); return { replies, action: "ask_counter_again", requestId: request.id }; }
    }
  } else if (thread.state === "awaiting_reason" && request) {
    const skip = /^(skip|none|no reason|-|no)$/i.test(text);
    reply = { action: "reject", cases: null, price: null, reason: skip ? null : text, clarify: null };
  } else {
    reply = await parseRepReply(text, ctx);
  }

  if (!request) {
    if (reply.action === "acknowledged") return { replies, action: "acknowledged", requestId: null };
    await say("No open request is waiting on you right now.");
    return { replies, action: "no_request", requestId: null };
  }
  if (!member.canApprove && ["approve", "counter", "reject"].includes(reply.action)) {
    await say(`Your account can't approve orders. Reply TAKE to take ref ${request.ref} over, or ask a manager.`, request.id);
    return { replies, action: "not_allowed", requestId: request.id };
  }

  const undoDeadline = new Date(now.getTime() + settings.undoSeconds * 1000);
  const undoWord = `Reply UNDO within ${Math.round(settings.undoSeconds / 60)} minutes to stop.`;

  switch (reply.action) {
    case "undo": {
      const [d] = await db.select().from(schema.decisions).where(and(eq(schema.decisions.requestId, request.id), eq(schema.decisions.undone, false), gt(schema.decisions.undoDeadline, now))).orderBy(desc(schema.decisions.createdAt)).limit(1);
      if (!d) { await say(`Nothing to undo on ref ${request.ref}: the desk already acted, or there was no decision.`, request.id); return { replies, action: "nothing_to_undo", requestId: request.id }; }
      await db.update(schema.decisions).set({ undone: true }).where(eq(schema.decisions.id, d.id));
      await db.insert(schema.events).values({ customerId: member.customerId, requestId: request.id, type: "decision.undone", payload: { decisionId: d.id, by: member.id } });
      await setThread(db, member.id, { state: "idle", requestId: request.id });
      await say(`Undone. Ref ${request.ref} is open again: Approve, Counter, Reject or Take over.`, request.id);
      return { replies, action: "undone", requestId: request.id };
    }
    case "acknowledged": {
      await db.insert(schema.events).values({ customerId: member.customerId, requestId: request.id, type: "rep.acknowledged", payload: { by: member.id, text } });
      await setThread(db, member.id, { requestId: request.id });
      return { replies, action: "acknowledged", requestId: request.id };
    }
    case "unclear": {
      await setThread(db, member.id, { state: "awaiting_clarify", requestId: request.id });
      await say(reply.clarify ?? "Sorry, I didn't get that. Approve, counter with a price, reject, or take over?", request.id);
      return { replies, action: "clarify", requestId: request.id };
    }
    case "won": case "lost": {
      if (request.claimedById && request.claimedById !== member.id) { const c = await claimRequest(db, request.id, member.id); if (!c.ok) { await say(afterTap.alreadyTaken(c.by?.name ?? "someone"), request.id); return { replies, action: "taken", requestId: request.id }; } }
      await db.insert(schema.decisions).values({ requestId: request.id, memberId: member.id, action: reply.action, createdAt: now });
      await db.update(schema.requests).set({ status: reply.action === "won" ? "approved" : "rejected", decidedById: member.id, takeOverOutcome: reply.action, assisted: reply.action === "won" }).where(eq(schema.requests.id, request.id));
      await db.insert(schema.events).values({ customerId: member.customerId, requestId: request.id, type: `takeover.${reply.action}`, payload: { by: member.id } });
      await setThread(db, member.id, { state: "idle" });
      await say(reply.action === "won" ? `Logged as won, ref ${request.ref}. Nice.` : `Logged as lost, ref ${request.ref}.`, request.id);
      return { replies, action: reply.action, requestId: request.id };
    }
  }

  if (request.status !== "in_progress") { await say(`Ref ${request.ref} is already settled.`, request.id); return { replies, action: "already_settled", requestId: request.id }; }
  const claim = await claimRequest(db, request.id, member.id);
  if (!claim.ok) { await say(afterTap.alreadyTaken(claim.by?.name ?? "someone"), request.id); return { replies, action: "taken", requestId: request.id }; }

  switch (reply.action) {
    case "approve": {
      const [d] = await db.insert(schema.decisions).values({ requestId: request.id, memberId: member.id, action: "approve", quantity: reply.cases, undoDeadline, createdAt: now }).returning();
      await db.insert(schema.events).values({ customerId: member.customerId, requestId: request.id, type: "decision.approve", payload: { by: member.id, cases: reply.cases } });
      await setThread(db, member.id, { state: "idle", requestId: request.id });
      const cases = reply.cases ?? line?.cases ?? null;
      const price = line?.priceOffered != null ? Number(line.priceOffered) : null;
      await say(afterTap.approve(first, cases, price, request.channel).replace("Reply UNDO within 2 minutes to stop.", undoWord), request.id);
      await notifyOtherRecipients(db, request.id, member.id, `approved${cases != null ? ` ${cases} cs` : ""}`, now);
      await inngestSend({ name: "soba/decision.made", data: { decisionId: d.id, requestId: request.id, customerId: member.customerId } });
      return { replies, action: "approve", requestId: request.id };
    }
    case "counter": {
      if (reply.price == null) {
        await setThread(db, member.id, { state: "awaiting_counter", requestId: request.id });
        await say(afterTap.counterAsk(), request.id);
        return { replies, action: "ask_counter", requestId: request.id };
      }
      const [d] = await db.insert(schema.decisions).values({ requestId: request.id, memberId: member.id, action: "counter", counterPrice: reply.price.toFixed(2), quantity: reply.cases, undoDeadline, createdAt: now }).returning();
      await db.insert(schema.events).values({ customerId: member.customerId, requestId: request.id, type: "decision.counter", payload: { by: member.id, price: reply.price, cases: reply.cases } });
      await setThread(db, member.id, { state: "idle", requestId: request.id });
      await say(afterTap.counterSet(first, reply.price, reply.cases, request.channel).replace("Reply UNDO within 2 minutes to stop.", undoWord), request.id);
      await notifyOtherRecipients(db, request.id, member.id, `countered ${fmtMoney(reply.price)}`, now);
      await inngestSend({ name: "soba/decision.made", data: { decisionId: d.id, requestId: request.id, customerId: member.customerId } });
      return { replies, action: "counter", requestId: request.id };
    }
    case "reject": {
      if (thread.state !== "awaiting_reason" && reply.reason == null && !buttonAction && !/^(no|nope|reject)\b.*\S{3,}/i.test(text)) {
        await setThread(db, member.id, { state: "awaiting_reason", requestId: request.id });
        await say(afterTap.rejectAsk(), request.id);
        return { replies, action: "ask_reason", requestId: request.id };
      }
      if (thread.state !== "awaiting_reason" && buttonAction === "reject") {
        await setThread(db, member.id, { state: "awaiting_reason", requestId: request.id });
        await say(afterTap.rejectAsk(), request.id);
        return { replies, action: "ask_reason", requestId: request.id };
      }
      const [d] = await db.insert(schema.decisions).values({ requestId: request.id, memberId: member.id, action: "reject", reason: reply.reason, undoDeadline, createdAt: now }).returning();
      await db.insert(schema.events).values({ customerId: member.customerId, requestId: request.id, type: "decision.reject", payload: { by: member.id, reason: reply.reason } });
      await setThread(db, member.id, { state: "idle", requestId: request.id });
      await say(`Telling ${first} we can't fill it${reply.reason ? ` (${reply.reason})` : ""}. ${undoWord}`, request.id);
      await notifyOtherRecipients(db, request.id, member.id, "rejected", now);
      await inngestSend({ name: "soba/decision.made", data: { decisionId: d.id, requestId: request.id, customerId: member.customerId } });
      return { replies, action: "reject", requestId: request.id };
    }
    case "take_over": {
      await db.insert(schema.decisions).values({ requestId: request.id, memberId: member.id, action: "take_over", createdAt: now });
      await db.update(schema.requests).set({ decidedById: member.id }).where(eq(schema.requests.id, request.id));
      await db.insert(schema.events).values({ customerId: member.customerId, requestId: request.id, type: "decision.take_over", payload: { by: member.id } });
      await setThread(db, member.id, { state: "idle", requestId: request.id });
      await say(afterTap.takeOver(request.callerName, request.callbackNumber), request.id);
      await notifyOtherRecipients(db, request.id, member.id, "took it over", now);
      return { replies, action: "take_over", requestId: request.id };
    }
    case "skip": {
      await say(`Nothing pending to skip on ref ${request.ref}.`, request.id);
      return { replies, action: "skip", requestId: request.id };
    }
  }
  return { replies, action: "noop", requestId: request.id };
}
