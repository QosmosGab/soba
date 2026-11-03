// The edge cases a produce desk will actually hit: a booking attempted mid-call then
// the transcript arriving, two reps on one card, changed minds inside the undo
// window, orders without a price or a number, buyers who opt out, retries.
import { describe, it, expect, beforeAll } from "vitest";
import { and, eq } from "drizzle-orm";
import { getDb, resetDbForTests, schema, type Db } from "@/db";
import { DEFAULT_HOURS } from "./hours";
import { handleIntake } from "./intake";
import { handleRepMessage, STALE_CLAIM_MS } from "./decisions";
import { executeDecision, handleCallbackOutcome } from "./callbacks";
import { handleBuyerText } from "./textdesk";
import { toE164 } from "./requests";
import { resolvePickupDate } from "./produce";
import { saysYes } from "./buyer-text";
import { parseRuleCommand } from "./rules";
import { nightlyTick } from "./clock";
import { deskTool } from "./tool";
import type { ExtractedRequest, ResolvedLine } from "./extract";

process.env.SOBA_DRY_RUN = "1";
process.env.SOBA_SKIP_SIGNATURES = "1";

const NIGHT = new Date("2026-11-08T09:00:00Z"); // Sun 2am Arizona
let db: Db; let customerId: string; let ruben: typeof schema.teamMembers.$inferSelect; let miguel: typeof schema.teamMembers.$inferSelect;
const line = (o: Partial<ResolvedLine> = {}): ResolvedLine => ({ product: "vine-ripes", productCanonical: "Vine-ripe tomatoes", size: "4x4", pack: "25 lb 2-layer", cases: 300, priceOffered: 8.25, pickup: "Monday", pickupDate: "2026-11-09", fulfillment: "collect", destination: null, poNumber: null, ...o });
const x = (o: Partial<ExtractedRequest> = {}, lines: ResolvedLine[] = [line()]): ExtractedRequest & { resolvedLines: ResolvedLine[] } => ({ type: "new_order", callerName: "Mike Torres", callerCompany: "Lopez Bros", callerCity: "Chicago", callbackNumber: "312-555-0142", callbackPermission: true, preferredChannel: "call", lines, language: "en", flags: [], summary: "", complaint: null, ...o, resolvedLines: lines });
const req = (id: string) => db.select().from(schema.requests).where(eq(schema.requests.id, id)).then((r) => r[0]);
const reqs = () => db.select().from(schema.requests).where(eq(schema.requests.customerId, customerId));
const tool = (body: Record<string, unknown>) => deskTool(db, { called_number: "+15205550190", ...body }, NIGHT).then((r) => r.body as Record<string, unknown> & { cleared?: boolean; ref?: number });

beforeAll(async () => {
  resetDbForTests();
  db = await getDb();
  const [c] = await db.insert(schema.customers).values({ name: "Del Campo Supreme", status: "live" }).returning();
  customerId = c.id;
  await db.insert(schema.settings).values({ customerId, hours: DEFAULT_HOURS, greeting: "x", everyoneGetsCards: true });
  await db.insert(schema.lines).values([{ customerId, kind: "voice", twilioNumber: "+15205550190", companyNumber: "+15205550100" }, { customerId, kind: "text", twilioNumber: "+15205550177" }]);
  [ruben, miguel] = await db.insert(schema.teamMembers).values([
    { customerId, name: "Ruben", cell: "+15205550142", whatsappOptedIn: true, canApprove: true, isOnCall: true, isOwner: true },
    { customerId, name: "Miguel", cell: "+15205550133", whatsappOptedIn: true, canApprove: true },
  ]).returning();
  await db.insert(schema.priceRules).values({ customerId, product: "Vine-ripe tomatoes", size: "4x4", pack: "25 lb", minPrice: "8.50", caseLimit: 400, expiresAt: new Date("2026-11-09T13:00:00Z") });
});

describe("phone numbers", () => {
  it("normalizes US, 11-digit, Mexican and junk", () => {
    expect(toE164("(312) 555-0142")).toBe("+13125550142");
    expect(toE164("1-312-555-0142")).toBe("+13125550142");
    expect(toE164("+52 1 662 123 4567")).toBe("+5216621234567");
    expect(toE164("555-0142")).toBeNull();
    expect(toE164("")).toBeNull();
  });
});

describe("mid-call booking then the transcript", () => {
  it("one request per conversation: not cleared on the call, the transcript sends one card, not two", async () => {
    const r1 = await tool({ action: "try_clear", caller_id: "+13125550142", conversation_id: "conv_A", product: "vine ripes", size: "4x4", pack: "25 lb", cases: 300, price: 8.0, pickup: "Monday", fulfillment: "collect", buyer_name: "Mike Torres", company: "Lopez Bros", callback_number: "312-555-0142", callback_permission: true });
    expect(r1.cleared).toBe(false);
    const r2 = await tool({ action: "try_clear", caller_id: "+13125550142", conversation_id: "conv_A", product: "vine ripes", size: "4x4", pack: "25 lb", cases: 300, price: 8.1, pickup: "Monday", fulfillment: "collect", buyer_name: "Mike Torres", company: "Lopez Bros", callback_number: "312-555-0142" });
    expect(r2.ref).toBe(r1.ref); // the retry did not create a second request
    const post = await handleIntake(db, { customerId, channel: "call", transcript: "Buyer: 300 cs at 8.10", now: new Date(), callerId: "+13125550142", providerConversationId: "conv_A", extracted: x({}, [line({ priceOffered: 8.1 })]) });
    expect(post).toMatchObject({ outcome: "card_sent", ref: r1.ref });
    expect((await reqs()).filter((r) => r.providerConversationId === "conv_A")).toHaveLength(1);
    const cards = await db.select().from(schema.events).where(and(eq(schema.events.requestId, post.outcome === "card_sent" ? post.requestId : ""), eq(schema.events.type, "card.sent")));
    expect(cards).toHaveLength(1);
  });

  it("cleared on the call: the transcript attaches, no second confirmation", async () => {
    const r = await tool({ action: "try_clear", caller_id: "+16025550150", conversation_id: "conv_B", product: "vine ripes", size: "4x4", pack: "25 lb", cases: 100, price: 8.75, pickup: "Monday", fulfillment: "collect", buyer_name: "Sara Kim", company: "Valley Fresh", callback_number: "602-555-0150", callback_permission: true });
    expect(r.cleared).toBe(true);
    const id = (await reqs()).find((q) => q.providerConversationId === "conv_B")!.id;
    const before = (await db.select().from(schema.messages).where(eq(schema.messages.requestId, id))).length;
    const post = await handleIntake(db, { customerId, channel: "call", transcript: "Buyer: 100 cs at 8.75", now: new Date(), callerId: "+16025550150", providerConversationId: "conv_B", extracted: x({ callerName: "Sara Kim", callbackNumber: "602-555-0150" }, [line({ cases: 100, priceOffered: 8.75 })]) });
    expect(post).toMatchObject({ outcome: "auto_cleared", requestId: id });
    expect((await db.select().from(schema.messages).where(eq(schema.messages.requestId, id))).length).toBe(before);
    expect((await req(id)).transcript).toContain("100 cs at 8.75");
  });

  it("two orders can't oversell the rule, and a lost race rolls back", async () => {
    const [rule] = await db.select().from(schema.priceRules).where(eq(schema.priceRules.customerId, customerId));
    expect(rule.casesCleared).toBe(100);
    const a = await handleIntake(db, { customerId, channel: "call", transcript: "x", now: NIGHT, callerId: "+17735550111", providerConversationId: "conv_C", extracted: x({ callbackNumber: "773-555-0111", callerName: "Ana" }, [line({ cases: 250, priceOffered: 8.6 })]) });
    expect(a.outcome).toBe("auto_cleared");
    const b = await handleIntake(db, { customerId, channel: "call", transcript: "x", now: NIGHT, callerId: "+14165550188", providerConversationId: "conv_D", extracted: x({ callbackNumber: "416-555-0188", callerName: "Bo" }, [line({ cases: 100, priceOffered: 8.6 })]) });
    expect(b).toMatchObject({ outcome: "card_sent", reason: expect.stringContaining("50 left") });
    const [after] = await db.select().from(schema.priceRules).where(eq(schema.priceRules.customerId, customerId));
    expect(after.casesCleared).toBe(350);
  });
});

describe("rep edge cases", () => {
  it("a counter tap with no price blocks nobody for long: the claim goes stale", async () => {
    const r = await handleIntake(db, { customerId, channel: "call", transcript: "x", now: NIGHT, extracted: x({ callbackNumber: "214-555-0199", callerName: "Rita Lowe" }, [line({ priceOffered: 8.0 })]) });
    if (r.outcome !== "card_sent") throw new Error("expected card");
    await handleRepMessage(db, { member: ruben, text: "Counter", buttonPayload: `counter:${r.requestId}`, now: NIGHT });
    const blocked = await handleRepMessage(db, { member: miguel, text: "approve", buttonPayload: `approve:${r.requestId}`, now: new Date(NIGHT.getTime() + 60_000) });
    expect(blocked.action).toBe("taken");
    const later = await handleRepMessage(db, { member: miguel, text: "approve", buttonPayload: `approve:${r.requestId}`, now: new Date(NIGHT.getTime() + STALE_CLAIM_MS + 60_000) });
    expect(later.action).toBe("approve");
    expect((await req(r.requestId)).claimedById).toBe(miguel.id);
  });

  it("a second decision inside the undo window replaces the first, so only one thing reaches the buyer", async () => {
    const r = await handleIntake(db, { customerId, channel: "call", transcript: "x", now: NIGHT, extracted: x({ callbackNumber: "210-555-0170", callerName: "Pedro Vega" }, [line({ priceOffered: 8.0 })]) });
    if (r.outcome !== "card_sent") throw new Error("expected card");
    await handleRepMessage(db, { member: ruben, text: "approve", buttonPayload: `approve:${r.requestId}`, now: NIGHT });
    await handleRepMessage(db, { member: ruben, text: "8.50", now: new Date(NIGHT.getTime() + 30_000) });
    const ds = await db.select().from(schema.decisions).where(eq(schema.decisions.requestId, r.requestId));
    expect(ds.map((d) => [d.action, d.undone])).toEqual([["approve", true], ["counter", false]]);
    expect(await executeDecision(db, ds[0].id, new Date(NIGHT.getTime() + 200_000))).toEqual({ skipped: "undone" });
    const exec = await executeDecision(db, ds[1].id, new Date(NIGHT.getTime() + 200_000));
    expect(exec).toMatchObject({ done: "called" });
    expect(await executeDecision(db, ds[1].id, new Date(NIGHT.getTime() + 300_000))).toEqual({ skipped: "already_executed" });
  });

  it("undo frees the claim for the others", async () => {
    const r = await handleIntake(db, { customerId, channel: "call", transcript: "x", now: NIGHT, extracted: x({ callbackNumber: "303-555-0123", callerName: "Joe Park" }, [line({ priceOffered: 8.0 })]) });
    if (r.outcome !== "card_sent") throw new Error("expected card");
    await handleRepMessage(db, { member: ruben, text: "approve", buttonPayload: `approve:${r.requestId}`, now: NIGHT });
    const other = await handleRepMessage(db, { member: miguel, text: "undo", buttonPayload: `undo:${r.requestId}`, now: new Date(NIGHT.getTime() + 10_000) });
    expect(other.action).toBe("not_yours");
    await handleRepMessage(db, { member: ruben, text: "undo", now: new Date(NIGHT.getTime() + 20_000) });
    expect((await req(r.requestId)).claimedById).toBeNull();
    const m = await handleRepMessage(db, { member: miguel, text: "take", buttonPayload: `take_over:${r.requestId}`, now: new Date(NIGHT.getTime() + 30_000) });
    expect(m.action).toBe("take_over");
  });

  it("refuses to approve an order with no price or no number, and one with no way to reach the buyer", async () => {
    const quote = await handleIntake(db, { customerId, channel: "call", transcript: "x", now: NIGHT, extracted: x({ callbackNumber: "510-555-0101", callerName: "Kim Ho", flags: ["wants_quote"] }, [line({ priceOffered: null })]) });
    if (quote.outcome !== "card_sent") throw new Error("expected card");
    const a = await handleRepMessage(db, { member: ruben, text: "approve", buttonPayload: `approve:${quote.requestId}`, now: NIGHT });
    expect(a.action).toBe("incomplete");
    const c = await handleRepMessage(db, { member: ruben, text: "9.25 max 300", now: NIGHT });
    expect(c.action).toBe("counter");
    const noPhone = await handleIntake(db, { customerId, channel: "call", transcript: "x", now: NIGHT, extracted: x({ callbackNumber: null, callerName: "Anon" }, [line()]) });
    if (noPhone.outcome !== "card_sent") throw new Error("expected card");
    expect((await req(noPhone.requestId)).flags).toContain("no_callback");
    const b = await handleRepMessage(db, { member: ruben, text: "approve", buttonPayload: `approve:${noPhone.requestId}`, now: NIGHT });
    expect(b.action).toBe("no_callback");
    const won = await handleRepMessage(db, { member: ruben, text: "won", now: NIGHT });
    expect(won.action).toBe("not_taken_over");
  });

  it("a rep from another customer can't act on this one's card", async () => {
    const [other] = await db.insert(schema.customers).values({ name: "Other Farms", status: "live" }).returning();
    await db.insert(schema.settings).values({ customerId: other.id, hours: DEFAULT_HOURS, greeting: "x" });
    const [stranger] = await db.insert(schema.teamMembers).values({ customerId: other.id, name: "Sam", cell: "+19995550000", whatsappOptedIn: true }).returning();
    const [mine] = (await reqs()).filter((r) => r.status === "in_progress");
    const r = await handleRepMessage(db, { member: stranger, text: "approve", buttonPayload: `approve:${mine.id}`, now: NIGHT });
    expect(r.action).toBe("no_request");
  });
});

describe("callback outcomes", () => {
  it("a repeated post-call webhook is ignored; no answer retries once, then texts the offer", async () => {
    const r = await handleIntake(db, { customerId, channel: "call", transcript: "x", now: NIGHT, extracted: x({ callbackNumber: "602-555-0199", callerName: "Dana Wu" }, [line({ priceOffered: 8.0 })]) });
    if (r.outcome !== "card_sent") throw new Error("expected card");
    await handleRepMessage(db, { member: ruben, text: "approve", buttonPayload: `approve:${r.requestId}`, now: NIGHT });
    const [d] = await db.select().from(schema.decisions).where(eq(schema.decisions.requestId, r.requestId));
    await executeDecision(db, d.id, new Date(NIGHT.getTime() + 200_000));
    const [cb] = await db.select().from(schema.callbacks).where(eq(schema.callbacks.requestId, r.requestId));
    const conv = cb.providerConversationId!;
    expect(await handleCallbackOutcome(db, conv, { outcome: "no_answer" }, NIGHT)).toEqual({ done: "retry_scheduled" });
    expect(await handleCallbackOutcome(db, conv, { outcome: "no_answer" }, NIGHT)).toEqual({ ignored: "already settled" });
    // Second attempt also unanswered → the offer goes by text and stays live.
    await db.update(schema.callbacks).set({ providerConversationId: "conv_retry" }).where(eq(schema.callbacks.id, cb.id));
    expect(await handleCallbackOutcome(db, "conv_retry", { outcome: "no_answer" }, NIGHT)).toEqual({ done: "no_answer" });
    const texts = await db.select().from(schema.messages).where(and(eq(schema.messages.requestId, r.requestId), eq(schema.messages.channel, "sms")));
    expect(texts[0].body).toContain("we tried to reach you about ref");
    const [after] = await db.select().from(schema.callbacks).where(eq(schema.callbacks.id, cb.id));
    expect(after.outcome).toBe("pending");
    const reply = await handleBuyerText(db, { customerId, lineId: null, from: "+16025550199", body: "YES", providerId: "SM_yes_1", now: new Date(NIGHT.getTime() + 600_000) });
    expect(reply.action).toBe("offer_confirmed");
    expect((await req(r.requestId)).status).toBe("approved");
  });

  it("STOP opts the buyer out and nothing more is sent", async () => {
    const out = await handleBuyerText(db, { customerId, lineId: null, from: "+16025550199", body: "STOP", providerId: "SM_stop", now: NIGHT });
    expect(out.action).toBe("opted_out");
    const [b] = await db.select().from(schema.buyers).where(eq(schema.buyers.customerId, customerId)).then((rows) => rows.filter((r) => r.phones.includes("+16025550199")));
    expect(b.doNotContact).toBe(true);
  });
});

describe("rule lines", () => {
  it("reads sizes and pack weights without mistaking them for prices", () => {
    expect(parseRuleCommand("5x6 romas 25 lb 7.25 400")).toMatchObject({ kind: "rules", rules: [{ product: "Roma tomatoes", size: "5x6", pack: "25 lb", minPrice: 7.25, caseLimit: 400 }] });
    expect(parseRuleCommand("pepinos 12 400")).toMatchObject({ kind: "rules", rules: [{ product: "Cucumbers", minPrice: 12, caseLimit: 400 }] });
    expect(parseRuleCommand("thanks")).toBeNull();
  });
});

describe("retention", () => {
  it("scrubs call notes older than the setting, keeps the order", async () => {
    await db.update(schema.settings).set({ retentionMonths: 1 }).where(eq(schema.settings.customerId, customerId));
    const old = new Date(NIGHT.getTime() - 60 * 24 * 60 * 60 * 1000);
    const r = await handleIntake(db, { customerId, channel: "call", transcript: "Buyer: old call", now: old, extracted: x({ callbackNumber: "415-555-0100", callerName: "Old Caller" }, [line({ priceOffered: 8.0 })]) });
    if (r.outcome !== "card_sent") throw new Error("expected card");
    await nightlyTick(new Date(NIGHT.getTime() + 60 * 60 * 1000));
    const after = await req(r.requestId);
    expect(after.transcript).toBeNull();
    expect(after.status).toBe("in_progress");
    expect((await db.select().from(schema.orderLines).where(eq(schema.orderLines.requestId, r.requestId))).length).toBe(1);
  });
});

describe("the reviewer's cases", () => {
  const LATER = new Date(NIGHT.getTime() + 2 * 60 * 60 * 1000); // well after everything above
  it("two open cards and a bare 'yes' gets a question, not a guess; the ref settles it", async () => {
    const a = await handleIntake(db, { customerId, channel: "call", transcript: "x", now: LATER, extracted: x({ callbackNumber: "719-555-0101", callerName: "Ana One" }, [line({ priceOffered: 8.0 })]) });
    const b = await handleIntake(db, { customerId, channel: "call", transcript: "x", now: new Date(LATER.getTime() + 60_000), extracted: x({ callbackNumber: "719-555-0102", callerName: "Ben Two" }, [line({ priceOffered: 8.1 })]) });
    if (a.outcome !== "card_sent" || b.outcome !== "card_sent") throw new Error("expected cards");
    const ask = await handleRepMessage(db, { member: miguel, text: "yes", now: new Date(LATER.getTime() + 120_000) });
    expect(ask.action).toBe("which_one");
    expect(ask.replies[0]).toMatch(/^Which one\? ref \d+ \(Ben\) or .*\(Ana\)/);
    const ok = await handleRepMessage(db, { member: miguel, text: `${a.ref} yes`, now: new Date(LATER.getTime() + 180_000) });
    expect(ok).toMatchObject({ action: "approve", requestId: a.requestId });
    const other = await handleRepMessage(db, { member: miguel, text: `take ${b.ref}`, now: new Date(LATER.getTime() + 240_000) });
    expect(other).toMatchObject({ action: "take_over", requestId: b.requestId });
  });

  it("a buyer's 'yes but only 250' is a change, not a confirmation", () => {
    expect(saysYes("Yes")).toBe(true); expect(saysYes("si, gracias")).toBe(true);
    expect(saysYes("yes but only 250")).toBe(false); expect(saysYes("yes if Tuesday")).toBe(false);
  });

  it("'Monday' said early Monday morning is today; said Monday afternoon it is next week", () => {
    expect(resolvePickupDate("Monday", new Date("2026-11-09T07:30:00Z"), "America/Phoenix")).toBe("2026-11-09"); // Mon 12:30am
    expect(resolvePickupDate("Monday", new Date("2026-11-09T22:00:00Z"), "America/Phoenix")).toBe("2026-11-16"); // Mon 3pm
    expect(resolvePickupDate("el lunes", new Date("2026-11-08T09:00:00Z"), "America/Phoenix")).toBe("2026-11-09"); // Sun 2am
  });

  it("a typed sentence with numbers is not a price rule", () => {
    expect(parseRuleCommand("romas short, maybe 10 cases at 9")).toBeNull();
    expect(parseRuleCommand("tell him 8.75 max 200")).toBeNull();
    expect(parseRuleCommand("4x4 VR 8.50 600")).toMatchObject({ kind: "rules" });
  });

  it("after the buyer declines on the callback, a rep can still take it over", async () => {
    const r = await handleIntake(db, { customerId, channel: "call", transcript: "x", now: NIGHT, extracted: x({ callbackNumber: "719-555-0103", callerName: "Cal Three" }, [line({ priceOffered: 8.0 })]) });
    if (r.outcome !== "card_sent") throw new Error("expected card");
    await handleRepMessage(db, { member: ruben, text: "8.60", buttonPayload: `counter_text:${r.requestId}`, now: NIGHT });
    const [d] = await db.select().from(schema.decisions).where(and(eq(schema.decisions.requestId, r.requestId), eq(schema.decisions.undone, false)));
    await executeDecision(db, d.id, new Date(NIGHT.getTime() + 200_000));
    const [cb] = await db.select().from(schema.callbacks).where(eq(schema.callbacks.requestId, r.requestId));
    await handleCallbackOutcome(db, cb.providerConversationId!, { outcome: "declined" }, new Date(NIGHT.getTime() + 400_000));
    expect((await req(r.requestId)).status).toBe("rejected");
    const t = await handleRepMessage(db, { member: ruben, text: "take", buttonPayload: `take_over:${r.requestId}`, now: new Date(NIGHT.getTime() + 500_000) });
    expect(t.action).toBe("take_over");
    expect((await req(r.requestId)).status).toBe("in_progress");
  });

  it("an undo that lands as the timer fires loses cleanly: one of them wins", async () => {
    const r = await handleIntake(db, { customerId, channel: "call", transcript: "x", now: NIGHT, extracted: x({ callbackNumber: "719-555-0104", callerName: "Dee Four" }, [line({ priceOffered: 8.0 })]) });
    if (r.outcome !== "card_sent") throw new Error("expected card");
    await handleRepMessage(db, { member: ruben, text: "approve", buttonPayload: `approve:${r.requestId}`, now: NIGHT });
    const [d] = await db.select().from(schema.decisions).where(and(eq(schema.decisions.requestId, r.requestId), eq(schema.decisions.undone, false)));
    expect(await executeDecision(db, d.id, new Date(NIGHT.getTime() + 121_000))).toMatchObject({ done: "called" });
    const late = await handleRepMessage(db, { member: ruben, text: "undo", now: new Date(NIGHT.getTime() + 119_000) });
    expect(late.action).toBe("too_late");
  });
});
