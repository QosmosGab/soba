import { describe, it, expect, beforeAll } from "vitest";
import { getDb, resetDbForTests, schema } from "@/db";
import { createRequest, tryAutoClear, toE164 } from "./requests";
import { eq } from "drizzle-orm";
import type { ExtractedRequest, ResolvedLine } from "./extract";

const now = new Date("2026-11-06T06:00:00Z");
const line: ResolvedLine = { product: "vine-ripes", productCanonical: "Vine-ripe tomatoes", size: "4x4", pack: "25 lb 2-layer", cases: 300, priceOffered: 8.5, pickup: "Monday", pickupDate: "2026-11-09", fulfillment: "collect", destination: null, poNumber: null };
const extracted = (over: Partial<ExtractedRequest> = {}, lines: ResolvedLine[] = [line]): ExtractedRequest & { resolvedLines: ResolvedLine[] } => ({
  type: "new_order", callerName: "Mike Torres", callerCompany: "Lopez Bros", callerCity: "Chicago", callbackNumber: "312-555-0142",
  callbackPermission: true, preferredChannel: "call", lines, language: "en", flags: [], summary: "Mike at Lopez Bros wants 300 cs 4x4 VR at $8.50, Mon pickup", complaint: null,
  ...over, resolvedLines: lines,
});
const settings = { autoClear: true, implausiblePricePct: 30 };

describe("request service", () => {
  let customerId: string;
  beforeAll(async () => {
    resetDbForTests();
    const db = await getDb();
    const [c] = await db.insert(schema.customers).values({ name: "Del Campo Supreme" }).returning();
    customerId = c.id;
    await db.insert(schema.priceRules).values({ customerId, product: "Vine-ripe tomatoes", size: "4x4", pack: "25 lb", minPrice: "8.50", caseLimit: 600, casesCleared: 0, expiresAt: new Date("2026-11-06T13:00:00Z") });
  });

  it("normalizes phones", () => {
    expect(toE164("312-555-0142")).toBe("+13125550142");
    expect(toE164("1 (312) 555-0142")).toBe("+13125550142");
    expect(toE164(null)).toBeNull();
  });

  it("creates a request with a ref, a new buyer and lines", async () => {
    const db = await getDb();
    const r = await createRequest(db, { customerId, channel: "call", now, extracted: extracted() });
    expect(r.merged).toBe(false);
    expect(r.request.ref).toBe(1001);
    expect(r.request.flags).toContain("new_buyer");
    expect(r.request.callbackNumber).toBe("+13125550142");
    const lines = await db.select().from(schema.orderLines).where(eq(schema.orderLines.requestId, r.request.id));
    expect(lines[0]).toMatchObject({ product: "Vine-ripe tomatoes", cases: 300, priceOffered: "8.50", pickupDate: "2026-11-09" });
  });

  it("merges a repeat call from the same number into the open request", async () => {
    const db = await getDb();
    const again = await createRequest(db, { customerId, channel: "call", now: new Date(now.getTime() + 17 * 60 * 1000), extracted: extracted() });
    expect(again.merged).toBe(true);
    expect(again.request.ref).toBe(1001);
    expect(again.request.flags).toContain("repeat_caller");
  });

  it("recognizes a returning buyer and allocates the next ref", async () => {
    const db = await getDb();
    const later = new Date(now.getTime() + 5 * 60 * 60 * 1000);
    const r = await createRequest(db, { customerId, channel: "text", now: later, extracted: extracted({ callerCompany: null }) });
    expect(r.merged).toBe(false);
    if (r.merged) return;
    expect(r.isNew).toBe(false);
    expect(r.buyer.company).toBe("Lopez Bros");
    expect(r.request.ref).toBe(1002);
  });

  it("auto-clears within the rule and bumps the sold count atomically", async () => {
    const db = await getDb();
    const a = await createRequest(db, { customerId, channel: "call", now, extracted: extracted({ callbackNumber: "773-555-0001" }) });
    if (a.merged) throw new Error("unexpected merge");
    const d1 = await tryAutoClear(db, { requestId: a.request.id, customerId, lines: [line], now, offHours: true, settings });
    expect(d1.clear).toBe(true);
    const [rule] = await db.select().from(schema.priceRules).where(eq(schema.priceRules.customerId, customerId));
    expect(rule.casesCleared).toBe(300);
    const [req] = await db.select().from(schema.requests).where(eq(schema.requests.id, a.request.id));
    expect(req.status).toBe("auto_cleared");
    const [ol] = await db.select().from(schema.orderLines).where(eq(schema.orderLines.requestId, a.request.id));
    expect(ol.finalPrice).toBe("8.50");

    // A second 300 fits exactly; a third does not.
    const b = await createRequest(db, { customerId, channel: "call", now, extracted: extracted({ callbackNumber: "773-555-0002" }) });
    if (b.merged) throw new Error("unexpected merge");
    expect((await tryAutoClear(db, { requestId: b.request.id, customerId, lines: [line], now, offHours: true, settings })).clear).toBe(true);
    const c = await createRequest(db, { customerId, channel: "call", now, extracted: extracted({ callbackNumber: "773-555-0003" }) });
    if (c.merged) throw new Error("unexpected merge");
    const d3 = await tryAutoClear(db, { requestId: c.request.id, customerId, lines: [line], now, offHours: true, settings });
    expect(d3).toMatchObject({ clear: false, condition: 4 });
    const events = await db.select().from(schema.events).where(eq(schema.events.requestId, c.request.id));
    expect(events.map((e) => e.type)).toContain("autoclear.declined");
  });
});
