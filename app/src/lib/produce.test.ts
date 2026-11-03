import { describe, it, expect } from "vitest";
import { normalizeProduct, normalizeSize, normalizePack, parseCases, parsePrice, resolvePickupDate } from "./produce";

describe("produce jargon", () => {
  it("maps buyer words to canonical products", () => {
    expect(normalizeProduct("300 cs 4x4 vine-ripes")).toBe("Vine-ripe tomatoes");
    expect(normalizeProduct("VR 4x5")).toBe("Vine-ripe tomatoes");
    expect(normalizeProduct("romas 5x6")).toBe("Roma tomatoes");
    expect(normalizeProduct("jitomate bola")).toBe("Vine-ripe tomatoes");
    expect(normalizeProduct("chile morrón rojo XL")).toBe("Red bell peppers");
    expect(normalizeProduct("red bells")).toBe("Red bell peppers");
    expect(normalizeProduct("calabacita")).toBe("Squash");
    expect(normalizeProduct("pepino")).toBe("Cucumbers");
    expect(normalizeProduct("diesel")).toBeNull();
  });
  it("reads sizes and packs", () => {
    expect(normalizeSize("4x4 vine ripes")).toBe("4x4");
    expect(normalizeSize("5 by 6 romas")).toBe("5x6");
    expect(normalizeSize("extra large red bells")).toBe("XL");
    expect(normalizePack("25 lb two-layer")).toBe("25 lb 2-layer");
    expect(normalizePack("25lb 2 layer")).toBe("25 lb 2-layer");
    expect(normalizePack("10 lb flat")).toBe("10 lb flat");
    expect(normalizePack("nothing here")).toBeNull();
  });
  it("reads quantities and prices", () => {
    expect(parseCases("I need 300 cs")).toBe(300);
    expect(parseCases("trescientas cajas")).toBe(300);
    expect(parseCases("2 pallets")).toBeNull();
    expect(parsePrice("$8.50 a case")).toBe(8.5);
    expect(parsePrice("8.25/cs")).toBe(8.25);
  });
  it("resolves pickup days in the customer's time zone", () => {
    // Thursday 5 Nov 2026, 11pm Arizona (= Fri 6 Nov 06:00 UTC)
    const now = new Date("2026-11-06T06:00:00Z");
    const tz = "America/Phoenix";
    expect(resolvePickupDate("Monday", now, tz)).toBe("2026-11-09");
    expect(resolvePickupDate("el lunes", now, tz)).toBe("2026-11-09");
    expect(resolvePickupDate("tomorrow", now, tz)).toBe("2026-11-06");
    expect(resolvePickupDate("mañana", now, tz)).toBe("2026-11-06");
    expect(resolvePickupDate("Thursday", now, tz)).toBe("2026-11-12"); // next Thursday, not today
    expect(resolvePickupDate("whenever", now, tz)).toBeNull();
  });
});
