import { describe, it, expect, beforeAll } from "vitest";
import { getDb, resetDbForTests, schema } from "./index";
import { eq } from "drizzle-orm";

describe("database", () => {
  beforeAll(() => resetDbForTests());

  it("migrates and round-trips a request with an order line", async () => {
    const db = await getDb();
    const [customer] = await db.insert(schema.customers).values({ name: "Del Campo Supreme" }).returning();
    await db.insert(schema.settings).values({
      customerId: customer.id,
      hours: { mon: { open: "06:00", close: "17:00", closed: false } },
      greeting: "Del Campo Supreme, sales. How can I help?",
    });
    const [req] = await db.insert(schema.requests).values({
      customerId: customer.id, ref: 1042, channel: "call", type: "new_order",
      callerName: "Mike Torres", callerCompany: "Lopez Bros", callbackNumber: "+13125550142",
      flags: ["wants_quote"],
    }).returning();
    await db.insert(schema.orderLines).values({
      requestId: req.id, product: "Vine-ripe tomatoes", size: "4x4", pack: "25 lb 2-layer",
      cases: 300, priceOffered: "8.25", pickupDate: "2026-11-09", fulfillment: "collect",
    });
    const found = await db.query.requests.findFirst({ where: eq(schema.requests.id, req.id) });
    expect(found?.status).toBe("in_progress");
    expect(found?.flags).toEqual(["wants_quote"]);
    const lines = await db.select().from(schema.orderLines).where(eq(schema.orderLines.requestId, req.id));
    expect(lines).toHaveLength(1);
    expect(lines[0].cases).toBe(300);
    expect(lines[0].priceOffered).toBe("8.25");
  });

  it("enforces one ref per customer", async () => {
    const db = await getDb();
    const [customer] = await db.insert(schema.customers).values({ name: "Test Farms" }).returning();
    await db.insert(schema.requests).values({ customerId: customer.id, ref: 1, channel: "text", type: "other" });
    await expect(
      db.insert(schema.requests).values({ customerId: customer.id, ref: 1, channel: "text", type: "other" }),
    ).rejects.toThrow();
  });
});
