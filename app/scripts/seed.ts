// Local development data: Del Campo Supreme with three reps, tonight's rules and
// a week of requests, so the panel has something to show.
//   PGLITE_DIR=.pglite SOBA_DRY_RUN=1 npx tsx scripts/seed.ts
import { getDb, schema } from "../src/db";
import { provisionCustomer } from "../src/lib/provision";
import { handleIntake } from "../src/lib/intake";
import { handleRepMessage } from "../src/lib/decisions";
import { executeDecision, handleCallbackOutcome } from "../src/lib/callbacks";
import type { ExtractedRequest, ResolvedLine } from "../src/lib/extract";
import { eq } from "drizzle-orm";

const line = (o: Partial<ResolvedLine>): ResolvedLine => ({ product: "vine-ripes", productCanonical: "Vine-ripe tomatoes", size: "4x4", pack: "25 lb 2-layer", cases: 300, priceOffered: 8.5, pickup: "Monday", pickupDate: "2026-11-09", fulfillment: "collect", destination: null, poNumber: null, ...o });
const x = (o: Partial<ExtractedRequest>, lines: ResolvedLine[]): ExtractedRequest & { resolvedLines: ResolvedLine[] } => ({ type: "new_order", callerName: "Mike Torres", callerCompany: "Lopez Bros", callerCity: "Chicago", callbackNumber: "312-555-0142", callbackPermission: true, preferredChannel: "call", lines, language: "en", flags: [], summary: "", complaint: null, ...o, resolvedLines: lines });

async function main() {
  process.env.SOBA_DRY_RUN = "1";
  const db = await getDb();
  const existing = await db.select().from(schema.customers);
  if (existing.length) { console.log("Already seeded:", existing.map((c) => `${c.name} → /p/${c.panelToken}`).join("\n")); return; }
  const { customer, owner } = await provisionCustomer(db, { name: "Del Campo Supreme", owner: { name: "Jimmy", cell: "+15205550111", email: "jimmy@example.com" }, voiceNumber: "+15205550190", companyNumber: "+15205550100", textNumber: "+15205550177" });
  await db.update(schema.customers).set({ status: "live" }).where(eq(schema.customers.id, customer.id));
  const [ruben, miguel] = await db.insert(schema.teamMembers).values([
    { customerId: customer.id, name: "Ruben", cell: "+15205550142", whatsappOptedIn: true, canApprove: true, canSetPrices: true },
    { customerId: customer.id, name: "Miguel", cell: "+15205550133", whatsappOptedIn: true, canApprove: true },
    { customerId: customer.id, name: "Danny", cell: "+15205550155", whatsappOptedIn: true, canApprove: true },
  ]).returning();
  await db.update(schema.teamMembers).set({ whatsappOptedIn: true, isOnCall: false }).where(eq(schema.teamMembers.id, owner.id));
  await db.update(schema.teamMembers).set({ isOnCall: true }).where(eq(schema.teamMembers.id, ruben.id));
  await db.insert(schema.coverage).values([...[0, 1, 2, 3, 4].map((weekday) => ({ memberId: ruben.id, weekday })), ...[0, 1, 3, 4, 5].map((weekday) => ({ memberId: miguel.id, weekday }))]);
  const tonight = new Date(); tonight.setHours(tonight.getHours() + 12);
  await db.insert(schema.priceRules).values([
    { customerId: customer.id, product: "Vine-ripe tomatoes", size: "4x4", pack: "25 lb", minPrice: "8.50", caseLimit: 600, casesCleared: 0, expiresAt: tonight },
    { customerId: customer.id, product: "Vine-ripe tomatoes", size: "4x5", pack: "25 lb", minPrice: "7.50", caseLimit: 400, casesCleared: 0, expiresAt: tonight },
    { customerId: customer.id, product: "Roma tomatoes", size: "5x6", pack: "25 lb", minPrice: "7.25", caseLimit: 400, casesCleared: 0, expiresAt: tonight },
    { customerId: customer.id, product: "Red bell peppers", size: "XL", pack: "25 lb", minPrice: "11.00", caseLimit: 300, casesCleared: 0, on: false, expiresAt: tonight },
  ]);
  const h = (n: number) => new Date(Date.now() - n * 60 * 60 * 1000);
  const cid = customer.id;
  // A week of after-hours traffic.
  await handleIntake(db, { customerId: cid, channel: "call", transcript: "Buyer: Mike at Lopez Bros, 300 cases 4x4 vine-ripes Monday at eight fifty.\nDesk: 300 cases 4x4 vine-ripe tomatoes, 25 lb, Monday pickup at $8.50. You're confirmed.", now: h(30), extracted: x({}, [line({ cases: 300, priceOffered: 8.5 })]) });
  const r2 = await handleIntake(db, { customerId: cid, channel: "text", transcript: "Buyer: 440 cs red bells XL for Tuesday, $11?\nDesk: 440 cases XL red bells, 25 lb, Tuesday pickup at $11.00. I'll pass it to the team.", now: h(28), extracted: x({ callerName: "Ana Ruiz", callerCompany: "Fresh Way", callerCity: "Toronto", callbackNumber: "416-555-0188" }, [line({ product: "red bells", productCanonical: "Red bell peppers", size: "XL", cases: 440, priceOffered: 11, pickup: "Tuesday", pickupDate: "2026-11-10" })]) });
  if (r2.outcome === "card_sent") { await handleRepMessage(db, { member: ruben, text: "approve", now: h(27.5) }); const [d] = await db.select().from(schema.decisions).where(eq(schema.decisions.requestId, r2.requestId)); await executeDecision(db, d.id, h(27.4)); }
  const r3 = await handleIntake(db, { customerId: cid, channel: "call", transcript: "Buyer: Romas, 5 by 6, 300 cases, I want seven twenty-five.\nDesk: 300 cases of 5x6 Romas at $7.25. I'll pass it to the team now.", now: h(50), extracted: x({ callerName: "Luis Garcia", callerCompany: "Garcia Produce", callerCity: "Houston", callbackNumber: "713-555-0110" }, [line({ product: "romas", productCanonical: "Roma tomatoes", size: "5x6", cases: 300, priceOffered: 7.0 })]) });
  if (r3.outcome === "card_sent") { await handleRepMessage(db, { member: ruben, text: "7.25", now: h(49.8) }); const [d] = await db.select().from(schema.decisions).where(eq(schema.decisions.requestId, r3.requestId)); await executeDecision(db, d.id, h(49.7)); const [cb] = await db.select().from(schema.callbacks).where(eq(schema.callbacks.requestId, r3.requestId)); if (cb.providerConversationId) await handleCallbackOutcome(db, cb.providerConversationId, { outcome: "confirmed" }, h(49.6)); }
  await handleIntake(db, { customerId: cid, channel: "call", transcript: "Buyer: 200 Romas 5x6, best I can do is six seventy-five.\nDesk: 200 cases of 5x6 Romas at $6.75. I'll pass it to the team.", now: h(3), extracted: x({ callerName: "Sara Kim", callerCompany: "Valley Fresh", callerCity: "Phoenix", callbackNumber: "602-555-0150" }, [line({ product: "romas", productCanonical: "Roma tomatoes", size: "5x6", cases: 200, priceOffered: 6.75 })]) });
  await handleIntake(db, { customerId: cid, channel: "text", transcript: "Buyer: 150 cs 4x5 VR Thursday, $9?\nDesk: 150 cases of 4x5 vine-ripes for Thursday at $9.00. Passing it to the team.", now: h(2), extracted: x({ callerName: "Joe Park", callerCompany: "North Market", callerCity: "Denver", callbackNumber: "303-555-0123" }, [line({ size: "4x5", cases: 150, priceOffered: 9, pickup: "Thursday", pickupDate: "2026-11-12", fulfillment: "delivered", destination: "Denver" })]) });
  const r6 = await handleIntake(db, { customerId: cid, channel: "call", transcript: "Buyer: 100 cases large red bells at eight dollars.\nDesk: 100 cases of large red bells at $8.00. I'll pass it to the team.", now: h(60), extracted: x({ callerName: "Rita Lowe", callerCompany: "Sunny Foods", callerCity: "Dallas", callbackNumber: "214-555-0199" }, [line({ product: "red bells", productCanonical: "Red bell peppers", size: "L", cases: 100, priceOffered: 8 })]) });
  if (r6.outcome === "card_sent") { await handleRepMessage(db, { member: miguel, text: "Reject", buttonPayload: `reject:${r6.requestId}`, now: h(59.9) }); await handleRepMessage(db, { member: miguel, text: "too low for this week", now: h(59.8) }); const [d] = await db.select().from(schema.decisions).where(eq(schema.decisions.requestId, r6.requestId)); await executeDecision(db, d.id, h(59.7)); }
  await handleIntake(db, { customerId: cid, channel: "call", transcript: "Buyer: Is my truck loaded yet? Driver's been waiting since six.\nDesk: I'll get the team to call you about the pickup.", now: h(1), extracted: x({ type: "pickup", callerName: "Pedro Vega", callerCompany: "Rio Grande Foods", callerCity: "San Antonio", callbackNumber: "210-555-0170", summary: "Pedro at Rio Grande Foods asking if his truck is loaded; driver waiting since 6" }, []) });
  console.log(`Seeded. Panel: http://localhost:3000/p/${customer.panelToken}\nAdmin: http://localhost:3000/admin?key=${process.env.ADMIN_TOKEN ?? "dev-admin"}`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
