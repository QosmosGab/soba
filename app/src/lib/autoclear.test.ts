import { describe, it, expect } from "vitest";
import { decideAutoClear, type LiveRule } from "./autoclear";
import { isOpen, isOffHours, nextOpening, DEFAULT_HOURS } from "./hours";
import type { ResolvedLine } from "./extract";

const tz = "America/Phoenix";
const now = new Date("2026-11-06T06:00:00Z"); // Thu 5 Nov, 11pm AZ
const rule: LiveRule = { id: "r1", product: "Vine-ripe tomatoes", size: "4x4", pack: "25 lb", minPrice: 8.5, caseLimit: 600, casesCleared: 300, on: true, expiresAt: new Date("2026-11-06T13:00:00Z") };
const line = (over: Partial<ResolvedLine> = {}): ResolvedLine => ({ product: "vine-ripes", productCanonical: "Vine-ripe tomatoes", size: "4x4", pack: "25 lb 2-layer", cases: 300, priceOffered: 8.5, pickup: "Monday", pickupDate: "2026-11-09", fulfillment: "collect", destination: null, poNumber: null, ...over });
const settings = { autoClear: true, implausiblePricePct: 30 };

describe("hours", () => {
  it("knows open, closed and the next opening", () => {
    expect(isOpen(new Date("2026-11-05T17:00:00Z"), DEFAULT_HOURS, tz)).toBe(true);  // Thu 10am AZ
    expect(isOffHours(now, DEFAULT_HOURS, tz)).toBe(true);                             // Thu 11pm AZ
    expect(isOpen(new Date("2026-11-07T18:00:00Z"), DEFAULT_HOURS, tz)).toBe(false);  // Sat 11am, closed day
    expect(isOpen(new Date("2026-11-05T17:00:00Z"), DEFAULT_HOURS, tz, ["2026-11-05"])).toBe(false); // holiday
    expect(nextOpening(now, DEFAULT_HOURS, tz).toISOString()).toBe("2026-11-06T13:00:00.000Z");     // Fri 6am AZ
    expect(nextOpening(new Date("2026-11-07T06:00:00Z"), DEFAULT_HOURS, tz).toISOString()).toBe("2026-11-09T13:00:00.000Z"); // Fri night → Mon 6am
  });
});

describe("auto-clear", () => {
  it("clears an order at or above the rule within the limit", () => {
    const r = decideAutoClear({ lines: [line()], rules: [rule], settings, offHours: true, now });
    expect(r.clear).toBe(true);
    if (r.clear) expect(r.lines[0]).toMatchObject({ cases: 300, price: 8.5 });
  });
  it("fails each condition for the right reason", () => {
    expect(decideAutoClear({ lines: [line()], rules: [rule], settings: { ...settings, autoClear: false }, offHours: true, now })).toMatchObject({ clear: false, condition: 1 });
    expect(decideAutoClear({ lines: [line()], rules: [rule], settings, offHours: false, now })).toMatchObject({ clear: false, condition: 1 });
    expect(decideAutoClear({ lines: [line({ productCanonical: "Roma tomatoes", product: "romas" })], rules: [rule], settings, offHours: true, now })).toMatchObject({ clear: false, condition: 2 });
    expect(decideAutoClear({ lines: [line({ priceOffered: 8.25 })], rules: [rule], settings, offHours: true, now })).toMatchObject({ clear: false, condition: 3 });
    expect(decideAutoClear({ lines: [line({ cases: 301 })], rules: [rule], settings, offHours: true, now })).toMatchObject({ clear: false, condition: 4 });
    expect(decideAutoClear({ lines: [line({ priceOffered: 12 })], rules: [rule], settings, offHours: true, now })).toMatchObject({ clear: false, condition: 5 });
    expect(decideAutoClear({ lines: [line({ fulfillment: "delivered", destination: "Chicago" })], rules: [rule], settings, offHours: true, now })).toMatchObject({ clear: false, condition: 6 });
  });
  it("mixed orders go to the reps whole, and two lines share one rule's remaining cases", () => {
    const r = decideAutoClear({ lines: [line({ cases: 200 }), line({ cases: 200 })], rules: [rule], settings, offHours: true, now });
    expect(r).toMatchObject({ clear: false, condition: 4 });
    const ok = decideAutoClear({ lines: [line({ cases: 150 }), line({ cases: 150 })], rules: [rule], settings, offHours: true, now });
    expect(ok.clear).toBe(true);
    const mixed = decideAutoClear({ lines: [line(), line({ productCanonical: "Roma tomatoes", product: "romas", size: "5x6" })], rules: [rule], settings, offHours: true, now });
    expect(mixed).toMatchObject({ clear: false, condition: 2 });
  });
  it("ignores paused and expired rules", () => {
    expect(decideAutoClear({ lines: [line()], rules: [{ ...rule, on: false }], settings, offHours: true, now })).toMatchObject({ clear: false, condition: 2 });
    expect(decideAutoClear({ lines: [line()], rules: [{ ...rule, expiresAt: new Date("2026-11-05T13:00:00Z") }], settings, offHours: true, now })).toMatchObject({ clear: false, condition: 2 });
  });
});
