import { describe, it, expect } from "vitest";
import { requestCard, cardButtons, orderCard, afterTap } from "./card";

const line = { product: "vine-ripes", productCanonical: "Vine-ripe tomatoes", size: "4x4", pack: "25 lb 2-layer", cases: 300, priceOffered: 8.25, pickup: "Monday", pickupDate: "2026-11-09", fulfillment: "collect" as const, destination: null, poNumber: null };

describe("request card", () => {
  it("matches the spec's layout", () => {
    const text = requestCard({
      ref: 1042, channel: "call", receivedAt: new Date("2026-11-08T09:14:00Z"), timezone: "America/Phoenix",
      callerName: "Mike Torres", callerCompany: "Lopez Bros", callerCity: "Chicago", callbackNumber: "312-555-0142",
      type: "new_order", flags: [], summary: "", lines: [line], transcriptUrl: "https://app.usesoba.com/r/1042",
    });
    expect(text).toBe([
      "Mike Torres · Lopez Bros (Chicago) · 312-555-0142",
      "NEW REQUEST · ref 1042 · call, Sun 2:14am",
      "",
      "Product:  Vine-ripe tomatoes",
      "Size:     4x4",
      "Pack:     25 lb 2-layer",
      "Qty:      300 cases",
      "Price:    offers $8.25/case",
      "Pickup:   Mon · buyer collects",
      "",
      "Transcript: https://app.usesoba.com/r/1042",
    ].join("\n"));
    expect(text.length).toBeLessThan(1024);
    expect(cardButtons("new_order")).toEqual(["Approve", "Counter", "Reject", "Take over"]);
  });
  it("shows flags, repeat calls, quote requests and off-sheet products", () => {
    const text = requestCard({
      ref: 1043, channel: "text", receivedAt: new Date("2026-11-08T09:31:00Z"), timezone: "America/Phoenix",
      callerName: null, callerCompany: "North Market", callerCity: "Denver", callbackNumber: "303-555-0101",
      type: "new_order", flags: ["wants_quote", "incomplete"], summary: "",
      lines: [{ ...line, product: "heirlooms", productCanonical: null, cases: null, priceOffered: null, pickup: null, pickupDate: null }],
      repeatTimes: [new Date("2026-11-08T09:14:00Z")],
    });
    expect(text).toContain("wants a quote · incomplete · called 2 times: Sun 2:14am, Sun 2:31am");
    expect(text).toContain("Product:  heirlooms (not on sheet)");
    expect(text).toContain("Qty:      not given");
    expect(text).toContain("Price:    wants a quote");
  });
  it("non-orders get a summary and Take over only", () => {
    const text = requestCard({
      ref: 1044, channel: "call", receivedAt: new Date("2026-11-08T03:00:00Z"), timezone: "America/Phoenix",
      callerName: "Carl", callerCompany: "Sunny Foods", callerCity: "Dallas", callbackNumber: "214-555-0133",
      type: "complaint", flags: ["urgent"], summary: "Load PO 4471 arrived with soft Romas on half the pallets; USDA inspection 6am; wants a call now.", lines: [],
    });
    expect(text).toContain("URGENT");
    expect(text).toContain("Load PO 4471");
    expect(cardButtons("complaint")).toEqual(["Take over"]);
  });
  it("order card matches the spec", () => {
    const text = orderCard({ ref: 1047, customer: "Lopez Bros", city: "Chicago", poNumber: null, product: "vine-ripe tomatoes", size: "4x4", pack: "25 lb", cases: 300, price: 8.5, terms: "FOB Nogales", pickupDate: "2026-11-09", fulfillment: "collect", contactName: "Mike Torres", contactNumber: "312-555-0142", rule: { cleared: 300, limit: 600 } });
    expect(text).toBe([
      "ORDER · ref 1047", "Customer:  Lopez Bros, Chicago", "PO #:      none given", "Item:      4x4 vine-ripe tomatoes 25 lb",
      "Qty:       300 cs", "Price:     $8.50/cs FOB Nogales", "Pickup:    Mon, Nov 9 · buyer's truck", "Contact:   Mike Torres, 312-555-0142", "Rule:      300 of 600 cases sold",
    ].join("\n"));
  });
  it("after-tap messages", () => {
    expect(afterTap.approve("Mike", 300, 8.25, "call")).toBe("Calling Mike now to confirm 300 cs at $8.25. Reply UNDO within 2 minutes to stop.");
    expect(afterTap.claimed("Ruben", 1042, "countered $8.50")).toBe("Ruben took ref 1042: countered $8.50.");
  });
});
