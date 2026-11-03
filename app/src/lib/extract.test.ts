import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { extractRequest, resolveLine } from "./extract";
import { hasLlmCredentials } from "./llm";

const ctx = { name: "Del Campo Supreme", timezone: "America/Phoenix", now: new Date("2026-11-06T06:00:00Z") }; // Thu 11pm AZ
const sample = (n: string) => readFileSync(new URL(`./samples/${n}`, import.meta.url), "utf8");

describe("resolveLine (offline)", () => {
  it("canonicalizes product and resolves the pickup day", () => {
    const r = resolveLine({ product: "vine-ripes", size: "4x4", pack: "25 lb two-layer", cases: 300, priceOffered: 8.25, pickup: "Monday", fulfillment: "collect", destination: null, poNumber: null }, ctx);
    expect(r.productCanonical).toBe("Vine-ripe tomatoes");
    expect(r.pickupDate).toBe("2026-11-09");
  });
});

describe.skipIf(!hasLlmCredentials())("extractRequest (live)", () => {
  it("English order", async () => {
    const r = await extractRequest(sample("01-lopez-bros-en.txt"), ctx);
    expect(r.type).toBe("new_order");
    expect(r.callerName).toMatch(/Mike Torres/);
    expect(r.callerCompany).toMatch(/Lopez Bros/);
    expect(r.callbackNumber?.replace(/\D/g, "")).toBe("3125550142");
    expect(r.callbackPermission).toBe(true);
    expect(r.lines).toHaveLength(1);
    expect(r.resolvedLines[0].productCanonical).toBe("Vine-ripe tomatoes");
    expect(r.lines[0].cases).toBe(300);
    expect(r.lines[0].priceOffered).toBe(8.25);
    expect(r.resolvedLines[0].pickupDate).toBe("2026-11-09");
    expect(r.lines[0].fulfillment).toBe("collect");
    expect(r.flags).not.toContain("incomplete");
  });
  it("Spanish order", async () => {
    const r = await extractRequest(sample("02-garcia-es.txt"), ctx);
    expect(r.type).toBe("new_order");
    expect(r.language).toBe("es");
    expect(r.resolvedLines[0].productCanonical).toBe("Roma tomatoes");
    expect(r.lines[0].size).toMatch(/5\s*x\s*6|cinco por seis/i);
    expect(r.lines[0].cases).toBe(300);
    expect(r.lines[0].priceOffered).toBe(7.5);
    expect(r.resolvedLines[0].pickupDate).toBe("2026-11-12");
    expect(r.preferredChannel).toBe("text");
  });
  it("Mixed-language two-line order with a quote request", async () => {
    const r = await extractRequest(sample("03-valley-fresh-mixed.txt"), ctx);
    expect(r.type).toBe("new_order");
    expect(r.lines).toHaveLength(2);
    const products = r.resolvedLines.map((l) => l.productCanonical).sort();
    expect(products).toEqual(["Red bell peppers", "Roma tomatoes"]);
    const roma = r.resolvedLines.find((l) => l.productCanonical === "Roma tomatoes")!;
    expect(roma.cases).toBe(200);
    expect(roma.priceOffered).toBe(6.75);
    expect(roma.pickupDate).toBe("2026-11-06");
  });
  it("Rejection in progress is a complaint flagged urgent", async () => {
    const r = await extractRequest(sample("04-rejection-complaint.txt"), ctx);
    expect(r.type).toBe("complaint");
    expect(r.flags).toContain("urgent");
    expect(r.complaint?.load).toMatch(/4471/);
    expect(r.callbackNumber?.replace(/\D/g, "")).toBe("2145550133");
  });
});
