// Read models for the panel: the Performance tab's numbers, the requests list,
// top buyers, and what needs attention. Test calls never count.
import { and, desc, eq, gte, inArray, lte } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { weekStart, value } from "./summary";
import { fmtPhone } from "./card";

type Request = typeof schema.requests.$inferSelect;

export const statusLabel = (r: Request, byName: string | null) =>
  r.status === "auto_cleared" ? "Auto-cleared" : r.status === "approved" ? `Approved by ${byName ?? "a rep"}` : r.status === "in_progress" ? "In progress" : "Rejected";
export const statusClass = (s: Request["status"]) => s === "auto_cleared" ? "auto" : s === "approved" ? "approved" : s === "in_progress" ? "progress" : "rejected";
export const isWon = (r: Request) => r.status === "auto_cleared" || r.status === "approved";

export function monthStart(d: Date, tz: string): Date {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit" }).formatToParts(d);
  const y = Number(p.find((x) => x.type === "year")!.value), m = Number(p.find((x) => x.type === "month")!.value);
  // First instant whose local date is the 1st: start a day early in UTC and step forward.
  let t = new Date(Date.UTC(y, m - 1, 1) - 24 * 60 * 60 * 1000);
  const iso = `${y}-${String(m).padStart(2, "0")}-01`;
  const local = (x: Date) => { const q = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(x); return `${q.find((z) => z.type === "year")!.value}-${q.find((z) => z.type === "month")!.value}-${q.find((z) => z.type === "day")!.value}`; };
  while (local(t) !== iso) t = new Date(t.getTime() + 15 * 60 * 1000);
  return t;
}

export type RequestRow = {
  id: string; ref: number; when: string; receivedAt: Date; buyer: string; city: string | null; contact: string | null; phone: string | null;
  item: string; cases: number | null; price: number | null; amount: number; status: Request["status"]; statusLabel: string; type: string;
  takenOver: string | null; isNew: boolean; channel: string; flags: string[];
};

export async function performance(db: Db, customerId: string, tz: string, range: "week" | "month", now: Date) {
  const since = range === "week" ? weekStart(now, tz) : monthStart(now, tz);
  const reqs = await db.select().from(schema.requests).where(and(eq(schema.requests.customerId, customerId), gte(schema.requests.receivedAt, since), lte(schema.requests.receivedAt, now), eq(schema.requests.isTest, false))).orderBy(desc(schema.requests.receivedAt));
  const ids = reqs.map((r) => r.id);
  const lines = ids.length ? await db.select().from(schema.orderLines).where(inArray(schema.orderLines.requestId, ids)) : [];
  const members = await db.select().from(schema.teamMembers).where(eq(schema.teamMembers.customerId, customerId));
  const buyerIds = reqs.map((r) => r.buyerId).filter((x): x is string => Boolean(x));
  const buyers = buyerIds.length ? await db.select().from(schema.buyers).where(inArray(schema.buyers.id, buyerIds)) : [];
  const decisions = ids.length ? await db.select().from(schema.decisions).where(and(inArray(schema.decisions.requestId, ids), eq(schema.decisions.action, "take_over"))) : [];
  const spam = await db.select().from(schema.events).where(and(eq(schema.events.customerId, customerId), eq(schema.events.type, "intake.spam"), gte(schema.events.at, since)));
  const name = (id: string | null) => members.find((m) => m.id === id)?.name ?? null;
  const byReq = (id: string) => lines.filter((l) => l.requestId === id);

  const orders = reqs.filter((r) => r.type === "new_order");
  const won = orders.filter(isWon);
  const booked = won.reduce((s, r) => s + value(byReq(r.id)), 0);
  const assisted = won.filter((r) => r.assisted).reduce((s, r) => s + value(byReq(r.id)), 0);

  const dayIdx = (d: Date) => ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(d));
  const series: number[] = range === "week" ? [0, 0, 0, 0, 0, 0, 0] : [0, 0, 0, 0, 0];
  for (const r of won) {
    const v = value(byReq(r.id));
    if (range === "week") series[dayIdx(r.receivedAt)] += v;
    else series[Math.min(4, Math.floor((r.receivedAt.getTime() - since.getTime()) / (7 * 24 * 60 * 60 * 1000)))] += v;
  }
  const labels = range === "week" ? ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] : ["W1", "W2", "W3", "W4", "W5"];

  const rows: RequestRow[] = reqs.map((r) => {
    const ls = byReq(r.id); const l = ls[0]; const b = buyers.find((x) => x.id === r.buyerId);
    const taker = decisions.find((d) => d.requestId === r.id);
    return {
      id: r.id, ref: r.ref, receivedAt: r.receivedAt,
      when: r.receivedAt.toLocaleString("en-US", { timeZone: tz, weekday: "short", hour: "numeric", minute: "2-digit" }).replace(",", "").replace(" AM", "am").replace(" PM", "pm"),
      buyer: b?.company ?? r.callerCompany ?? r.callerName ?? "Unknown", city: b?.city ?? null, contact: r.callerName ?? b?.contactName ?? null, phone: fmtPhone(r.callbackNumber) || null,
      item: r.type !== "new_order" ? (r.summary ?? r.type) : ls.length > 1 ? `${ls.length} lines` : l ? `${l.product.split(" ")[0]} ${l.size ?? ""} · ${l.cases ?? "?"} cs ${isWon(r) ? "at" : "· offers"} ${l.finalPrice ?? l.priceOffered ? `$${Number(l.finalPrice ?? l.priceOffered).toFixed(2)}` : "?"}`.trim() : "—",
      cases: ls.length === 1 ? l.cases : ls.reduce((s, x) => s + (x.cases ?? 0), 0) || null, price: ls.length === 1 && l ? Number(l.finalPrice ?? l.priceOffered ?? 0) || null : null,
      amount: value(ls), status: r.status, statusLabel: statusLabel(r, name(r.decidedById)), type: r.type,
      takenOver: r.status === "in_progress" && taker ? name(taker.memberId) : null, isNew: r.flags.includes("new_buyer"), channel: r.channel, flags: r.flags,
    };
  });

  const byBuyer = new Map<string, { buyer: string; city: string | null; n: number; sum: number; isNew: boolean }>();
  for (const r of rows.filter((x) => x.status === "auto_cleared" || x.status === "approved")) {
    const k = r.buyer; const e = byBuyer.get(k) ?? { buyer: k, city: r.city, n: 0, sum: 0, isNew: r.isNew };
    e.n++; e.sum += r.amount; byBuyer.set(k, e);
  }
  const [voice] = await db.select().from(schema.lines).where(and(eq(schema.lines.customerId, customerId), eq(schema.lines.kind, "voice")));

  return {
    range, since, booked, orders: won.length, recovered: booked - assisted, assisted, series, labels,
    funnel: { handled: reqs.length + spam.length, real: orders.length, decided: orders.filter((r) => r.status !== "in_progress").length, confirmed: won.length, booked },
    rows, counts: { all: rows.length, auto_cleared: rows.filter((r) => r.status === "auto_cleared").length, approved: rows.filter((r) => r.status === "approved").length, in_progress: rows.filter((r) => r.status === "in_progress").length, rejected: rows.filter((r) => r.status === "rejected").length },
    topBuyers: Array.from(byBuyer.values()).sort((a, b) => b.sum - a.sum).slice(0, 6),
    attention: { waiting: rows.filter((r) => r.status === "in_progress" && !r.takenOver).length, forwardingBroken: voice?.lastForwardingTestOk === false, lastTest: voice?.lastForwardingTestAt ?? null },
  };
}

export async function requestDetail(db: Db, customerId: string, id: string) {
  const [r] = await db.select().from(schema.requests).where(and(eq(schema.requests.id, id), eq(schema.requests.customerId, customerId)));
  if (!r) return null;
  const lines = await db.select().from(schema.orderLines).where(eq(schema.orderLines.requestId, id));
  const buyer = r.buyerId ? (await db.select().from(schema.buyers).where(eq(schema.buyers.id, r.buyerId)))[0] : null;
  const events = await db.select().from(schema.events).where(eq(schema.events.requestId, id)).orderBy(schema.events.at);
  const messages = await db.select().from(schema.messages).where(eq(schema.messages.requestId, id)).orderBy(schema.messages.sentAt);
  const decisions = await db.select().from(schema.decisions).where(eq(schema.decisions.requestId, id)).orderBy(schema.decisions.createdAt);
  const members = await db.select().from(schema.teamMembers).where(eq(schema.teamMembers.customerId, customerId));
  return { request: r, lines, buyer, events, messages, decisions, members, amount: value(lines) };
}

/** The member who acts when someone decides from the panel: the owner, else the first who can approve. */
export async function panelActor(db: Db, customerId: string) {
  const members = await db.select().from(schema.teamMembers).where(and(eq(schema.teamMembers.customerId, customerId), eq(schema.teamMembers.active, true)));
  return members.find((m) => m.isOwner) ?? members.find((m) => m.canApprove) ?? members[0] ?? null;
}
