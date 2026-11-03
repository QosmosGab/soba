// The shared path from a finished conversation (call transcript or text thread)
// to a settled request: extract, create or merge, try auto-clear after hours,
// confirm on the spot or send the card. Spam and forwarding tests end here too.
import { and, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { extractRequest, type ExtractedRequest, type ResolvedLine } from "./extract";
import { createRequest, tryAutoClear, toE164 } from "./requests";
import { isOffHours } from "./hours";
import { dispatchCard, loadCustomer } from "./cards";
import { confirmDeal } from "./callbacks";
import { sendToRep } from "./messaging";

export type IntakeInput = {
  customerId: string; channel: "call" | "text"; transcript: string; now: Date;
  callerId?: string | null; providerConversationId?: string | null; transcriptUrl?: string | null;
  /** Already-extracted result (mid-call tool path, tests); otherwise Claude reads the transcript. */
  extracted?: (ExtractedRequest & { resolvedLines: ResolvedLine[] }) | null;
  threadId?: string | null;
};

export type IntakeResult =
  | { outcome: "spam" | "blocked" | "forwarding_test" }
  | { outcome: "merged"; requestId: string; ref: number }
  | { outcome: "auto_cleared" | "card_sent"; requestId: string; ref: number; reason?: string };

/** Our own Twilio numbers calling in = the nightly forwarding test landed. */
async function isForwardingTest(db: Db, customerId: string, callerId: string | null): Promise<boolean> {
  if (!callerId) return false;
  const ours = await db.select().from(schema.lines).where(and(eq(schema.lines.customerId, customerId), eq(schema.lines.twilioNumber, toE164(callerId) ?? callerId)));
  return ours.length > 0;
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

  const products = (await db.select({ product: schema.priceRules.product }).from(schema.priceRules).where(eq(schema.priceRules.customerId, customerId))).map((r) => r.product);
  const extracted = input.extracted ?? await extractRequest(input.transcript, { name: customer.name, timezone: customer.timezone, products: Array.from(new Set(products)), now });

  if (extracted.flags.includes("spam")) {
    await db.insert(schema.events).values({ customerId, type: "intake.spam", payload: { channel: input.channel, callerId: callerE164, summary: extracted.summary } });
    return { outcome: "spam" };
  }
  // Caller ID fills a missing callback number; it is never trusted over what the buyer said.
  if (!extracted.callbackNumber && callerE164) extracted.callbackNumber = callerE164;
  const isTest = callerE164 != null && settings.testNumbers.map((n) => toE164(n)).includes(callerE164);

  const created = await createRequest(db, {
    customerId, channel: input.channel, now, extracted,
    providerConversationId: input.providerConversationId ?? undefined, transcriptUrl: input.transcriptUrl ?? undefined,
  });
  await db.update(schema.requests).set({ transcript: input.transcript, isTest }).where(eq(schema.requests.id, created.request.id));
  if (input.threadId) await db.update(schema.buyerThreads).set({ requestId: created.request.id, state: "done", lastAt: now }).where(eq(schema.buyerThreads.id, input.threadId));

  if (created.merged) {
    // The card can't be edited on WhatsApp; the reps get a one-line notice instead.
    const recipients = await db.select({ memberId: schema.messages.memberId }).from(schema.messages).where(and(eq(schema.messages.requestId, created.request.id), eq(schema.messages.direction, "out")));
    const ids = Array.from(new Set(recipients.map((r) => r.memberId).filter((x): x is string => Boolean(x))));
    for (const id of ids) {
      const [m] = await db.select().from(schema.teamMembers).where(eq(schema.teamMembers.id, id));
      if (m) await sendToRep(db, m, { customerId, requestId: created.request.id, body: `${created.request.callerName ?? "The buyer"} ${input.channel === "call" ? "called" : "texted"} again about ref ${created.request.ref}. Told them it's with the team.`, template: { kind: "notice" }, now });
    }
    return { outcome: "merged", requestId: created.request.id, ref: created.request.ref };
  }

  const request = created.request;
  if (request.status === "auto_cleared") {
    // Cleared mid-call by the tool endpoint; the confirmation already went out there.
    return { outcome: "auto_cleared", requestId: request.id, ref: request.ref };
  }
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
