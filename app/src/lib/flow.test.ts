// The whole loop offline: intake → card → rep decision → undo window →
// callback → outcome → confirmation and order card. Dry-run providers; every
// outbound message is still logged, so the assertions read the messages table.
import { describe, it, expect, beforeAll } from "vitest";
import { and, eq } from "drizzle-orm";
import { getDb, resetDbForTests, schema, type Db } from "@/db";
import { DEFAULT_HOURS } from "./hours";
import { handleIntake } from "./intake";
import { handleRepMessage } from "./decisions";
import { executeDecision, handleCallbackOutcome, handleBuyerOfferReply } from "./callbacks";
import { sentEvents } from "@/inngest/send";
import type { ExtractedRequest, ResolvedLine } from "./extract";
import { parseRuleCommand, applyRuleCommand, answerSheetReadBack, resolveUntil } from "./rules";
import { buildSummary, whatsappSummary, emailSummary, windowStartFor } from "./summary";
import { nightlyTick } from "@/inngest/functions";

process.env.SOBA_DRY_RUN = "1";

const SUN_2AM = new Date("2026-11-08T09:14:00Z"); // Sun 2:14am Arizona
let db: Db; let customerId: string; let ruben: typeof schema.teamMembers.$inferSelect; let miguel: typeof schema.teamMembers.$inferSelect;

const line = (over: Partial<ResolvedLine> = {}): ResolvedLine => ({ product: "vine-ripes", productCanonical: "Vine-ripe tomatoes", size: "4x4", pack: "25 lb 2-layer", cases: 300, priceOffered: 8.25, pickup: "Monday", pickupDate: "2026-11-09", fulfillment: "collect", destination: null, poNumber: null, ...over });
const extracted = (over: Partial<ExtractedRequest> = {}, lines: ResolvedLine[] = [line()]): ExtractedRequest & { resolvedLines: ResolvedLine[] } => ({
  type: "new_order", callerName: "Mike Torres", callerCompany: "Lopez Bros", callerCity: "Chicago", callbackNumber: "312-555-0142", callbackPermission: true,
  preferredChannel: "call", lines, language: "en", flags: [], summary: "Mike at Lopez Bros wants 300 cs 4x4 VR at $8.25, Mon pickup", complaint: null, ...over, resolvedLines: lines,
});
const msgsFor = (requestId: string) => db.select().from(schema.messages).where(eq(schema.messages.requestId, requestId)).orderBy(schema.messages.sentAt);
const req = (id: string) => db.select().from(schema.requests).where(eq(schema.requests.id, id)).then((r) => r[0]);

beforeAll(async () => {
  resetDbForTests();
  db = await getDb();
  const [c] = await db.insert(schema.customers).values({ name: "Del Campo Supreme", status: "live" }).returning();
  customerId = c.id;
  await db.insert(schema.settings).values({ customerId, hours: DEFAULT_HOURS, greeting: "Del Campo Supreme, sales. How can I help?", undoSeconds: 120 });
  await db.insert(schema.lines).values([
    { customerId, kind: "voice", twilioNumber: "+15205550190", companyNumber: "+15205550100", elevenPhoneNumberId: "pn_1" },
    { customerId, kind: "text", twilioNumber: "+15205550177" },
  ]);
  [ruben, miguel] = await db.insert(schema.teamMembers).values([
    { customerId, name: "Ruben", cell: "+15205550142", whatsappOptedIn: true, canApprove: true, canSetPrices: true, isOnCall: true, isOwner: true, email: "ruben@example.com", summaryEmail: true },
    { customerId, name: "Miguel", cell: "+15205550133", whatsappOptedIn: true, canApprove: true },
  ]).returning();
  await db.insert(schema.coverage).values([0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ memberId: miguel.id, weekday })));
  await db.insert(schema.priceRules).values({ customerId, product: "Vine-ripe tomatoes", size: "4x4", pack: "25 lb", minPrice: "8.50", caseLimit: 600, expiresAt: new Date("2026-11-09T13:00:00Z") });
});

describe("intake", () => {
  it("auto-clears an after-hours order at the rule's price and sends confirmation plus order card", async () => {
    const r = await handleIntake(db, { customerId, channel: "call", transcript: "Buyer: 200 cs 4x4 VR at 8.75 Monday", now: SUN_2AM, callerId: "+13125550142", providerConversationId: "conv_auto", extracted: extracted({}, [line({ cases: 200, priceOffered: 8.75 })]) });
    expect(r.outcome).toBe("auto_cleared");
    if (r.outcome !== "auto_cleared") return;
    const msgs = await msgsFor(r.requestId);
    const toBuyer = msgs.find((m) => m.party === "desk" && m.direction === "out");
    expect(toBuyer?.body).toContain("confirmed 200 cases 4x4 Vine-ripe tomatoes 25 lb 2-layer at $8.75, pickup Mon, Nov 9. Ref 1001");
    const orderCards = msgs.filter((m) => m.party === "rep" && m.body?.startsWith("ORDER · ref 1001"));
    expect(orderCards.length).toBeGreaterThan(0);
    expect(orderCards[0].body).toContain("Rule:      200 of 600 cases sold");
    const [rule] = await db.select().from(schema.priceRules).where(eq(schema.priceRules.customerId, customerId));
    expect(rule.casesCleared).toBe(200);
  });

  it("sends a card to the scheduled reps when the offer is below the rule, and starts the escalation clock", async () => {
    sentEvents.length = 0;
    const r = await handleIntake(db, { customerId, channel: "call", transcript: "Buyer: 300 cs at 8.25", now: new Date(SUN_2AM.getTime() + 5 * 60 * 60 * 1000), callerId: "+17735550111", providerConversationId: "conv_card", extracted: extracted({ callbackNumber: "773-555-0111", callerName: "Ana Ruiz", callerCompany: "Fresh Way", callerCity: "Toronto" }) });
    expect(r.outcome).toBe("card_sent");
    if (r.outcome !== "card_sent") return;
    expect(r.reason).toMatch(/below the rule/);
    const msgs = await msgsFor(r.requestId);
    const cards = msgs.filter((m) => m.party === "rep" && m.body?.includes("NEW REQUEST · ref 1002"));
    expect(new Set(cards.map((m) => m.memberId))).toEqual(new Set([ruben.id, miguel.id]));
    expect(cards[0].body).toContain("Ana Ruiz · Fresh Way (Toronto) · 773-555-0111");
    expect(sentEvents.some((e) => e.name === "soba/card.sent")).toBe(true);
  });

  it("logs spam without a card", async () => {
    const r = await handleIntake(db, { customerId, channel: "call", transcript: "robocall", now: SUN_2AM, extracted: extracted({ type: "other", flags: ["spam"], callbackNumber: null }, []) });
    expect(r.outcome).toBe("spam");
  });
});

describe("rep decisions", () => {
  let requestId: string;
  beforeAll(async () => { requestId = (await db.select().from(schema.requests).where(eq(schema.requests.ref, 1002)))[0].id; });

  it("the second rep to tap is told who took it", async () => {
    const now = new Date(SUN_2AM.getTime() + 5 * 60 * 60 * 1000 + 60_000);
    const a = await handleRepMessage(db, { member: ruben, text: "Counter", buttonPayload: `counter:${requestId}`, now });
    expect(a.action).toBe("ask_counter");
    expect(a.replies[0]).toMatch(/final price/i);
    const b = await handleRepMessage(db, { member: miguel, text: "Approve", buttonPayload: `approve:${requestId}`, now });
    expect(b.action).toBe("taken");
    expect(b.replies[0]).toBe("Already taken by Ruben.");
  });

  it("a typed price completes the counter, with an undo window, and the others are told", async () => {
    sentEvents.length = 0;
    const now = new Date(SUN_2AM.getTime() + 5 * 60 * 60 * 1000 + 120_000);
    const r = await handleRepMessage(db, { member: ruben, text: "8.50 max 200", now });
    expect(r.action).toBe("counter");
    expect(r.replies[0]).toBe("Calling Ana with $8.50 for up to 200 cs, once. Reply UNDO within 2 minutes to stop.");
    const [d] = await db.select().from(schema.decisions).where(eq(schema.decisions.requestId, requestId));
    expect(d.counterPrice).toBe("8.50"); expect(d.quantity).toBe(200);
    expect(sentEvents.find((e) => e.name === "soba/decision.made")).toBeTruthy();
    const toMiguel = (await msgsFor(requestId)).filter((m) => m.memberId === miguel.id && m.body?.includes("took ref 1002"));
    expect(toMiguel[0].body).toBe("Ruben took ref 1002: countered $8.50.");
  });

  it("undo inside the window stops the callback", async () => {
    const now = new Date(SUN_2AM.getTime() + 5 * 60 * 60 * 1000 + 150_000);
    const r = await handleRepMessage(db, { member: ruben, text: "undo", now });
    expect(r.action).toBe("undone");
    const [d] = await db.select().from(schema.decisions).where(eq(schema.decisions.requestId, requestId));
    const exec = await executeDecision(db, d.id, new Date(now.getTime() + 200_000));
    expect(exec).toEqual({ skipped: "undone" });
  });

  it("approve → callback placed after the window → buyer confirms → approved, confirmation and order card", async () => {
    const now = new Date(SUN_2AM.getTime() + 5 * 60 * 60 * 1000 + 300_000);
    const r = await handleRepMessage(db, { member: ruben, text: "yes but only 250", now });
    expect(r.action).toBe("approve");
    expect(r.replies[0]).toBe("Calling Ana now to confirm 250 cs at $8.25. Reply UNDO within 2 minutes to stop.");
    const decisions = await db.select().from(schema.decisions).where(and(eq(schema.decisions.requestId, requestId), eq(schema.decisions.undone, false)));
    const exec = await executeDecision(db, decisions[decisions.length - 1].id, new Date(now.getTime() + 130_000));
    expect(exec).toMatchObject({ done: "called" });
    const [cb] = await db.select().from(schema.callbacks).where(eq(schema.callbacks.requestId, requestId));
    expect(cb.offerCases).toBe(250); expect(cb.offerPrice).toBe("8.25");
    const out = await handleCallbackOutcome(db, cb.providerConversationId!, { outcome: "confirmed", transcript: "Buyer: yes that works" }, new Date(now.getTime() + 200_000));
    expect(out).toEqual({ done: "confirmed" });
    const request = await req(requestId);
    expect(request.status).toBe("approved"); expect(request.decidedById).toBe(ruben.id);
    const msgs = await msgsFor(requestId);
    expect(msgs.find((m) => m.party === "desk" && m.body?.includes("confirmed 250 cases"))?.body).toContain("Ref 1002");
    const card = msgs.filter((m) => m.memberId === ruben.id && m.body?.startsWith("ORDER · ref 1002"));
    expect(card[0].body).toContain("Qty:       250 cs"); expect(card[0].body).toContain("Price:     $8.25/cs FOB");
    expect(await handleCallbackOutcome(db, cb.providerConversationId!, { outcome: "confirmed" }, now)).toEqual({ ignored: "already settled" });
  });

  it("reject asks for a reason, then tells the buyer after the window", async () => {
    const now = new Date(SUN_2AM.getTime() + 6 * 60 * 60 * 1000);
    const r = await handleIntake(db, { customerId, channel: "call", transcript: "x", now, extracted: extracted({ callbackNumber: "214-555-0199", callerName: "Rita Lowe", callerCompany: "Sunny Foods" }, [line({ priceOffered: 8.0, cases: 100 })]) });
    if (r.outcome !== "card_sent") throw new Error("expected card");
    const a = await handleRepMessage(db, { member: miguel, text: "no", now });
    expect(a.action).toBe("ask_reason");
    const b = await handleRepMessage(db, { member: miguel, text: "we're short this week", now: new Date(now.getTime() + 30_000) });
    expect(b.action).toBe("reject");
    expect(b.replies[0]).toContain("we're short this week");
    const [d] = await db.select().from(schema.decisions).where(eq(schema.decisions.requestId, r.requestId));
    await executeDecision(db, d.id, new Date(now.getTime() + 200_000));
    expect((await req(r.requestId)).status).toBe("rejected");
    const toBuyer = (await msgsFor(r.requestId)).find((m) => m.party === "desk");
    expect(toBuyer?.body).toBe("Del Campo Supreme: sorry, we can't fill your request (ref 1003): we're short this week. Thanks for calling.");
  });

  it("take over, then won, counts as assisted", async () => {
    const now = new Date(SUN_2AM.getTime() + 7 * 60 * 60 * 1000);
    const r = await handleIntake(db, { customerId, channel: "text", transcript: "x", now, extracted: extracted({ callbackNumber: "303-555-0123", callerName: "Joe Park", callerCompany: "North Market" }, [line({ priceOffered: 9, cases: 150, size: "4x5" })]) });
    if (r.outcome !== "card_sent") throw new Error("expected card");
    const a = await handleRepMessage(db, { member: ruben, text: "take", now });
    expect(a.replies[0]).toBe("It's yours: Joe Park, 303-555-0123. Reply WON or LOST when it's settled.");
    const b = await handleRepMessage(db, { member: ruben, text: "won", now: new Date(now.getTime() + 600_000) });
    expect(b.action).toBe("won");
    const request = await req(r.requestId);
    expect(request.status).toBe("approved"); expect(request.assisted).toBe(true); expect(request.takeOverOutcome).toBe("won");
  });

  it("a typed yes on a non-order card is refused; take over works", async () => {
    const now = new Date(SUN_2AM.getTime() + 7.5 * 60 * 60 * 1000);
    const r = await handleIntake(db, { customerId, channel: "call", transcript: "x", now, extracted: extracted({ type: "pickup", callbackNumber: "210-555-0170", callerName: "Pedro Vega", callerCompany: "Rio Grande Foods", summary: "Asks if his truck is loaded" }, []) });
    if (r.outcome !== "card_sent") throw new Error("expected card");
    const a = await handleRepMessage(db, { member: miguel, text: "yes", now });
    expect(a.action).toBe("not_an_order");
    const b = await handleRepMessage(db, { member: miguel, text: "take", now });
    expect(b.action).toBe("take_over");
    await handleRepMessage(db, { member: miguel, text: "lost", now: new Date(now.getTime() + 60_000) });
    expect((await req(r.requestId)).status).toBe("rejected");
  });

  it("a counter on a text request is texted, and the buyer's YES confirms it", async () => {
    const now = new Date(SUN_2AM.getTime() + 8 * 60 * 60 * 1000);
    const r = await handleIntake(db, { customerId, channel: "text", transcript: "x", now, extracted: extracted({ callbackNumber: "602-555-0150", callerName: "Sara Kim", callerCompany: "Valley Fresh" }, [line({ priceOffered: 6.75, cases: 200, product: "romas", productCanonical: "Roma tomatoes", size: "5x6" })]) });
    if (r.outcome !== "card_sent") throw new Error("expected card");
    await handleRepMessage(db, { member: ruben, text: "7.25", now });
    const [d] = await db.select().from(schema.decisions).where(eq(schema.decisions.requestId, r.requestId));
    const exec = await executeDecision(db, d.id, new Date(now.getTime() + 130_000));
    expect(exec).toEqual({ done: "counter_texted" });
    const offer = (await msgsFor(r.requestId)).find((m) => m.party === "desk");
    expect(offer?.body).toBe(`Del Campo Supreme: we can do 200 cases 5x6 Roma tomatoes 25 lb 2-layer at $7.25, pickup Mon, Nov 9 (ref ${r.ref}). Reply YES to confirm or NO.`);
    expect(await handleBuyerOfferReply(db, r.requestId, "Yes", new Date(now.getTime() + 300_000))).toBe("confirmed");
    const request = await req(r.requestId);
    expect(request.status).toBe("approved");
    const [l] = await db.select().from(schema.orderLines).where(eq(schema.orderLines.requestId, r.requestId));
    expect(l.finalPrice).toBe("7.25");
  });
});

describe("price rule commands", () => {
  it("parses the spec's command forms", () => {
    expect(parseRuleCommand("4x4 VR 8.50 600 till Mon 7am")).toEqual({ kind: "rules", rules: [{ product: "Vine-ripe tomatoes", size: "4x4", pack: null, minPrice: 8.5, caseLimit: 600 }], until: "Mon 7am" });
    expect(parseRuleCommand("pause Romas")).toEqual({ kind: "pause", target: "Roma tomatoes" });
    expect(parseRuleCommand("pause all")).toEqual({ kind: "pause", target: null });
    expect(parseRuleCommand("same as last night")).toEqual({ kind: "same" });
    expect(parseRuleCommand("red bells XL 25 lb 11.00 300")).toMatchObject({ kind: "rules", rules: [{ product: "Red bell peppers", size: "XL", pack: "25 lb", minPrice: 11, caseLimit: 300 }] });
    expect(parseRuleCommand("yes but only 200")).toBeNull();
    expect(parseRuleCommand("8.50 max 200")).toBeNull();
  });

  it("resolves 'till Mon 7am' in Arizona time", () => {
    expect(resolveUntil("Mon 7am", SUN_2AM, "America/Phoenix")?.toISOString()).toBe("2026-11-09T14:00:00.000Z");
  });

  it("goes live, pauses and reports status", async () => {
    const now = new Date("2026-11-09T01:00:00Z"); // Sun 6pm Arizona
    const staged = await applyRuleCommand(db, { customerId, memberId: ruben.id, cmd: parseRuleCommand("romas 5x6 7.25 400; 4x4 VR 8.75 500")!, now });
    if (typeof staged === "string") throw new Error("typed rules should be staged for a YES");
    expect(staged.text).toContain("Loaded 2 prices, live until Mon 6:00 AM");
    expect(staged.text).toContain("• 5x6 Roma tomatoes $7.25 up to 400 cases");
    expect(staged.text).toContain("Reply YES to go live");
    const live = await answerSheetReadBack(db, { customerId, memberId: ruben.id, sheetId: staged.pendingSheetId, text: "yes", now });
    expect(live.live).toBe(true);
    const paused = await applyRuleCommand(db, { customerId, memberId: ruben.id, cmd: { kind: "pause", target: "Roma tomatoes" }, now });
    expect(paused).toContain("Paused 5x6 Roma tomatoes");
    const status = await applyRuleCommand(db, { customerId, memberId: ruben.id, cmd: { kind: "status" }, now });
    expect(status).toContain("5x6 Roma tomatoes $7.25: 0 of 400 sold (paused)");
    expect(status).toContain("4x4 Vine-ripe tomatoes $8.75: 0 of 500 sold");
  });
});

describe("morning summary", () => {
  it("builds the window from last closing and sums the night", async () => {
    const opening = new Date("2026-11-09T13:00:00Z"); // Mon 6am Arizona
    const start = windowStartFor(opening, DEFAULT_HOURS, "America/Phoenix", []);
    expect(start.toISOString()).toBe("2026-11-07T00:00:00.000Z"); // Fri 5pm Arizona (Sat and Sun closed)
    const s = await buildSummary(db, customerId, start, opening, opening);
    expect(s.wonCount).toBe(4); // 1001 auto, 1002 approved, 1004 won, 1005 approved
    expect(s.won).toBe(200 * 8.75 + 250 * 8.25 + 150 * 9 + 200 * 7.25);
    expect(s.autoCount).toBe(1); expect(s.rejectedCount).toBe(1); expect(s.approvedBy).toEqual({ Ruben: 3 });
    const wa = whatsappSummary(s, "https://x/y");
    expect(wa).toContain("• 4 orders won, $6,613"); expect(wa).toContain("• 3 approved by Ruben, 1 auto-cleared"); expect(wa).toContain("• 0 in progress, 1 rejected");
    const e = emailSummary(s, "https://x/y", ["orders", "rules", "other", "transcripts"], true);
    expect(e.subject).toBe("Del Campo Supreme: 4 orders won overnight, $6,613");
    expect(e.html).toContain("Good morning. You won 4 orders overnight.");
    expect(e.html).toContain("Roma tomatoes 5×6, at $7.25 or more: <b>0 of 400 cases</b>");
  });

  it("the nightly clock sends the summary once before opening", async () => {
    const at = new Date("2026-11-09T12:47:00Z"); // Mon 5:47am Arizona, 13 min before opening
    const first = await nightlyTick(at);
    expect(first[customerId]).toContain("summary");
    const again = await nightlyTick(new Date(at.getTime() + 5 * 60 * 1000));
    expect(again[customerId]).not.toContain("summary");
    const [sum] = await db.select().from(schema.summaries).where(eq(schema.summaries.customerId, customerId));
    expect(sum.sentAt).toBeTruthy();
    expect(sum.recipients).toContain("ruben@example.com");
  });
});
