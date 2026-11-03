// The shared path from a finished conversation (call transcript or text thread)
// to a settled request: extract, create or merge, try auto-clear after hours,
// confirm on the spot or send the card. Spam and forwarding tests end here too.
// A failure to read the transcript still ends as a card: nothing is dropped.
import { and, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { extractRequest } from "./extract";
import { createRequest, derivedFlags, findByConversation, replaceLines, toE164, tryAutoClear, type Extracted } from "./requests";
import { isOffHours } from "./hours";
import { dispatchCard, loadCustomer } from "./cards";
import { confirmDeal } from "./callbacks";
import { sendToRep } from "./messaging";

export type IntakeInput = {
  customerId: string; channel: "call" | "text"; transcript: string; now: Date;
  callerId?: string | null; providerConversationId?: string | null; transcriptUrl?: string | null;
  /** Already-extracted result (mid-call tool path, tests); otherwise the model reads the transcript. */
  extracted?: Extracted | null;
  threadId?: string | null;
};

export type IntakeResult =
  | { outcome: "spam" | "blocked" | "forwarding_test" }
  | { outcome: "merged"; requestId: string; ref: number }
  | { outcome: "auto_cleared" | "card_sent"; requestId: string; ref: number; reason?: string };

/** Our own Twilio numbers calling in = the nightly forwarding test landed. */
async function isForwardingTest(db: Db, customerId: string, callerId: string | null): Promise<boolean> {
  const n = toE164(callerId);
  if (!n) return false;
  const ours = await db.select().from(schema.lines).where(and(eq(schema.lines.customerId, customerId), eq(schema.lines.twilioNumber, n)));
  return ours.length > 0;
}

/** When the model can't read the transcript, the reps still get a card with the raw notes. */
function unreadableExtraction(transcript: string, callerId: string | null, channel: "call" | "text"): Extracted {
  return {
    type: "other", callerName: null, callerCompany: null, callerCity: null, callbackNumber: callerId, callbackPermission: null,
    preferredChannel: channel === "call" ? "call" : "text", lines: [], language: "en", flags: ["unclear"],
    summary: `The desk could not read this ${channel}. Notes: ${transcript.slice(0, 300)}`, complaint: null, resolvedLines: [],
  };
}

export async function handleIntake(db: Db, input: IntakeInput): Promise<IntakeResult> {
  const { customerId, now } = input;
  const { customer, settings } = await loadCustomer(db, customerId);
  const callerE164 = toE164(input.callerId);

  if (await isForwardingTest(db, customerId, input.callerId ?? null)) {
    await db.update(schema.lines).set({ lastForwardingTestAt: now, lastForwardingTestOk: true }).where(and(eq(schema.lines.customerId, customerId), eq(schema.lines.kind, "voice")));
    await db.insert(schema.events).values({ customerId, type: "forwarding.test_ok", payload: { at: now.toISOString() } });
    return { outcome: "forwarding_test" };
  }
  if (callerE164 && settings.blockedNumbers.map((n) => toE164(n)).includes(callerE164)) {
    await db.insert(schema.events).values({ customerId, type: "intake.blocked", payload: { callerId: callerE164 } });
    return { outcome: "blocked" };
  }

  let extracted = input.extracted ?? null;
  if (!extracted) {
    const products = (await db.select({ product: schema.priceRules.product }).from(schema.priceRules).where(eq(schema.priceRules.customerId, customerId))).map((r) => r.product);
    try {
      extracted = await extractRequest(input.transcript, { name: customer.name, timezone: customer.timezone, products: Array.from(new Set(products)), now });
    } catch (err) {
      await db.insert(schema.events).values({ customerId, type: "intake.extract_failed", payload: { channel: input.channel, error: String(err).slice(0, 500) } });
      extracted = unreadableExtraction(input.transcript, callerE164, input.channel);
    }
  }

  if (extracted.flags.includes("spam")) {
    await db.insert(schema.events).values({ customerId, type: "intake.spam", payload: { channel: input.channel, callerId: callerE164, summary: extracted.summary } });
    return { outcome: "spam" };
  }
  // Caller ID fills a missing callback number; it is never trusted over what the buyer said, and a PBX
  // that forwards with the company's own number as caller ID must never make us call the switchboard.
  const own = (await db.select({ n: schema.lines.companyNumber }).from(schema.lines).where(eq(schema.lines.customerId, customerId))).map((l) => toE164(l.n)).filter(Boolean);
  const usableCallerId = callerE164 && !own.includes(callerE164) ? callerE164 : null;
  if (!extracted.callbackNumber && usableCallerId) extracted.callbackNumber = usableCallerId;
  else if (extracted.callbackNumber && own.includes(toE164(extracted.callbackNumber))) extracted.callbackNumber = null;
  const isTest = callerE164 != null && settings.testNumbers.map((n) => toE164(n)).includes(callerE164);

  // The mid-call tool may already have created (and perhaps cleared) this request.
  const existing = await findByConversation(db, customerId, input.providerConversationId);
  let request: typeof schema.requests.$inferSelect;
  if (existing) {
    await db.update(schema.requests).set({ transcript: input.transcript, transcriptUrl: input.transcriptUrl ?? existing.transcriptUrl, language: extracted.language }).where(eq(schema.requests.id, existing.id));
    if (existing.status !== "in_progress") return { outcome: "auto_cleared", requestId: existing.id, ref: existing.ref };
    // Not cleared on the call: the transcript's reading of the order replaces the tool's partial one.
    if (extracted.resolvedLines.length) await replaceLines(db, existing.id, extracted.resolvedLines);
    const flags = derivedFlags(extracted, existing.flags.includes("new_buyer"), isTest);
    await db.update(schema.requests).set({ flags, type: extracted.type, summary: extracted.summary, callerName: extracted.callerName ?? existing.callerName, callerCompany: extracted.callerCompany ?? existing.callerCompany, callbackPermission: extracted.callbackPermission ?? existing.callbackPermission }).where(eq(schema.requests.id, existing.id));
    request = { ...existing, flags, type: extracted.type };
    await dispatchCard(db, request.id, now);
    return { outcome: "card_sent", requestId: request.id, ref: request.ref, reason: "not cleared on the call" };
  }

  const created = await createRequest(db, {
    customerId, channel: input.channel, now, extracted, isTest,
    providerConversationId: input.providerConversationId ?? undefined, transcriptUrl: input.transcriptUrl ?? undefined,
  });
  await db.update(schema.requests).set({ transcript: input.transcript }).where(eq(schema.requests.id, created.request.id));
  if (input.threadId) await db.update(schema.buyerThreads).set({ requestId: created.request.id, state: "done", lastAt: now }).where(eq(schema.buyerThreads.id, input.threadId));

  if (created.merged) {
    // Same buyer again within a few hours. If the reps haven't acted yet, they get a fresh card with the
    // latest version of the order; if someone has, that person gets a notice with what was said.
    const r = created.request;
    const live = await db.select({ id: schema.decisions.id, memberId: schema.decisions.memberId }).from(schema.decisions).where(and(eq(schema.decisions.requestId, r.id), eq(schema.decisions.undone, false))).limit(1);
    const whatNow = extracted.summary || `${extracted.type.replace("_", " ")} by ${input.channel}`;
    if (!live.length) {
      await db.update(schema.requests).set({ summary: whatNow, transcript: [r.transcript, input.transcript].filter(Boolean).join("\n\n---\n\n") }).where(eq(schema.requests.id, r.id));
      await dispatchCard(db, r.id, now);
      return { outcome: "merged", requestId: r.id, ref: r.ref };
    }
    const [m] = live[0].memberId ? await db.select().from(schema.teamMembers).where(eq(schema.teamMembers.id, live[0].memberId)) : [];
    if (m) await sendToRep(db, m, { customerId, requestId: r.id, body: `${r.callerName ?? "The buyer"} ${input.channel === "call" ? "called" : "texted"} again about ref ${r.ref}: ${whatNow}`, template: { kind: "notice" }, now });
    return { outcome: "merged", requestId: r.id, ref: r.ref };
  }

  request = created.request;
  if (extracted.type === "new_order") {
    const offHours = isOffHours(now, settings.hours, customer.timezone, settings.holidays);
    const decision = await tryAutoClear(db, { requestId: request.id, customerId, lines: extracted.resolvedLines, now, offHours, settings });
    if (decision.clear) {
      await confirmDeal(db, { requestId: request.id, now, source: "auto" });
      return { outcome: "auto_cleared", requestId: request.id, ref: request.ref };
    }
    await dispatchCard(db, request.id, now);
    return { outcome: "card_sent", requestId: request.id, ref: request.ref, reason: decision.reason };
  }
  await dispatchCard(db, request.id, now);
  return { outcome: "card_sent", requestId: request.id, ref: request.ref };
}
