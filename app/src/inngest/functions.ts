// Timers: the undo window, card escalation, callback retries, and the nightly
// clock (same-prices prompt, forwarding test, morning summary) that runs every
// five minutes and fires whatever is due per customer, idempotently.
import { and, eq, gte, inArray, isNotNull, lt } from "drizzle-orm";
import { inngest } from "./client";
import { getDb, schema } from "@/db";
import { executeDecision, retryCallback } from "@/lib/callbacks";
import { remindOnCard, loadCustomer } from "@/lib/cards";
import { nextOpening } from "@/lib/hours";
import { sendMorningSummary } from "@/lib/summary";
import { samePricesPromptText } from "@/lib/rules";
import { setThread, getThread } from "@/lib/decisions";
import { sendToRep } from "@/lib/messaging";
import { placeForwardingTest } from "@/lib/providers/twilio";

export const decisionTimer = inngest.createFunction(
  { id: "decision-undo-window", triggers: [{ event: "soba/decision.made" }] },
  async ({ event, step }) => {
    const { decisionId } = event.data as { decisionId: string };
    const deadline = await step.run("read-deadline", async () => {
      const db = await getDb();
      const [d] = await db.select().from(schema.decisions).where(eq(schema.decisions.id, decisionId));
      return d?.undoDeadline?.toISOString() ?? null;
    });
    if (deadline) await step.sleepUntil("undo-window", new Date(deadline));
    return step.run("execute", async () => executeDecision(await getDb(), decisionId, new Date()));
  },
);

export const cardEscalation = inngest.createFunction(
  { id: "card-escalation", triggers: [{ event: "soba/card.sent" }] },
  async ({ event, step }) => {
    const { requestId, customerId } = event.data as { requestId: string; customerId: string };
    const minutes = await step.run("settings", async () => (await loadCustomer(await getDb(), customerId)).settings.escalationMinutes);
    await step.sleep("wait-for-reply", `${minutes}m`);
    const reminded = await step.run("remind-on-call", async () => remindOnCard(await getDb(), requestId, new Date(), "oncall"));
    if (!reminded) return { done: "claimed" };
    const opening = await step.run("next-opening", async () => {
      const db = await getDb();
      const { customer, settings } = await loadCustomer(db, customerId);
      return nextOpening(new Date(), settings.hours, customer.timezone, settings.holidays).toISOString();
    });
    await step.sleepUntil("until-opening", new Date(opening));
    return step.run("remind-owner", async () => remindOnCard(await getDb(), requestId, new Date(), "owner"));
  },
);

export const callbackRetry = inngest.createFunction(
  { id: "callback-retry", triggers: [{ event: "soba/callback.retry" }] },
  async ({ event, step }) => {
    await step.sleep("wait", "10m");
    return step.run("retry", async () => retryCallback(await getDb(), (event.data as { callbackId: string }).callbackId, new Date()));
  },
);

function localHHMM(d: Date, tz: string) {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour12: false, hour: "2-digit", minute: "2-digit", weekday: "short", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
  const g = (k: string) => p.find((x) => x.type === k)!.value;
  return { minutes: (Number(g("hour")) % 24) * 60 + Number(g("minute")), weekday: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(g("weekday")), iso: `${g("year")}-${g("month")}-${g("day")}` };
}
const toMin = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };

/** Everything on a clock, checked every five minutes for every live customer. */
export async function nightlyTick(now = new Date()) {
  const db = await getDb();
  const customers = await db.select().from(schema.customers).where(eq(schema.customers.status, "live"));
  const out: Record<string, string[]> = {};
  for (const c of customers) {
    const did: string[] = [];
    const [settings] = await db.select().from(schema.settings).where(eq(schema.settings.customerId, c.id));
    if (!settings) continue;
    const { minutes, weekday, iso } = localHHMM(now, c.timezone);
    const day = settings.hours[["mon", "tue", "wed", "thu", "fri", "sat", "sun"][weekday]];
    const dayStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const doneToday = async (type: string) => (await db.select().from(schema.events).where(and(eq(schema.events.customerId, c.id), eq(schema.events.type, type), gte(schema.events.at, dayStart)))).some((e) => e.payload.day === iso);
    const mark = (type: string, extra: Record<string, unknown> = {}) => db.insert(schema.events).values({ customerId: c.id, type, payload: { day: iso, ...extra } });
    const within = (hhmm: string) => minutes >= toMin(hhmm) && minutes < toMin(hhmm) + 10;

    // Same prices? (price-setters), at the configured local time.
    if (within(settings.samePricesPromptTime) && !(await doneToday("rules.same_prompted"))) {
      const text = await samePricesPromptText(db, c.id, now);
      if (text) {
        const setters = await db.select().from(schema.teamMembers).where(and(eq(schema.teamMembers.customerId, c.id), eq(schema.teamMembers.canSetPrices, true), eq(schema.teamMembers.active, true)));
        for (const m of setters) { await getThread(db, m.id); await setThread(db, m.id, { state: "awaiting_same_prices" }); await sendToRep(db, m, { customerId: c.id, body: text, template: { kind: "same_prices" }, now }); }
      }
      await mark("rules.same_prompted", { sent: Boolean(text) });
      did.push("same_prices_prompt");
    }
    // Forwarding test at closing.
    if (day && !day.closed && within(day.close) && !(await doneToday("forwarding.test_placed"))) {
      const [voice] = await db.select().from(schema.lines).where(and(eq(schema.lines.customerId, c.id), eq(schema.lines.kind, "voice")));
      const [text] = await db.select().from(schema.lines).where(and(eq(schema.lines.customerId, c.id), eq(schema.lines.kind, "text")));
      if (voice?.companyNumber && text) {
        await placeForwardingTest(text.twilioNumber, voice.companyNumber);
        await db.update(schema.lines).set({ lastForwardingTestAt: now, lastForwardingTestOk: null }).where(eq(schema.lines.id, voice.id));
        await mark("forwarding.test_placed", { lineId: voice.id });
        did.push("forwarding_test");
      }
    }
    // Forwarding test result: nothing landed within 5 minutes → alert the reps.
    const [voice] = await db.select().from(schema.lines).where(and(eq(schema.lines.customerId, c.id), eq(schema.lines.kind, "voice")));
    if (voice?.lastForwardingTestAt && voice.lastForwardingTestOk == null && now.getTime() - voice.lastForwardingTestAt.getTime() > 5 * 60 * 1000) {
      await db.update(schema.lines).set({ lastForwardingTestOk: false }).where(eq(schema.lines.id, voice.id));
      const reps = await db.select().from(schema.teamMembers).where(and(eq(schema.teamMembers.customerId, c.id), eq(schema.teamMembers.active, true)));
      for (const m of reps.filter((m) => m.isOnCall || m.isOwner || m.canEditSettings)) await sendToRep(db, m, { customerId: c.id, body: `Forwarding check failed: the test call to ${voice.companyNumber} did not reach the desk. After-hours calls may be going to voicemail. Check your phone system's after-hours forwarding.`, template: { kind: "notice" }, now });
      await mark("forwarding.test_failed", { lineId: voice.id });
      did.push("forwarding_failed");
    }
    // Retention: call notes and message bodies older than the setting are scrubbed once a day; amounts and statuses stay.
    if (!(await doneToday("retention.swept"))) {
      const cutoff = new Date(now.getTime() - settings.retentionMonths * 30 * 24 * 60 * 60 * 1000);
      const old = await db.select({ id: schema.requests.id }).from(schema.requests).where(and(eq(schema.requests.customerId, c.id), lt(schema.requests.receivedAt, cutoff), isNotNull(schema.requests.transcript)));
      if (old.length) {
        await db.update(schema.requests).set({ transcript: null, transcriptUrl: null }).where(inArray(schema.requests.id, old.map((r) => r.id)));
        await db.update(schema.messages).set({ body: null }).where(inArray(schema.messages.requestId, old.map((r) => r.id)));
      }
      await mark("retention.swept", { scrubbed: old.length });
      if (old.length) did.push("retention");
    }
    // Morning summary, N minutes before the next opening (today's if we are before it).
    const opening = nextOpening(new Date(now.getTime() - 60 * 60 * 1000), settings.hours, c.timezone, settings.holidays);
    const sendAt = opening.getTime() - settings.summaryMinutesBefore * 60 * 1000;
    if (now.getTime() >= sendAt && now.getTime() < opening.getTime() + 60 * 60 * 1000) {
      const r = await sendMorningSummary(db, c.id, opening, now);
      if ("sent" in r) did.push("summary");
    }
    out[c.id] = did;
  }
  return out;
}

export const nightlyClock = inngest.createFunction(
  { id: "nightly-clock", triggers: [{ cron: "*/5 * * * *" }] },
  async ({ step }) => step.run("tick", () => nightlyTick(new Date())),
);

export const functions = [decisionTimer, cardEscalation, callbackRetry, nightlyClock];
