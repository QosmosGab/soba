// Demo data: two nights of realistic after-hours traffic for one customer, written
// straight into the tables (nothing is sent), so a panel can be shown before the
// first real call. Used by the admin "Add demo data" button and the local seed.
import { and, eq, gt, max } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { localParts } from "./time";

/** Year, month and day of a local ISO date. */
const ymd = (isoDate: string) => isoDate.split("-").map(Number) as [number, number, number];

/** The UTC instant for a local wall-clock time in `tz`. Day may run past the month; Date.UTC normalizes it. */
function local(tz: string, y: number, m: number, d: number, h: number, mi: number): Date {
  let t = new Date(Date.UTC(y, m - 1, d, h, mi));
  for (let i = 0; i < 2; i++) {
    const p = localParts(t, tz);
    const [py, pm, pd] = ymd(p.isoDate);
    const want = Date.UTC(y, m - 1, d, h, mi), got = Date.UTC(py, pm - 1, pd, p.hour, p.minutes % 60);
    t = new Date(t.getTime() + (want - got));
  }
  return t;
}

type Line = { product: string; size: string; pack?: string; cases: number; offered: number; final?: number; pickup: string; fulfillment?: "collect" | "delivered"; destination?: string; notOnSheet?: boolean };
type Spec = {
  night: number; time: string; channel: "call" | "text"; buyer: string; city: string; contact: string; phone: string; newBuyer?: boolean; language?: "en" | "es";
  type?: "new_order" | "availability" | "pickup"; summary?: string; lines?: Line[]; transcript: string;
  outcome: "auto" | "approve" | "counter" | "reject" | "waiting" | "taken_over" | "won_after_takeover"; by?: string; reason?: string; counter?: number; urgent?: boolean;
};

const SPECS: Spec[] = [
  { night: 2, time: "19:42", channel: "call", buyer: "Lopez Bros", city: "Chicago", contact: "Mike Torres", phone: "+13125550142", lines: [{ product: "Vine-ripe tomatoes", size: "4x4", pack: "25 lb 2-layer", cases: 300, offered: 8.5, final: 8.5, pickup: "Mon" }], outcome: "auto",
    transcript: "Desk: Del Campo Supreme, sales. How can I help?\nBuyer: Mike at Lopez Bros. Give me 300 cases of 4x4 vine-ripes for Monday, eight fifty.\nDesk: 300 cases of 4x4 vine-ripe tomatoes, 25 pound two-layer, pickup Monday at $8.50 a case. You're confirmed, reference {ref}. You'll get a text with the details." },
  { night: 2, time: "20:15", channel: "text", buyer: "Fresh Way", city: "Toronto", contact: "Ana Ruiz", phone: "+14165550188", lines: [{ product: "Red bell peppers", size: "XL", pack: "25 lb", cases: 440, offered: 11, final: 11, pickup: "Tue" }], outcome: "approve", by: "Ruben",
    transcript: "Buyer: 440 cs red bells XL for Tuesday, $11?\nDesk: 440 cases XL red bells, 25 lb, Tuesday pickup at $11.00. I'll pass it to the team and they'll get back to you." },
  { night: 2, time: "21:05", channel: "call", buyer: "Garcia Produce", city: "Houston", contact: "Luis Garcia", phone: "+17135550110", lines: [{ product: "Roma tomatoes", size: "5x6", pack: "25 lb", cases: 300, offered: 7, final: 7.25, pickup: "Tue" }], outcome: "counter", by: "Ruben", counter: 7.25,
    transcript: "Buyer: Romas, 5 by 6, 300 cases, I want seven even.\nDesk: 300 cases of 5x6 Romas, 25 pound, at $7.00. I'll pass it to the team and they'll get back to you tonight." },
  { night: 2, time: "22:40", channel: "call", buyer: "Sunny Foods", city: "Dallas", contact: "Rita Lowe", phone: "+12145550199", lines: [{ product: "Red bell peppers", size: "L", pack: "25 lb", cases: 100, offered: 8, pickup: "Wed", notOnSheet: true }], outcome: "reject", by: "Miguel", reason: "too low for this week",
    transcript: "Buyer: 100 cases large red bells at eight dollars.\nDesk: 100 cases of large red bells at $8.00, pickup Wednesday. I'll pass it to the team." },
  { night: 2, time: "23:20", channel: "call", buyer: "Valle Verde", city: "Nogales", contact: "Héctor Ramos", phone: "+15205550161", language: "es", lines: [{ product: "Roma tomatoes", size: "5x6", pack: "25 lb", cases: 200, offered: 7.4, final: 7.4, pickup: "Mon" }], outcome: "auto",
    transcript: "Buyer: Buenas, habla Héctor de Valle Verde. Doscientas cajas de saladette cinco por seis para el lunes, a siete cuarenta.\nDesk: 200 cajas de jitomate saladette 5x6, 25 libras, recoger el lunes a $7.40 la caja. Está confirmado, referencia {ref}. Le llega un mensaje con los detalles." },
  { night: 2, time: "05:50", channel: "text", buyer: "Mercado Central", city: "Los Angeles", contact: "Dana Li", phone: "+12135550177", newBuyer: true, lines: [{ product: "Vine-ripe tomatoes", size: "4x5", pack: "25 lb 2-layer", cases: 120, offered: 7.6, final: 7.6, pickup: "Tue" }], outcome: "auto",
    transcript: "Buyer: Hi, Dana at Mercado Central LA. 120 cases 4x5 vine ripes for tomorrow at 7.60 if you have them\nDesk: 120 cases of 4x5 vine-ripe tomatoes, pickup Tuesday at $7.60 a case. Confirmed, reference {ref}. Pickup is at the Nogales warehouse from 6 AM." },
  { night: 1, time: "19:10", channel: "call", buyer: "Lopez Bros", city: "Chicago", contact: "Mike Torres", phone: "+13125550142", lines: [{ product: "Vine-ripe tomatoes", size: "4x4", pack: "25 lb 2-layer", cases: 280, offered: 8.5, final: 8.5, pickup: "Tue" }], outcome: "auto",
    transcript: "Buyer: Mike again. Same as yesterday, 280 this time, Tuesday.\nDesk: 280 cases of 4x4 vine-ripes, 25 pound two-layer, Tuesday pickup at $8.50. Confirmed, reference {ref}." },
  { night: 1, time: "19:55", channel: "call", buyer: "Rio Bravo", city: "McAllen", contact: "Carlos Peña", phone: "+19565550134", language: "es", lines: [{ product: "Roma tomatoes", size: "5x6", pack: "25 lb", cases: 200, offered: 7.25, final: 7.25, pickup: "Wed" }], outcome: "auto",
    transcript: "Buyer: Carlos de Rio Bravo. Doscientas cajas de saladette para el miércoles, siete veinticinco.\nDesk: 200 cajas de saladette 5x6, recoger el miércoles a $7.25. Confirmado, referencia {ref}." },
  { night: 1, time: "20:40", channel: "text", buyer: "North Market", city: "Denver", contact: "Joe Park", phone: "+13035550123", newBuyer: true, lines: [{ product: "Vine-ripe tomatoes", size: "4x5", pack: "25 lb 2-layer", cases: 150, offered: 9, pickup: "Thu", fulfillment: "delivered", destination: "Denver" }], outcome: "waiting",
    transcript: "Buyer: 150 cs 4x5 VR delivered Denver Thursday, $9?\nDesk: 150 cases of 4x5 vine-ripes delivered to Denver Thursday at $9.00. Passing it to the team; they'll confirm the delivery." },
  { night: 1, time: "21:30", channel: "text", buyer: "Fresh Way", city: "Toronto", contact: "Ana Ruiz", phone: "+14165550188", type: "availability", summary: "Ana at Fresh Way asking if yellow bells are available this week and at what price", outcome: "taken_over", by: "Jimmy",
    transcript: "Buyer: Do you have yellow bells this week? Need about 200.\nDesk: I'll check with the team and have them get back to you." },
  { night: 1, time: "22:05", channel: "call", buyer: "Sun Harvest", city: "Phoenix", contact: "Priya Natarajan", phone: "+16025550118", lines: [{ product: "Vine-ripe tomatoes", size: "4x4", pack: "25 lb 2-layer", cases: 160, offered: 8.75, final: 8.75, pickup: "Wed" }, { product: "Roma tomatoes", size: "5x6", pack: "25 lb", cases: 80, offered: 7.5, final: 7.5, pickup: "Wed" }], outcome: "approve", by: "Ruben",
    transcript: "Buyer: Priya from Sun Harvest. 160 of the 4x4 vine-ripes at eight seventy-five and 80 Romas at seven fifty, Wednesday.\nDesk: 160 cases 4x4 vine-ripes at $8.75 and 80 cases 5x6 Romas at $7.50, Wednesday pickup. Two products, so I'll pass it to the team." },
  { night: 1, time: "23:45", channel: "call", buyer: "Golden State Produce", city: "Fresno", contact: "Tom Alvarez", phone: "+15595550149", lines: [{ product: "Vine-ripe tomatoes", size: "4x4", pack: "25 lb 2-layer", cases: 500, offered: 8.25, final: 8.4, pickup: "Thu" }], outcome: "won_after_takeover", by: "Miguel",
    transcript: "Buyer: Tom at Golden State. I'll take 500 cases of 4x4s Thursday if you do eight and a quarter.\nDesk: 500 cases of 4x4 vine-ripes, Thursday, at $8.25. That's over tonight's limit, so I'll pass it to the team." },
  { night: 1, time: "02:10", channel: "call", buyer: "Valley Fresh", city: "Phoenix", contact: "Sara Kim", phone: "+16025550150", lines: [{ product: "Roma tomatoes", size: "5x6", pack: "25 lb", cases: 200, offered: 6.75, pickup: "Wed" }], outcome: "waiting",
    transcript: "Buyer: 200 Romas 5x6, best I can do is six seventy-five.\nDesk: 200 cases of 5x6 Romas at $6.75, Wednesday. I'll pass it to the team and they'll get back to you." },
  { night: 1, time: "05:30", channel: "call", buyer: "Rio Grande Foods", city: "San Antonio", contact: "Pedro Vega", phone: "+12105550170", type: "pickup", summary: "Pedro at Rio Grande Foods asking if his truck is loaded; driver waiting since 5", outcome: "waiting", urgent: true,
    transcript: "Buyer: Is my truck loaded yet? Driver's been waiting since five.\nDesk: I'll get the team to call you about the pickup right away." },
];

const PICKUP: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

/** Adds two nights of demo traffic to a customer. Idempotent: a second call does nothing. */
export async function seedDemo(db: Db, customerId: string, now = new Date()): Promise<{ added: number }> {
  const [customer] = await db.select().from(schema.customers).where(eq(schema.customers.id, customerId));
  if (!customer) throw new Error("no such customer");
  const already = await db.select().from(schema.events).where(and(eq(schema.events.customerId, customerId), eq(schema.events.type, "demo.seeded")));
  if (already.length) return { added: 0 };
  const tz = customer.timezone;
  const [ty, tm, td] = ymd(localParts(now, tz).isoDate);

  // Team: the owner plus three reps, like a real desk.
  let members = await db.select().from(schema.teamMembers).where(and(eq(schema.teamMembers.customerId, customerId), eq(schema.teamMembers.active, true)));
  const owner = members.find((m) => m.isOwner) ?? members[0];
  const ensure = async (name: string, cell: string, extra: Partial<typeof schema.teamMembers.$inferInsert> = {}) => {
    const have = members.find((m) => m.name === name);
    if (have) return have;
    const [m] = await db.insert(schema.teamMembers).values({ customerId, name, cell, whatsappOptedIn: true, canApprove: true, ...extra }).returning();
    members = [...members, m];
    return m;
  };
  const ruben = await ensure("Ruben", "+15205550142", { canSetPrices: true, isOnCall: true });
  const miguel = await ensure("Miguel", "+15205550133");
  await ensure("Danny", "+15205550155");
  if (owner) await db.update(schema.teamMembers).set({ whatsappOptedIn: true, isOnCall: false }).where(eq(schema.teamMembers.id, owner.id));
  const cov = await db.select().from(schema.coverage).where(eq(schema.coverage.memberId, ruben.id));
  if (!cov.length) await db.insert(schema.coverage).values([...[0, 1, 2, 3, 4].map((weekday) => ({ memberId: ruben.id, weekday })), ...[0, 1, 3, 4, 5].map((weekday) => ({ memberId: miguel.id, weekday }))]);
  const byName = (n: string | undefined) => (n === "Jimmy" ? owner : members.find((m) => m.name === n)) ?? owner;

  // Tonight's prices, with what the demo nights already cleared.
  const live = await db.select().from(schema.priceRules).where(and(eq(schema.priceRules.customerId, customerId), gt(schema.priceRules.expiresAt, now)));
  if (!live.length) {
    const expires = local(tz, ty, tm, td + 1, 6, 0);
    await db.insert(schema.priceRules).values([
      { customerId, product: "Vine-ripe tomatoes", size: "4x4", pack: "25 lb", minPrice: "8.50", caseLimit: 600, casesCleared: 280, expiresAt: expires },
      { customerId, product: "Vine-ripe tomatoes", size: "4x5", pack: "25 lb", minPrice: "7.50", caseLimit: 400, casesCleared: 120, expiresAt: expires },
      { customerId, product: "Roma tomatoes", size: "5x6", pack: "25 lb", minPrice: "7.25", caseLimit: 400, casesCleared: 200, expiresAt: expires },
      { customerId, product: "Red bell peppers", size: "XL", pack: "25 lb", minPrice: "11.00", caseLimit: 300, casesCleared: 0, on: false, expiresAt: expires },
    ]);
  }
  await db.update(schema.customers).set({ status: "live" }).where(eq(schema.customers.id, customerId));
  await db.update(schema.lines).set({ lastForwardingTestAt: local(tz, ty, tm, td - 2, 17, 30), lastForwardingTestOk: true }).where(eq(schema.lines.customerId, customerId));

  const [{ top }] = await db.select({ top: max(schema.requests.ref) }).from(schema.requests).where(eq(schema.requests.customerId, customerId));
  let ref = (top ?? 1000) + 1;
  const buyers = new Map<string, string>();
  let added = 0;

  for (const s of SPECS) {
    const [hh, mm] = s.time.split(":").map(Number);
    // "night N" = the evening N days before today; times before 06:00 belong to the following morning.
    const dayOffset = -s.night + (hh < 6 ? 1 : 0);
    const at = local(tz, ty, tm, td + dayOffset, hh, mm);
    if (at > now) continue;
    const min = (n: number) => new Date(at.getTime() + n * 60 * 1000);

    let buyerId = buyers.get(s.buyer);
    if (!buyerId) {
      const [b] = await db.insert(schema.buyers).values({ customerId, company: s.buyer, city: s.city, contactName: s.contact, phones: [s.phone], firstSeenAt: s.newBuyer ? at : local(tz, ty, tm - 2, 12, 9, 0) }).returning();
      buyerId = b.id; buyers.set(s.buyer, b.id);
    }
    const type = s.type ?? "new_order";
    const status = s.outcome === "auto" || s.outcome === "approve" || s.outcome === "counter" || s.outcome === "won_after_takeover" ? "approved" : s.outcome === "reject" ? "rejected" : "in_progress";
    const flags = [...(s.newBuyer ? ["new_buyer"] : []), ...(s.urgent ? ["urgent"] : []), ...(s.lines?.some((l) => l.notOnSheet) ? ["not_on_sheet"] : [])];
    const by = byName(s.by);
    const [r] = await db.insert(schema.requests).values({
      customerId, ref, channel: s.channel, buyerId, callerName: s.contact, callerCompany: s.buyer, callbackNumber: s.phone, receivedAt: at, type, flags,
      status: s.outcome === "auto" ? "auto_cleared" : status, summary: s.summary ?? null, language: s.language ?? "en", callbackPermission: true,
      transcript: s.transcript.replace("{ref}", String(ref)), assisted: s.outcome === "won_after_takeover", takeOverOutcome: s.outcome === "won_after_takeover" ? "won" : null,
      decidedById: s.outcome === "approve" || s.outcome === "counter" || s.outcome === "reject" || s.outcome === "won_after_takeover" ? by?.id ?? null : null,
      claimedById: s.outcome === "taken_over" || s.outcome === "won_after_takeover" ? by?.id ?? null : null, claimedAt: s.outcome === "taken_over" || s.outcome === "won_after_takeover" ? min(9) : null,
      enteredAt: s.night === 2 && (s.outcome === "auto" || s.outcome === "approve" || s.outcome === "counter") ? local(tz, ty, tm, td - 1, 7, 15) : null,
    }).returning();
    ref++; added++;
    for (const l of s.lines ?? []) {
      const d = local(tz, ty, tm, td + dayOffset, 12, 0);
      const wd = localParts(d, tz).weekday; // Monday = 0
      const ahead = ((PICKUP[l.pickup] - wd + 7) % 7) || 7;
      const pickupDate = localParts(new Date(d.getTime() + ahead * 86400000), tz).isoDate;
      await db.insert(schema.orderLines).values({ requestId: r.id, product: l.product, size: l.size, pack: l.pack ?? null, cases: l.cases, priceOffered: l.offered.toFixed(2), finalPrice: l.final != null && status === "approved" ? l.final.toFixed(2) : null, pickupDate, fulfillment: l.fulfillment ?? "collect", destination: l.destination ?? null, notOnSheet: l.notOnSheet ?? false });
    }
    const ev = (type: string, offset: number, payload: Record<string, unknown> = {}) => db.insert(schema.events).values({ customerId, requestId: r.id, type, payload, at: min(offset) });
    const repMsg = (direction: "in" | "out", member: typeof owner, body: string, offset: number) => db.insert(schema.messages).values({ customerId, requestId: r.id, direction, party: "rep", channel: "whatsapp", body, memberId: member?.id ?? null, sentAt: min(offset), providerId: `demo:${r.id}:${offset}:${direction}:${member?.id ?? "x"}` });
    await ev("request.created", 0, { channel: s.channel });
    const reps = [owner, ruben, miguel].filter(Boolean);
    const cardText = `${s.channel === "call" ? "CALL" : "TEXT"} · ${s.buyer} (${s.city}) · ${s.lines?.[0] ? `${s.lines[0].cases} cs ${s.lines[0].product} ${s.lines[0].size} · offers $${s.lines[0].offered.toFixed(2)}` : s.summary} · #${r.ref}`;
    if (s.outcome === "auto") {
      await ev("autoclear.cleared", 0, { price: s.lines?.[0]?.final });
      await ev("deal.confirmed", 1, { source: "auto" });
    } else {
      await ev("autoclear.declined", 0, { reason: s.outcome === "won_after_takeover" ? "over tonight's case limit" : s.lines?.some((l) => l.notOnSheet) ? "product not on tonight's sheet" : type !== "new_order" ? "not an order" : s.lines && s.lines.length > 1 ? "two products on one call" : "below tonight's price" });
      await ev("card.sent", 1, { recipients: reps.map((m) => m!.id) });
      for (const m of reps) await repMsg("out", m, cardText, 1);
      if (s.urgent) await ev("card.urgent_ring", 2, {});
      if (s.outcome === "approve") { await repMsg("in", by, "Approve", 16); await ev("decision.approve", 16, { by: by?.id }); await db.insert(schema.decisions).values({ requestId: r.id, memberId: by?.id, action: "approve", undoDeadline: min(18), executedAt: min(18), createdAt: min(16) }); await ev("deal.confirmed", 18, { source: "approve", by: by?.id }); }
      if (s.outcome === "counter") { await repMsg("in", by, String(s.counter), 12); await ev("decision.counter", 12, { by: by?.id, price: s.counter }); const [d] = await db.insert(schema.decisions).values({ requestId: r.id, memberId: by?.id, action: "counter", counterPrice: s.counter!.toFixed(2), undoDeadline: min(14), executedAt: min(14), createdAt: min(12) }).returning(); await ev("callback.placed", 14, { intent: "counter" }); await db.insert(schema.callbacks).values({ requestId: r.id, channel: "voice", attempts: 1, outcome: "confirmed", buyerYesAt: min(17), lastAttemptAt: min(14), decisionId: d.id, offerCases: s.lines?.[0]?.cases, offerPrice: s.counter!.toFixed(2), providerConversationId: `demo:${r.id}` }); await ev("deal.confirmed", 17, { source: "counter", by: by?.id }); }
      if (s.outcome === "reject") { await repMsg("in", by, "Reject", 20); await repMsg("in", by, s.reason ?? "", 21); await ev("decision.reject", 21, { by: by?.id, reason: s.reason }); await db.insert(schema.decisions).values({ requestId: r.id, memberId: by?.id, action: "reject", reason: s.reason, undoDeadline: min(23), executedAt: min(23), createdAt: min(21) }); await ev("request.rejected", 23, {}); }
      if (s.outcome === "taken_over" || s.outcome === "won_after_takeover") { await repMsg("in", by, "Take over", 9); await ev("decision.take_over", 9, { by: by?.id }); await db.insert(schema.decisions).values({ requestId: r.id, memberId: by?.id, action: "take_over", createdAt: min(9), executedAt: min(9) }); }
      if (s.outcome === "won_after_takeover") { await repMsg("in", by, "Won, 8.40", 38); await ev("takeover.won", 38, { by: by?.id }); await db.insert(schema.decisions).values({ requestId: r.id, memberId: by?.id, action: "won", createdAt: min(38), executedAt: min(38) }); }
      if (s.outcome === "waiting" && s.night >= 1 && !s.urgent) await ev("card.reminder.oncall", 10, {});
    }
  }
  await db.insert(schema.events).values({ customerId, type: "demo.seeded", payload: { added }, at: now });
  return { added };
}
