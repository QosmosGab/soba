// The morning summary: one window (last closing to this opening), the week so
// far, the orders, the rules, what wasn't an order. Rendered as email HTML,
// plain text, and the short WhatsApp version. Sent once per window.
import { and, desc, eq, gte, inArray, isNotNull, lt, lte, gt } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { loadCustomer } from "./cards";
import { sendToRep } from "./messaging";
import { sendEmail } from "./providers/email";
import { env } from "./env";
import { fmtMoney } from "./card";
import { previousClosing } from "./hours";

type Request = typeof schema.requests.$inferSelect;
type Line = typeof schema.orderLines.$inferSelect;

export type SummaryData = {
  customer: string; timezone: string; windowStart: Date; windowEnd: Date;
  won: number; wonCount: number; weekTotal: number; weekOrders: number; weekDays: number[]; // Mon..Sun dollars
  orders: Array<{ ref: number; buyer: string; city: string | null; item: string; cases: number | null; price: number | null; amount: number; status: string; statusLabel: string; by: string | null; entered: boolean }>;
  rules: Array<{ label: string; cleared: number; limit: number; price: number }>;
  nonOrders: Array<{ type: string; count: number }>;
  approvedBy: Record<string, number>; autoCount: number; openCount: number; rejectedCount: number;
  stoppedAt: Date;
};

export const value = (lines: Line[]) => lines.reduce((s, l) => s + (l.cases ?? 0) * Number(l.finalPrice ?? l.priceOffered ?? 0), 0);
const isWon = (r: Request) => r.status === "auto_cleared" || r.status === "approved";

import { localParts as sharedParts } from "./time";
const localParts = (d: Date, tz: string) => { const p = sharedParts(d, tz); return { weekday: p.weekday, iso: p.isoDate }; };

/** Monday 00:00 local of the week containing `d`, found by stepping back whole days. */
export function weekStart(d: Date, tz: string): Date {
  let t = new Date(d);
  for (let i = 0; i < 8; i++) {
    const { weekday } = localParts(t, tz);
    if (weekday === 0) break;
    t = new Date(t.getTime() - 24 * 60 * 60 * 1000);
  }
  const { iso } = localParts(t, tz);
  // Local midnight: find the instant where local date flips to `iso`.
  let m = new Date(t.getTime() - 24 * 60 * 60 * 1000);
  while (localParts(m, tz).iso !== iso) m = new Date(m.getTime() + 15 * 60 * 1000);
  return m;
}

/** The previous closing time before `opening` (the start of the off-hours window), walking back over closed days. */
export function windowStartFor(opening: Date, hours: Record<string, { open: string; close: string; closed: boolean }>, tz: string, holidays: string[]): Date {
  try { return previousClosing(opening, hours, tz, holidays); } catch { return new Date(opening.getTime() - 14 * 60 * 60 * 1000); }
}

export async function buildSummary(db: Db, customerId: string, windowStart: Date, windowEnd: Date, now: Date): Promise<SummaryData> {
  const { customer } = await loadCustomer(db, customerId);
  const tz = customer.timezone;
  const reqs = await db.select().from(schema.requests).where(and(eq(schema.requests.customerId, customerId), gte(schema.requests.receivedAt, windowStart), lt(schema.requests.receivedAt, windowEnd), eq(schema.requests.isTest, false)));
  const ids = reqs.map((r) => r.id);
  const lines = ids.length ? await db.select().from(schema.orderLines).where(inArray(schema.orderLines.requestId, ids)) : [];
  const members = await db.select().from(schema.teamMembers).where(eq(schema.teamMembers.customerId, customerId));
  const buyers = reqs.some((r) => r.buyerId) ? await db.select().from(schema.buyers).where(inArray(schema.buyers.id, reqs.map((r) => r.buyerId).filter((x): x is string => Boolean(x)))) : [];
  const name = (id: string | null) => members.find((m) => m.id === id)?.name ?? null;
  const byReq = (id: string) => lines.filter((l) => l.requestId === id);
  const statusLabel = (r: Request) => r.status === "auto_cleared" ? "Auto-cleared" : r.status === "approved" ? `Approved by ${name(r.decidedById) ?? "a rep"}` : r.status === "in_progress" ? "In progress" : "Rejected";

  const orderReqs = reqs.filter((r) => r.type === "new_order").sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime());
  const wonReqs = orderReqs.filter(isWon);
  const won = wonReqs.reduce((s, r) => s + value(byReq(r.id)), 0);

  const ws = weekStart(now, tz);
  const weekReqs = await db.select().from(schema.requests).where(and(eq(schema.requests.customerId, customerId), gte(schema.requests.receivedAt, ws), lte(schema.requests.receivedAt, now), eq(schema.requests.isTest, false), eq(schema.requests.type, "new_order"), inArray(schema.requests.status, ["auto_cleared", "approved"])));
  const weekLines = weekReqs.length ? await db.select().from(schema.orderLines).where(inArray(schema.orderLines.requestId, weekReqs.map((r) => r.id))) : [];
  const weekDays = [0, 0, 0, 0, 0, 0, 0];
  for (const r of weekReqs) weekDays[localParts(r.receivedAt, tz).weekday] += value(weekLines.filter((l) => l.requestId === r.id));

  const rules = await db.select().from(schema.priceRules).where(and(eq(schema.priceRules.customerId, customerId), gt(schema.priceRules.liveFrom, new Date(windowStart.getTime() - 6 * 60 * 60 * 1000)), lte(schema.priceRules.liveFrom, windowEnd)));
  const nonOrderCounts = new Map<string, number>();
  const labels: Record<string, string> = { availability: "availability check", hold: "hold request", complaint: "complaint", pickup: "pickup question", other: "not an order" };
  for (const r of reqs.filter((r) => r.type !== "new_order" && r.type !== "change")) nonOrderCounts.set(labels[r.type] ?? r.type, (nonOrderCounts.get(labels[r.type] ?? r.type) ?? 0) + 1);
  const spam = await db.select().from(schema.events).where(and(eq(schema.events.customerId, customerId), eq(schema.events.type, "intake.spam"), gte(schema.events.at, windowStart), lt(schema.events.at, windowEnd)));
  if (spam.length) nonOrderCounts.set("spam or sales pitch", spam.length);

  const approvedBy: Record<string, number> = {};
  for (const r of wonReqs.filter((r) => r.status === "approved")) { const n = name(r.decidedById) ?? "a rep"; approvedBy[n] = (approvedBy[n] ?? 0) + 1; }

  return {
    customer: customer.name, timezone: tz, windowStart, windowEnd, won, wonCount: wonReqs.length,
    weekTotal: weekDays.reduce((a, b) => a + b, 0), weekOrders: weekReqs.length, weekDays,
    orders: orderReqs.map((r) => {
      const ls = byReq(r.id); const l = ls[0]; const b = buyers.find((x) => x.id === r.buyerId);
      return { ref: r.ref, buyer: b?.company ?? r.callerCompany ?? r.callerName ?? "Unknown", city: b?.city ?? null,
        item: ls.length > 1 ? `${ls.length} lines` : l ? [l.size, l.product, l.pack].filter(Boolean).join(" ") : "—",
        cases: ls.length === 1 ? l.cases : ls.reduce((s, x) => s + (x.cases ?? 0), 0), price: ls.length === 1 && l ? Number(l.finalPrice ?? l.priceOffered ?? 0) || null : null,
        amount: value(ls), status: r.status, statusLabel: statusLabel(r), by: name(r.decidedById), entered: Boolean(r.enteredAt) };
    }),
    rules: rules.map((r) => ({ label: `${r.product}${r.size ? ` ${r.size.replace("x", "×")}` : ""}${r.pack ? `, ${r.pack}` : ""}`, cleared: r.casesCleared, limit: r.caseLimit, price: Number(r.minPrice) })),
    nonOrders: Array.from(nonOrderCounts, ([type, count]) => ({ type, count })),
    approvedBy, autoCount: wonReqs.filter((r) => r.status === "auto_cleared").length,
    openCount: orderReqs.filter((r) => r.status === "in_progress").length, rejectedCount: orderReqs.filter((r) => r.status === "rejected").length,
    stoppedAt: windowEnd,
  };
}

const $ = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const fmtWhen = (d: Date, tz: string) => d.toLocaleString("en-US", { timeZone: tz, weekday: "short", hour: "numeric", minute: "2-digit" }).replace(",", "");
const tzName = (tz: string) => tz === "America/Phoenix" ? "Arizona time" : tz.split("/").pop()?.replace("_", " ") + " time";

export function whatsappSummary(s: SummaryData, link: string): string {
  const by = Object.entries(s.approvedBy).map(([n, c]) => `${c} approved by ${n}`);
  const parts = [...by, s.autoCount ? `${s.autoCount} auto-cleared` : null].filter(Boolean).join(", ");
  if (!s.wonCount && !s.openCount && !s.rejectedCount && !s.nonOrders.length) return `Overnight summary\n• Quiet night: no calls or texts needed the desk.\n• This week: ${$(s.weekTotal)} from ${s.weekOrders} order${s.weekOrders === 1 ? "" : "s"}\n\nFull details: ${link}`;
  return [
    "Overnight summary",
    `• ${s.wonCount} order${s.wonCount === 1 ? "" : "s"} won, ${$(s.won)}`,
    parts ? `• ${parts}` : null,
    `• ${s.openCount} in progress, ${s.rejectedCount} rejected`,
    `• This week: ${$(s.weekTotal)} from ${s.weekOrders} order${s.weekOrders === 1 ? "" : "s"}`,
    "", `Full details: ${link}`,
  ].filter((x) => x != null).join("\n");
}

export function emailSummary(s: SummaryData, link: string, sections: string[], quietNote: boolean): { subject: string; html: string; text: string } {
  const window = `${fmtWhen(s.windowStart, s.timezone)} to ${fmtWhen(s.windowEnd, s.timezone)}, ${tzName(s.timezone)}`;
  const quiet = !s.orders.length && !s.nonOrders.length;
  const headline = quiet ? "Good morning. A quiet night: nothing needed the desk." : `Good morning. You won ${s.wonCount} order${s.wonCount === 1 ? "" : "s"} overnight.`;
  const subject = quiet ? `${s.customer}: quiet night` : `${s.customer}: ${s.wonCount} order${s.wonCount === 1 ? "" : "s"} won overnight, ${$(s.won)}`;
  const max = Math.max(...s.weekDays, 1);
  const bars = s.weekDays.map((v, i) => `<td style="vertical-align:bottom;text-align:center;padding:0 2px"><div style="height:${Math.max(4, Math.round(v / max * 40))}px;background:${v ? "#2a7a4a" : "#cfdccf"};border-radius:3px"></div><div style="font:11px sans-serif;color:#195a34">${["M", "T", "W", "T", "F", "S", "S"][i]}</div></td>`).join("");
  const row = (o: SummaryData["orders"][number]) => {
    const grey = o.status === "in_progress" || o.status === "rejected";
    return `<tr><td style="padding:8px 6px;border-top:1px solid #e1e5dc"><b>${o.buyer}</b>${o.city ? `<span style="color:#667063"> · ${o.city}</span>` : ""}</td><td style="padding:8px 6px;border-top:1px solid #e1e5dc">${o.item}</td><td style="padding:8px 6px;border-top:1px solid #e1e5dc;text-align:right">${o.cases ?? ""}</td><td style="padding:8px 6px;border-top:1px solid #e1e5dc;text-align:right">${o.price != null ? fmtMoney(o.price) : ""}</td><td style="padding:8px 6px;border-top:1px solid #e1e5dc;text-align:right;${grey ? "color:#9aa596" : "font-weight:700"}">${$(o.amount)}</td><td style="padding:8px 6px;border-top:1px solid #e1e5dc;text-align:right">${o.statusLabel}</td></tr>`;
  };
  const rules = s.rules.map((r) => `<div style="margin:8px 0"><div>${r.label}, at ${fmtMoney(r.price)} or more: <b>${r.cleared} of ${r.limit} cases</b></div><div style="height:7px;background:#eef1ea;border-radius:4px;max-width:360px"><div style="height:7px;width:${Math.min(100, Math.round(r.cleared / Math.max(1, r.limit) * 100))}%;background:#2a7a4a;border-radius:4px"></div></div></div>`).join("");
  const non = s.nonOrders.length ? `${s.nonOrders.reduce((a, b) => a + b.count, 0)} call${s.nonOrders.reduce((a, b) => a + b.count, 0) === 1 ? " wasn't" : "s weren't"} orders: ${s.nonOrders.map((n) => `${n.count} ${n.type}${n.count > 1 && !n.type.endsWith("s") ? "s" : ""}`).join(", ")}.` : "";
  const html = `<!doctype html><html><body style="margin:0;background:#f2f4ef;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#18201b">
<div style="max-width:640px;margin:0 auto;padding:24px 16px">
<div style="font-size:13px;color:#667063">${s.customer}</div>
<h1 style="font-size:22px;margin:6px 0 2px">${headline}</h1>
<div style="font-size:13px;color:#667063">${window}</div>
${quiet && !quietNote ? "" : `<div style="margin:18px 0;padding:18px 20px;border-radius:14px;background:#e1efe5;display:flex;justify-content:space-between;gap:16px"><div><div style="font-size:12px;color:#195a34">Won overnight</div><div style="font-size:34px;font-weight:700;color:#195a34;line-height:1.1">${$(s.won)}</div><div style="font-size:13px;color:#195a34">${s.wonCount} order${s.wonCount === 1 ? "" : "s"}</div></div><div style="text-align:right"><div style="font-size:12px;color:#195a34">This week so far</div><div style="font-size:16px;font-weight:700;color:#195a34">${$(s.weekTotal)} · ${s.weekOrders} order${s.weekOrders === 1 ? "" : "s"}</div><table style="border-collapse:collapse;margin-top:6px;margin-left:auto"><tr>${bars}</tr></table></div></div>`}
${sections.includes("orders") && s.orders.length ? `<div style="background:#fff;border-radius:14px;padding:16px 18px;margin:14px 0"><h2 style="font-size:15px;margin:0 0 8px">Overnight orders</h2><table style="width:100%;border-collapse:collapse;font-size:13px"><tr style="color:#667063;font-size:12px"><td>Buyer</td><td>Product</td><td style="text-align:right">Cases</td><td style="text-align:right">Price</td><td style="text-align:right">Amount</td><td style="text-align:right">Status</td></tr>${s.orders.map(row).join("")}</table></div>` : ""}
${sections.includes("rules") && s.rules.length ? `<div style="background:#fff;border-radius:14px;padding:16px 18px;margin:14px 0"><h2 style="font-size:15px;margin:0 0 4px">Sold at the prices you set</h2>${rules}<div style="font-size:13px;color:#667063;margin-top:8px">These prices stopped at ${fmtWhen(s.stoppedAt, s.timezone).split(" ").slice(1).join(" ")}. Send tonight's price sheet to sell overnight again.</div></div>` : ""}
${sections.includes("other") && non ? `<div style="background:#fff;border-radius:14px;padding:16px 18px;margin:14px 0"><h2 style="font-size:15px;margin:0 0 4px">Also overnight</h2><div style="font-size:13px">${non}</div></div>` : ""}
${sections.includes("transcripts") ? `<div style="margin:14px 0"><a href="${link}" style="display:inline-block;background:#18201b;color:#fff;text-decoration:none;padding:10px 16px;border-radius:10px;font-weight:600;font-size:13px">Open calls and messages</a></div>` : ""}
<div style="font-size:12px;color:#667063;margin-top:18px">Sent before opening · change timing and recipients in Settings.</div>
</div></body></html>`;
  const text = [headline, window, "", `Won overnight: ${$(s.won)} (${s.wonCount} orders). This week: ${$(s.weekTotal)} from ${s.weekOrders} orders.`, "",
    ...s.orders.map((o) => `${o.buyer}${o.city ? `, ${o.city}` : ""}: ${o.item}, ${o.cases ?? "?"} cs${o.price != null ? ` at ${fmtMoney(o.price)}` : ""}, ${$(o.amount)}, ${o.statusLabel}`),
    "", ...s.rules.map((r) => `${r.label} at ${fmtMoney(r.price)}+: ${r.cleared} of ${r.limit} cases`), non, "", `Calls and messages: ${link}`].join("\n");
  return { subject, html, text };
}

/**
 * Sends the summary for the night ending at `opening`, once. The window runs from where the last
 * summary stopped (or the previous closing) to the moment it is sent, so nothing falls between two summaries.
 */
export async function sendMorningSummary(db: Db, customerId: string, opening: Date, now: Date, opts: { onlyMemberId?: string } = {}) {
  const { customer, settings } = await loadCustomer(db, customerId);
  const existing = await db.select().from(schema.summaries).where(and(eq(schema.summaries.customerId, customerId), eq(schema.summaries.windowEnd, opening)));
  if (existing[0]?.sentAt) return { skipped: "already sent" as const };
  const [last] = await db.select().from(schema.summaries).where(and(eq(schema.summaries.customerId, customerId), isNotNull(schema.summaries.sentAt), lt(schema.summaries.windowEnd, opening))).orderBy(desc(schema.summaries.sentAt)).limit(1);
  const closing = windowStartFor(opening, settings.hours, customer.timezone, settings.holidays);
  const windowStart = last?.sentAt && last.sentAt > closing ? last.sentAt : closing;
  const windowEnd = now < opening ? now : opening;
  const data = await buildSummary(db, customerId, windowStart, windowEnd, now);
  const quiet = !data.orders.length && !data.nonOrders.length;
  if (quiet && !settings.quietNightNote) return { skipped: "quiet" as const };
  const [row] = existing[0] ? [existing[0]] : await db.insert(schema.summaries).values({ customerId, windowStart, windowEnd: opening }).returning();
  await db.update(schema.summaries).set({ windowStart }).where(eq(schema.summaries.id, row.id));
  const link = `${env.appUrl}/panel/summary/${row.id}`;
  const all = await db.select().from(schema.teamMembers).where(and(eq(schema.teamMembers.customerId, customerId), eq(schema.teamMembers.active, true)));
  const members = opts.onlyMemberId ? all.filter((m) => m.id === opts.onlyMemberId) : all;
  const emails = members.filter((m) => (m.summaryEmail || opts.onlyMemberId) && m.email).map((m) => m.email!);
  if (emails.length) {
    const e = emailSummary(data, link, settings.summarySections, settings.quietNightNote);
    await sendEmail({ to: emails, subject: e.subject, html: e.html, text: e.text, fromName: customer.name });
  }
  const wa = whatsappSummary(data, link);
  for (const m of members.filter((m) => m.summaryWhatsapp || opts.onlyMemberId)) await sendToRep(db, m, { customerId, body: wa, template: { kind: "notice" }, now });
  await db.update(schema.summaries).set({ sentAt: now, recipients: [...emails, ...members.filter((m) => m.summaryWhatsapp).map((m) => m.cell)] }).where(eq(schema.summaries.id, row.id));
  await db.insert(schema.events).values({ customerId, type: "summary.sent", payload: { summaryId: row.id, won: data.won, orders: data.wonCount } });
  return { sent: true as const, summaryId: row.id, data };
}
