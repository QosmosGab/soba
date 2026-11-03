// Who gets a card, sending it, and the notices around it (claimed, called
// again, reminders). Recipients come from the coverage grid for the local
// weekday and time, plus whoever is on call; "everyone" overrides the grid.
import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { cardButtons, cardTemplateVariables, requestCard, afterTap, type CardInput } from "./card";
import type { ResolvedLine } from "./extract";
import { sendToRep, type RepSend } from "./messaging";
import { ringRep } from "./providers/twilio";
import { inngestSend } from "@/inngest/send";

type Member = typeof schema.teamMembers.$inferSelect;

export async function loadCustomer(db: Db, customerId: string) {
  const [customer] = await db.select().from(schema.customers).where(eq(schema.customers.id, customerId));
  const [settings] = await db.select().from(schema.settings).where(eq(schema.settings.customerId, customerId));
  if (!customer || !settings) throw new Error(`Customer ${customerId} not set up`);
  return { customer, settings };
}

function localWeekdayMinutes(now: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hour12: false, hour: "2-digit", minute: "2-digit", weekday: "short" }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return { weekday: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(get("weekday")), minutes: (Number(get("hour")) % 24) * 60 + Number(get("minute")) };
}
const toMin = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };

/** Reps scheduled right now, from the coverage grid; the on-call rep always; everyone when the switch is on. */
export async function cardRecipients(db: Db, customerId: string, now: Date): Promise<Member[]> {
  const { customer, settings } = await loadCustomer(db, customerId);
  const members = await db.select().from(schema.teamMembers).where(and(eq(schema.teamMembers.customerId, customerId), eq(schema.teamMembers.active, true)));
  if (!members.length) return [];
  if (settings.everyoneGetsCards) return members;
  const { weekday, minutes } = localWeekdayMinutes(now, customer.timezone);
  const cov = await db.select().from(schema.coverage).where(inArray(schema.coverage.memberId, members.map((m) => m.id)));
  const scheduled = new Set(cov.filter((c) => c.weekday === weekday && minutes >= toMin(c.start) && minutes < toMin(c.end)).map((c) => c.memberId));
  const out = members.filter((m) => scheduled.has(m.id) || m.isOnCall);
  if (out.length) return out;
  const owner = members.filter((m) => m.isOwner);
  return owner.length ? owner : members;
}

export async function requestToCard(db: Db, requestId: string): Promise<{ card: CardInput; request: typeof schema.requests.$inferSelect; lines: ResolvedLine[]; timezone: string }> {
  const [request] = await db.select().from(schema.requests).where(eq(schema.requests.id, requestId));
  if (!request) throw new Error(`Request ${requestId} not found`);
  const { customer } = await loadCustomer(db, request.customerId);
  const buyer = request.buyerId ? (await db.select().from(schema.buyers).where(eq(schema.buyers.id, request.buyerId)))[0] : null;
  const dbLines = await db.select().from(schema.orderLines).where(eq(schema.orderLines.requestId, requestId));
  const lines: ResolvedLine[] = dbLines.map((l) => ({
    product: l.product, productCanonical: l.notOnSheet ? null : l.product, size: l.size, pack: l.pack, cases: l.cases,
    priceOffered: l.priceOffered != null ? Number(l.priceOffered) : null, pickup: null, pickupDate: l.pickupDate,
    fulfillment: l.fulfillment, destination: l.destination, poNumber: l.poNumber,
  }));
  const repeats = await db.select().from(schema.events).where(and(eq(schema.events.requestId, requestId), eq(schema.events.type, "request.repeat_contact")));
  const card: CardInput = {
    ref: request.ref, channel: request.channel, receivedAt: request.receivedAt, timezone: customer.timezone,
    callerName: request.callerName, callerCompany: request.callerCompany ?? buyer?.company ?? null, callerCity: buyer?.city ?? null,
    callbackNumber: request.callbackNumber, type: request.type, flags: request.flags, summary: request.summary ?? "", lines,
    transcriptUrl: request.transcriptUrl ?? undefined,
    repeatTimes: repeats.map((e) => new Date(String(e.payload.at ?? e.at))),
  };
  return { card, request, lines, timezone: customer.timezone };
}

/** Sends the card to every scheduled rep, logs who got it, rings on call when urgent, and starts the escalation clock. */
export async function dispatchCard(db: Db, requestId: string, now: Date) {
  const { card, request } = await requestToCard(db, requestId);
  const recipients = await cardRecipients(db, request.customerId, now);
  const body = requestCard(card);
  const buttons = cardButtons(request.type);
  const smsBody = `${body}\n\nReply ${buttons.map((b) => b.toUpperCase()).join(", ")}${request.type === "new_order" ? ", a price like 8.50, or plain words" : ""}.`;
  const kind = request.type === "new_order" ? "card" : "card_non_order";
  const variables = cardTemplateVariables(card);
  const nonOrderVariables = { "1": variables["1"], "2": variables["2"], "3": variables["3"], "4": variables["4"], "5": variables["5"], "6": variables["11"] };
  const sent: string[] = [];
  for (const m of recipients) {
    // Only reps allowed to approve get the action buttons; the others see the same card as a notice.
    const template: RepSend["template"] = kind === "card" && m.canApprove ? { kind: "card", variables } : kind === "card_non_order" ? { kind: "card_non_order", variables: nonOrderVariables } : { kind: "notice" };
    try {
      const r = await sendToRep(db, m, { customerId: request.customerId, requestId, body, smsBody: m.canApprove ? smsBody : body, now, template });
      if (r.channel !== "none") sent.push(m.id);
    } catch (err) {
      await db.insert(schema.events).values({ customerId: request.customerId, requestId, type: "message.failed", payload: { memberId: m.id, error: String(err).slice(0, 300) } });
    }
  }
  await db.insert(schema.events).values({ customerId: request.customerId, requestId, type: sent.length ? "card.sent" : "card.no_recipients", payload: { recipients: sent } });
  const urgent = request.flags.includes("urgent") || request.flags.includes("insists_on_person");
  if (urgent) {
    const { settings } = await loadCustomer(db, request.customerId);
    const onCall = recipients.find((m) => m.isOnCall) ?? recipients[0];
    if (settings.urgentRing && onCall?.cell) {
      await ringRep(db, request.customerId, onCall.cell, `This is the desk. An urgent request, reference ${request.ref}, is waiting on WhatsApp.`);
      await db.insert(schema.events).values({ customerId: request.customerId, requestId, type: "card.urgent_ring", payload: { memberId: onCall.id } });
    }
  }
  await inngestSend({ name: "soba/card.sent", data: { requestId, customerId: request.customerId } });
  return { recipients: sent };
}

/** "Ruben took ref 1042: countered $8.50." to everyone else who got the card. */
export async function notifyOtherRecipients(db: Db, requestId: string, byMemberId: string, what: string, now: Date) {
  const [request] = await db.select().from(schema.requests).where(eq(schema.requests.id, requestId));
  const [by] = await db.select().from(schema.teamMembers).where(eq(schema.teamMembers.id, byMemberId));
  if (!request || !by) return;
  const sentTo = await db.select({ memberId: schema.messages.memberId }).from(schema.messages).where(and(eq(schema.messages.requestId, requestId), eq(schema.messages.direction, "out"), eq(schema.messages.party, "rep")));
  const ids = Array.from(new Set(sentTo.map((r) => r.memberId).filter((id): id is string => Boolean(id) && id !== byMemberId)));
  if (!ids.length) return;
  const others = await db.select().from(schema.teamMembers).where(inArray(schema.teamMembers.id, ids));
  for (const m of others) await sendToRep(db, m, { customerId: request.customerId, requestId, body: afterTap.claimed(by.name, request.ref, what), template: { kind: "notice" }, now });
}

/** Reminder to the on-call rep (or everyone who got it) when a card sits unanswered. */
export async function remindOnCard(db: Db, requestId: string, now: Date, stage: "oncall" | "owner") {
  const [request] = await db.select().from(schema.requests).where(eq(schema.requests.id, requestId));
  if (!request || request.status !== "in_progress" || request.claimedById) return false;
  const members = await db.select().from(schema.teamMembers).where(and(eq(schema.teamMembers.customerId, request.customerId), eq(schema.teamMembers.active, true)));
  const targets = stage === "oncall" ? members.filter((m) => m.isOnCall) : members.filter((m) => m.isOwner);
  const list = targets.length ? targets : (stage === "owner" ? members : []);
  const { card } = await requestToCard(db, requestId);
  const body = `Still waiting: ref ${request.ref} from ${card.callerName ?? "a buyer"}${card.callerCompany ? ` at ${card.callerCompany}` : ""}. ${stage === "owner" ? "Nobody answered overnight." : "No reply yet."}\n\n${requestCard(card)}`;
  for (const m of list) await sendToRep(db, m, { customerId: request.customerId, requestId, body, now, template: { kind: "card", variables: cardTemplateVariables({ ...card, flags: [...card.flags, "reminder"] }) } });
  await db.insert(schema.events).values({ customerId: request.customerId, requestId, type: `card.reminder.${stage}`, payload: { recipients: list.map((m) => m.id) } });
  return true;
}
