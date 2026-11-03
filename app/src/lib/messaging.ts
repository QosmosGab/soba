// Sends to reps and buyers, logs every message, and picks the channel:
// WhatsApp when the rep opted in (template with buttons when we open the
// conversation, free text inside the 24-hour window), otherwise SMS from the
// customer's text line. A failed WhatsApp send falls back to SMS.
import { and, desc, eq, gt } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { env } from "./env";
import { sendSms, sendWhatsApp } from "./providers/twilio";

type Member = typeof schema.teamMembers.$inferSelect;
type TemplateKind = "card" | "card_non_order" | "notice" | "same_prices";

const WINDOW_MS = 24 * 60 * 60 * 1000;

export async function textLineNumber(db: Db, customerId: string): Promise<string | null> {
  const [line] = await db.select().from(schema.lines).where(and(eq(schema.lines.customerId, customerId), eq(schema.lines.kind, "text"))).limit(1);
  return line?.twilioNumber ?? null;
}

/** True when the rep messaged us on WhatsApp in the last 24 hours, so free text is allowed. */
export async function inWhatsAppWindow(db: Db, memberId: string, now: Date): Promise<boolean> {
  const rows = await db.select({ id: schema.messages.id }).from(schema.messages).where(and(
    eq(schema.messages.memberId, memberId), eq(schema.messages.direction, "in"), eq(schema.messages.channel, "whatsapp"),
    gt(schema.messages.sentAt, new Date(now.getTime() - WINDOW_MS)),
  )).orderBy(desc(schema.messages.sentAt)).limit(1);
  return rows.length > 0;
}

function templateSid(kind: TemplateKind): string | null {
  switch (kind) {
    case "card": return env.twilio.cardTemplateSid;
    case "card_non_order": return env.twilio.cardNonOrderTemplateSid;
    case "notice": return env.twilio.noticeTemplateSid;
    case "same_prices": return env.twilio.samePricesTemplateSid;
  }
}

export type RepSend = {
  customerId: string; requestId?: string | null; body: string;
  /** Template to use when the conversation window is closed. Variables default to {"1": body on one line}. */
  template?: { kind: TemplateKind; variables?: Record<string, string> } | null;
  /** SMS fallback body when the rep is not on WhatsApp (defaults to body). */
  smsBody?: string;
  now?: Date;
};

export async function sendToRep(db: Db, member: Member, s: RepSend): Promise<{ channel: "whatsapp" | "sms" | "none"; sid: string | null }> {
  const now = s.now ?? new Date();
  const log = async (channel: "whatsapp" | "sms", sid: string | null, body: string) => {
    await db.insert(schema.messages).values({ customerId: s.customerId, requestId: s.requestId ?? null, direction: "out", party: "rep", channel, body, providerId: sid, memberId: member.id, sentAt: now });
  };
  if (member.whatsappOptedIn && member.cell) {
    const open = await inWhatsAppWindow(db, member.id, now);
    const sid = s.template ? templateSid(s.template.kind) : null;
    const template = !open && s.template ? { sid, variables: s.template.variables ?? { "1": s.body.replace(/\s*\n\s*/g, " · ") } } : null;
    try {
      // Outside the window with no template configured, Twilio rejects free text; try anyway in dev, fall back on error.
      const r = await sendWhatsApp({ to: member.cell, body: s.body, template });
      await log("whatsapp", r.sid, s.body);
      return { channel: "whatsapp", sid: r.sid };
    } catch (err) {
      await db.insert(schema.events).values({ customerId: s.customerId, requestId: s.requestId ?? null, type: "message.whatsapp_failed", payload: { memberId: member.id, error: String(err) } });
    }
  }
  const from = await textLineNumber(db, s.customerId);
  if (!from || !member.cell) {
    await db.insert(schema.events).values({ customerId: s.customerId, requestId: s.requestId ?? null, type: "message.undeliverable", payload: { memberId: member.id } });
    return { channel: "none", sid: null };
  }
  const r = await sendSms({ from, to: member.cell, body: s.smsBody ?? s.body });
  await log("sms", r.sid, s.smsBody ?? s.body);
  return { channel: "sms", sid: r.sid };
}

export async function sendToBuyer(db: Db, b: { customerId: string; requestId?: string | null; threadId?: string | null; to: string; body: string; channel?: "sms" | "whatsapp"; now?: Date }) {
  const now = b.now ?? new Date();
  const channel = b.channel ?? "sms";
  let sid: string | null = null;
  if (channel === "whatsapp") {
    sid = (await sendWhatsApp({ to: b.to, body: b.body })).sid;
  } else {
    const from = await textLineNumber(db, b.customerId);
    if (!from) throw new Error(`Customer ${b.customerId} has no text line`);
    sid = (await sendSms({ from, to: b.to, body: b.body })).sid;
  }
  await db.insert(schema.messages).values({ customerId: b.customerId, requestId: b.requestId ?? null, threadId: b.threadId ?? null, direction: "out", party: "desk", channel, body: b.body, providerId: sid, sentAt: now });
  return sid;
}
