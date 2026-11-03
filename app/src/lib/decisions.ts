// What a rep's message on WhatsApp (or SMS) does: claims the card, records the
// decision with its undo window, asks the one follow-up question (final price or
// reject reason), and tells the other reps. When two cards are open and the reply
// doesn't say which, it asks rather than guessing.
import { and, desc, eq, gt, inArray, isNotNull, isNull, lt, or } from "drizzle-orm";
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
/** A question we asked ("your final price?") is forgotten after this long; the next line is read fresh. */
export const QUESTION_TTL_MS = 10 * 60 * 1000;
const ACTIONS = ["approve", "counter", "reject", "take_over", "undo", "won", "lost", "skip"] as const;
const DECIDING = ["approve", "counter", "reject"];
// States where the rep's next line is about the card we just spoke to them about.
const WAITING = ["awaiting_counter", "awaiting_reason", "awaiting_followup"];

export async function getThread(db: Db, memberId: string): Promise<Thread> {
  const [t] = await db.select().from(schema.repThreads).where(eq(schema.repThreads.memberId, memberId));
  if (t) return t;
  const [n] = await db.insert(schema.repThreads).values({ memberId }).returning();
  return n;
}

export async function setThread(db: Db, memberId: string, patch: Partial<Thread>, now = new Date()) {
  await db.update(schema.repThreads).set({ ...patch, updatedAt: now }).where(eq(schema.repThreads.memberId, memberId));
}

/** A card still waiting for a rep's decision: open, and nothing on its way to the buyer (a decision still inside its undo window can be replaced). */
async function isOpenCard(db: Db, r: Request): Promise<boolean> {
  if (r.status !== "in_progress") return false;
  const live = await db.select({ id: schema.decisions.id }).from(schema.decisions).where(and(eq(schema.decisions.requestId, r.id), eq(schema.decisions.undone, false),
    or(eq(schema.decisions.action, "take_over"), isNotNull(schema.decisions.executedAt)))).limit(1);
  return live.length === 0;
}

/** Nobody has decided anything on it yet (a decision inside its undo window still counts as decided here). */
async function isUndecided(db: Db, r: Request): Promise<boolean> {
  if (r.status !== "in_progress") return false;
  const any = await db.select({ id: schema.decisions.id }).from(schema.decisions).where(and(eq(schema.decisions.requestId, r.id), eq(schema.decisions.undone, false))).limit(1);
  return any.length === 0;
}

/** The undecided cards this rep received, newest first. */
async function openCardsFor(db: Db, member: Member): Promise<Request[]> {
  const sent = await db.select({ requestId: schema.messages.requestId }).from(schema.messages)
    .where(and(eq(schema.messages.memberId, member.id), eq(schema.messages.direction, "out"))).orderBy(desc(schema.messages.sentAt)).limit(40);
  const ids = Array.from(new Set(sent.map((s) => s.requestId).filter((x): x is string => Boolean(x))));
  if (!ids.length) return [];
  const open = await db.select().from(schema.requests).where(and(inArray(schema.requests.id, ids), eq(schema.requests.customerId, member.customerId), eq(schema.requests.status, "in_progress"))).orderBy(desc(schema.requests.receivedAt));
  const out: Request[] = [];
  for (const r of open) if (await isUndecided(db, r)) out.push(r);
  return out;
}

type Target = { request: Request | null; ambiguous: Request[] };

/**
 * The request a reply is about: the button's payload, a "ref 1042" in the text, the card we
 * asked a question about, else the one open card. Two or more open cards and no hint → ambiguous.
 */
export async function resolveTargetRequest(db: Db, member: Member, thread: Thread, buttonPayload: string | null, text: string, now: Date): Promise<Target> {
  const own = (r: Request | undefined) => (r && r.customerId === member.customerId ? r : null);
  const fromPayload = buttonPayload?.match(/^[a-z_]+:([0-9a-f-]{36})$/i)?.[1];
  if (fromPayload) return { request: own((await db.select().from(schema.requests).where(eq(schema.requests.id, fromPayload)))[0]), ambiguous: [] };
  const refInText = text.match(/\b(?:ref|#)?\s*(\d{4,6})\b/i)?.[1];
  if (refInText) {
    const [r] = await db.select().from(schema.requests).where(and(eq(schema.requests.customerId, member.customerId), eq(schema.requests.ref, Number(refInText))));
    if (r) return { request: r, ambiguous: [] };
  }
  // A price or a yes right after the rep's own decision, still inside its undo window, replaces that decision.
  if (thread.requestId) {
    const [mine] = await db.select().from(schema.decisions).where(and(eq(schema.decisions.requestId, thread.requestId), eq(schema.decisions.memberId, member.id), eq(schema.decisions.undone, false), isNull(schema.decisions.executedAt), gt(schema.decisions.undoDeadline, now))).limit(1);
    if (mine) { const r = own((await db.select().from(schema.requests).where(eq(schema.requests.id, thread.requestId)))[0]); if (r) return { request: r, ambiguous: [] }; }
  }
  // UNDO, WON and LOST are about the rep's own latest decision, whatever cards are open.
  const hint = parseRepReplyFast(text)?.action;
  if (hint === "undo" || hint === "won" || hint === "lost") {
    const [d] = await db.select().from(schema.decisions).innerJoin(schema.requests, eq(schema.requests.id, schema.decisions.requestId))
      .where(and(eq(schema.decisions.memberId, member.id), eq(schema.requests.customerId, member.customerId), eq(schema.decisions.undone, false), gt(schema.decisions.createdAt, new Date(now.getTime() - 60 * 60 * 1000)),
        hint === "undo" ? inArray(schema.decisions.action, ["approve", "counter", "reject"]) : eq(schema.decisions.action, "take_over")))
      .orderBy(desc(schema.decisions.createdAt)).limit(1);
    if (d) return { request: d.requests, ambiguous: [] };
  }
  const asking = WAITING.includes(thread.state) && now.getTime() - thread.updatedAt.getTime() < QUESTION_TTL_MS;
  if (asking && thread.requestId) {
    const r = own((await db.select().from(schema.requests).where(eq(schema.requests.id, thread.requestId)))[0]);
    if (r && r.status === "in_progress") return { request: r, ambiguous: [] };
  }
  const open = await openCardsFor(db, member);
  const mine = open.filter((r) => r.claimedById === member.id);
  if (mine.length === 1) return { request: mine[0], ambiguous: [] };
  if (open.length === 1) return { request: open[0], ambiguous: [] };
  if (open.length > 1) return { request: null, ambiguous: open };
  // Nothing open: undo / won / lost may still refer to the last card we touched.
  if (thread.requestId) {
    const r = own((await db.select().from(schema.requests).where(eq(schema.requests.id, thread.requestId)))[0]);
    if (r) return { request: r, ambiguous: [] };
  }
  return { request: null, ambiguous: [] };
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
  return db.select().from(schema.decisions).where(and(eq(schema.decisions.requestId, requestId), eq(schema.decisions.undone, false), isNull(schema.decisions.executedAt), gt(schema.decisions.undoDeadline, now))).orderBy(desc(schema.decisions.createdAt));
}

async function memberName(db: Db, id: string | null) {
  if (!id) return null;
  const [m] = await db.select({ name: schema.teamMembers.name }).from(schema.teamMembers).where(eq(schema.teamMembers.id, id));
  return m?.name ?? null;
}

const short = (r: Request) => `ref ${r.ref} (${r.callerName?.split(" ")[0] ?? r.callerCompany ?? "unknown"})`;

export type RepMessageResult = { replies: string[]; action: string; requestId: string | null };

/**
 * One inbound message from a rep. `buttonPayload` is the quick-reply id (e.g. "approve:<requestId>")
 * when a button was tapped; `text` is what they typed or the button's label. `silent` (panel) records
 * the replies without sending them.
 */
export async function handleRepMessage(db: Db, args: { member: Member; text: string; buttonPayload?: string | null; now: Date; silent?: boolean }): Promise<RepMessageResult> {
  const { member, now } = args;
  const thread = await getThread(db, member.id);
  const { settings } = await loadCustomer(db, member.customerId);
  const replies: string[] = [];
  const say = async (body: string, requestId?: string | null) => { replies.push(body); if (args.silent) return; await sendToRep(db, member, { customerId: member.customerId, requestId: requestId ?? null, body, template: { kind: "notice" }, now }); };
  const done = (action: string, requestId: string | null = null): RepMessageResult => ({ replies, action, requestId });

  const target = await resolveTargetRequest(db, member, thread, args.buttonPayload ?? null, args.text.trim(), now);
  const request = target.request;
  // "1042 yes" names the card; what is parsed is the "yes".
  const refMatch = args.text.trim().match(/\b(?:ref|#)?\s*(\d{4,6})\b/i);
  const text = request && refMatch && Number(refMatch[1]) === request.ref ? args.text.trim().replace(refMatch[0], " ").replace(/\s+/g, " ").trim() : args.text.trim();
  const lines = request ? await db.select().from(schema.orderLines).where(eq(schema.orderLines.requestId, request.id)) : [];
  const line = lines[0] ?? null;
  const first = request?.callerName?.split(" ")[0] ?? "the buyer";
  const ctx = { buyerFirst: first, cases: line?.cases ?? null, priceOffered: line?.priceOffered != null ? Number(line.priceOffered) : null };
  const buttonAction = args.buttonPayload?.split(":")[0] ?? null;
  const asking = request != null && thread.requestId === request.id && WAITING.includes(thread.state) && now.getTime() - thread.updatedAt.getTime() < QUESTION_TTL_MS;

  // What the rep means: a button, an answer to our question, or free text.
  let reply: RepReply;
  if (buttonAction && (ACTIONS as readonly string[]).includes(buttonAction)) {
    reply = { action: buttonAction as RepReply["action"], cases: null, price: null, reason: null, clarify: null };
  } else if (asking && thread.state === "awaiting_counter") {
    const fast = parseRepReplyFast(text);
    if (fast?.action === "counter") reply = fast;
    else if (fast && ["approve", "reject", "take_over", "undo"].includes(fast.action)) reply = fast; // changed their mind
    else if (/^(cancel|never mind|nevermind|forget it)$/i.test(text)) { await setThread(db, member.id, { state: "idle" }, now); await say(`OK, no counter sent. ${short(request!)} is still open.`, request!.id); return done("cancelled", request!.id); }
    else {
      const parsed = await parseRepReply(text, ctx);
      if (parsed.action === "counter" && parsed.price != null) reply = parsed;
      else { await say(`What's the final price for ${first}? Reply like "8.50" or "8.50 max 200".`, request!.id); return done("ask_counter_again", request!.id); }
    }
  } else if (asking && thread.state === "awaiting_reason") {
    const skip = /^(skip|none|no reason|-|no)$/i.test(text);
    reply = { action: "reject", cases: null, price: null, reason: skip ? null : text, clarify: null };
  } else {
    reply = await parseRepReply(text, ctx);
  }

  if (!request) {
    if (reply.action === "acknowledged") return done("acknowledged");
    if (target.ambiguous.length) {
      await say(`Which one? ${target.ambiguous.map(short).join(" or ")}. Reply with the ref, e.g. "${target.ambiguous[0].ref} ${reply.action === "unclear" ? "yes" : text}".`);
      return done("which_one");
    }
    await say("No open request is waiting on you right now.");
    return done("no_request");
  }

  // Guards before anything is recorded. The thread remembers the card so the rep's next line lands on it.
  const isOrder = request.type === "new_order";
  if (DECIDING.includes(reply.action)) {
    await setThread(db, member.id, { state: "awaiting_followup", requestId: request.id }, now);
    if (!isOrder) { await say(`Ref ${request.ref} isn't a new order (${request.type.replace("_", " ")}). Reply TAKE to take it over.`, request.id); return done("not_an_order", request.id); }
    if (!member.canApprove) { await say(`Your account can't approve orders. Reply TAKE to take ref ${request.ref} over, or ask a manager.`, request.id); return done("not_allowed", request.id); }
    if (request.status === "in_progress" && !(await isOpenCard(db, request))) {
      const by = await memberName(db, request.decidedById ?? request.claimedById);
      await say(`Ref ${request.ref} is already with the buyer${by ? ` (${by} decided)` : ""}: the desk is confirming it now. Reply UNDO if that's wrong, or wait for the answer.`, request.id);
      return done("in_flight", request.id);
    }
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
    if (reply.action === "counter" && reply.price != null && line?.cases == null && reply.cases == null) {
      await say(`How many cases at ${fmtMoney(reply.price)}? Reply like "${reply.price.toFixed(2)} max 200".`, request.id);
      return done("counter_needs_cases", request.id);
    }
    if (reply.cases != null && reply.cases < 1) { await say(`How many cases? Reply like "yes but only 200".`, request.id); return done("bad_cases", request.id); }
  }

  const undoDeadline = new Date(now.getTime() + settings.undoSeconds * 1000);
  const undo = undoWord(settings.undoSeconds);
  const record = async (values: Omit<typeof schema.decisions.$inferInsert, "requestId" | "memberId" | "createdAt">, eventType: string, payload: Record<string, unknown>) => {
    // A new decision inside someone's undo window replaces it: only one thing reaches the buyer.
    for (const p of await pendingDecisions(db, request.id, now)) await db.update(schema.decisions).set({ undone: true }).where(eq(schema.decisions.id, p.id));
    const [d] = await db.insert(schema.decisions).values({ requestId: request.id, memberId: member.id, createdAt: now, ...values }).returning();
    await db.update(schema.requests).set({ decidedById: member.id }).where(eq(schema.requests.id, request.id));
    await db.insert(schema.events).values({ customerId: member.customerId, requestId: request.id, type: eventType, payload: { by: member.id, ...payload } });
    await setThread(db, member.id, { state: "idle", requestId: request.id }, now);
    return d;
  };

  switch (reply.action) {
    case "undo": {
      const [d] = await pendingDecisions(db, request.id, now);
      if (!d) {
        const [spent] = await db.select().from(schema.decisions).where(and(eq(schema.decisions.requestId, request.id), eq(schema.decisions.undone, false), isNotNull(schema.decisions.executedAt))).orderBy(desc(schema.decisions.createdAt)).limit(1);
        if (spent) { await say(`Too late: the desk is already ${spent.action === "reject" ? "telling" : "calling"} ${first} on ref ${request.ref}. Reply TAKE to step in.`, request.id); return done("too_late", request.id); }
        await say(`Nothing to undo on ref ${request.ref}.`, request.id); return done("nothing_to_undo", request.id);
      }
      if (d.memberId !== member.id && !member.canEditSettings) { await say(`That decision was someone else's. Only they, or a manager, can undo it.`, request.id); return done("not_yours", request.id); }
      // Guarded: the timer may be executing it this very second.
      const undone = await db.update(schema.decisions).set({ undone: true }).where(and(eq(schema.decisions.id, d.id), isNull(schema.decisions.executedAt))).returning({ id: schema.decisions.id });
      if (!undone.length) { await say(`Too late: the desk is already ${d.action === "reject" ? "telling" : "calling"} ${first}.`, request.id); return done("too_late", request.id); }
      await db.update(schema.requests).set({ claimedById: null, claimedAt: null, decidedById: null }).where(eq(schema.requests.id, request.id));
      await db.insert(schema.events).values({ customerId: member.customerId, requestId: request.id, type: "decision.undone", payload: { decisionId: d.id, by: member.id } });
      await setThread(db, member.id, { state: "idle", requestId: request.id }, now);
      await say(`Undone. Ref ${request.ref} is open again: Approve, Counter, Reject or Take over.`, request.id);
      await notifyOtherRecipients(db, request.id, member.id, "undid that; it's open again", now);
      return done("undone", request.id);
    }
    case "acknowledged": {
      await db.insert(schema.events).values({ customerId: member.customerId, requestId: request.id, type: "rep.acknowledged", payload: { by: member.id, text } });
      await setThread(db, member.id, { requestId: request.id }, now);
      return done("acknowledged", request.id);
    }
    case "unclear": {
      await setThread(db, member.id, { state: "awaiting_followup", requestId: request.id }, now);
      await say(reply.clarify ?? `On ref ${request.ref}: approve, counter with a price, reject, or take over?`, request.id);
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
      await setThread(db, member.id, { state: "idle" }, now);
      await say(reply.action === "won" ? `Logged as won, ref ${request.ref}. Nice.` : `Logged as lost, ref ${request.ref}.`, request.id);
      return done(reply.action, request.id);
    }
    case "skip": {
      await say(`Nothing pending to skip on ref ${request.ref}.`, request.id);
      return done("skip", request.id);
    }
    case "take_over": {
      // Allowed on an open card and on a request the buyer declined (the rep can still rescue it).
      const rescuable = request.status === "rejected" && !request.takeOverOutcome;
      if (request.status !== "in_progress" && !rescuable) { await say(`Ref ${request.ref} is already settled.`, request.id); return done("already_settled", request.id); }
      if (rescuable) await db.update(schema.requests).set({ status: "in_progress", claimedById: member.id, claimedAt: now }).where(eq(schema.requests.id, request.id));
      else { const claim = await claimRequest(db, request.id, member.id, now); if (!claim.ok) { await say(afterTap.alreadyTaken(claim.by?.name ?? "someone"), request.id); return done("taken", request.id); } }
      await record({ action: "take_over" }, "decision.take_over", {});
      await say(afterTap.takeOver(request.callerName, request.callbackNumber), request.id);
      await notifyOtherRecipients(db, request.id, member.id, "took it over", now);
      return done("take_over", request.id);
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
        await setThread(db, member.id, { state: "awaiting_counter", requestId: request.id }, now);
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
      const reasonGiven = reply.reason != null || /^(no|nope|reject)\b.*\S{3,}/i.test(text);
      if (!(asking && thread.state === "awaiting_reason") && !reasonGiven) {
        await setThread(db, member.id, { state: "awaiting_reason", requestId: request.id }, now);
        await say(afterTap.rejectAsk(), request.id);
        return done("ask_reason", request.id);
      }
      const d = await record({ action: "reject", reason: reply.reason, undoDeadline }, "decision.reject", { reason: reply.reason });
      await say(`Telling ${first} we can't fill it${reply.reason ? ` (${reply.reason})` : ""}. ${undo}`, request.id);
      await notifyOtherRecipients(db, request.id, member.id, "rejected", now);
      await inngestSend({ name: "soba/decision.made", data: { decisionId: d.id, requestId: request.id, customerId: member.customerId } });
      return done("reject", request.id);
    }
  }
  return done("noop", request.id);
}
