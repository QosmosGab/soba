// Tonight's prices: typed commands ("4x4 VR 8.50 600 till Mon 7am", "pause
// Romas", "same as last night"), price sheets read by Claude with a read-back
// before anything goes live, and the nightly "same prices?" prompt.
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { and, desc, eq, gt, lt } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { llm, MODEL } from "./llm";
import { normalizePack, normalizeProduct, normalizeSize } from "./produce";
import { nextOpening } from "./hours";
import { loadCustomer } from "./cards";
import { fmtMoney } from "./card";
import { localParts } from "./time";

export type ParsedRule = { product: string; size: string | null; pack: string | null; minPrice: number; caseLimit: number; note?: string };

export type RuleCommand =
  | { kind: "rules"; rules: ParsedRule[]; until: string | null }
  | { kind: "pause" | "resume"; target: string | null }   // null = all
  | { kind: "same" }
  | { kind: "status" };

const WEEKDAY = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

/** "till Mon 7am", "until monday 7:00", "hasta el lunes 7am" → an instant in the customer's time zone. */
export function resolveUntil(phrase: string, now: Date, timeZone: string): Date | null {
  const p = phrase.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const en = WEEKDAY.findIndex((d) => p.includes(d));
  const day = en >= 0 ? en : ["lunes", "martes", "miercoles", "jueves", "viernes", "sabado", "domingo"].findIndex((d) => p.includes(d));
  const time = p.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  if (day < 0 && !time) return null;
  let hour = time ? Number(time[1]) : 7;
  const minute = time?.[2] ? Number(time[2]) : 0;
  if (time?.[3] === "pm" && hour < 12) hour += 12;
  if (time?.[3] === "am" && hour === 12) hour = 0;
  // Walk forward minute by minute until the local weekday and time match.
  const step = 60 * 1000;
  let t = new Date(Math.ceil(now.getTime() / step) * step);
  for (let i = 0; i < 8 * 24 * 60; i++, t = new Date(t.getTime() + step)) {
    const l = localParts(t, timeZone);
    if ((day < 0 || l.weekday === day) && l.minutes === hour * 60 + minute) return t;
  }
  return null;
}

/**
 * One typed rule line: product words, a price, a case count, e.g. "4x4 VR 8.50 600",
 * "red bells XL 25 lb 11.00 300". The size (4x4) and pack weight (25 lb) are removed
 * first so their digits are never read as a price or a count. Returns null when it is not a rule.
 */
function parseRuleLine(line: string): ParsedRule | null {
  const product = normalizeProduct(line);
  const size = normalizeSize(line);
  const pack = normalizePack(line);
  const rest = line.replace(/\b[3-7]\s*(?:x|by|por)\s*[3-7]\b/i, " ").replace(/\b\d{1,2}\s*(?:lb|lbs|pound|pounds|libras?)\b/i, " ");
  const nums = Array.from(rest.matchAll(/\$?(\d{1,5}(?:\.\d{1,2})?)/g)).map((m) => Number(m[1]));
  const price = nums.find((n) => n > 0.5 && n < 200 && (!Number.isInteger(n) || n < 60));
  const cases = nums.find((n) => Number.isInteger(n) && n >= 10 && n !== price);
  if (!product || price == null || cases == null) return null;
  // What's left after the product, size, pack and numbers must be nothing much: a sentence is not a rule.
  const leftover = rest.replace(/\$?\d+(?:\.\d+)?/g, " ").replace(/\b(vr|vine[- ]?ripes?|romas?|tov|bells?|peppers?|tomato(es)?|red|yellow|green|xl|lg|large|medium|small|jumbo|cs|cases?|cajas?|up to|max|each|per|a|at|@|the|of|and|y|de|hasta|till|until|for)\b/gi, " ").replace(/[^a-z]+/gi, " ").trim().split(/\s+/).filter(Boolean);
  if (leftover.length > 2) return null;
  return { product, size, pack, minPrice: price, caseLimit: cases };
}

/** Recognizes the WhatsApp price commands. Anything else returns null and is treated as a card reply. */
export function parseRuleCommand(text: string): RuleCommand | null {
  const t = text.trim();
  const low = t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  if (/^(same( prices)?( as last night)?|mismos precios|igual que anoche|same as yesterday)[.!]?$/.test(low)) return { kind: "same" };
  if (/^(prices|precios|rules|status|what'?s live|que hay)\??$/.test(low)) return { kind: "status" };
  const pause = low.match(/^(pause|stop|pausa|parar?)\s+(all|todo|todos|everything)$/) ? { kind: "pause" as const, target: null } : low.match(/^(pause|stop|pausa|parar?)\s+(.+)$/) ? { kind: "pause" as const, target: normalizeProduct(low.replace(/^(pause|stop|pausa|parar?)\s+/, "")) ?? low.replace(/^(pause|stop|pausa|parar?)\s+/, "") } : null;
  if (pause) return pause;
  const resume = low.match(/^(resume|unpause|restart|reanudar?|activar?)\s+(all|todo|todos|everything)$/) ? { kind: "resume" as const, target: null } : low.match(/^(resume|unpause|restart|reanudar?|activar?)\s+(.+)$/) ? { kind: "resume" as const, target: normalizeProduct(low.replace(/^(resume|unpause|restart|reanudar?|activar?)\s+/, "")) ?? low.replace(/^(resume|unpause|restart|reanudar?|activar?)\s+/, "") } : null;
  if (resume) return resume;
  const untilMatch = t.match(/\b(?:till|until|hasta(?: el)?|thru|through)\b\s*(.+)$/i);
  const body = untilMatch ? t.slice(0, untilMatch.index) : t;
  const lines = body.split(/\n|;|,(?=\s*[a-z])/i).map((s) => s.trim()).filter(Boolean);
  const rules = lines.map(parseRuleLine).filter((r): r is ParsedRule => Boolean(r));
  if (rules.length && rules.length === lines.length) return { kind: "rules", rules, until: untilMatch?.[1]?.trim() ?? null };
  return null;
}

export function readBack(rules: ParsedRule[], expires: Date, timeZone: string): string {
  const when = expires.toLocaleString("en-US", { timeZone, weekday: "short", hour: "numeric", minute: "2-digit" }).replace(",", "");
  const items = rules.map((r) => `${[r.size, r.product, r.pack].filter(Boolean).join(" ")} ${fmtMoney(r.minPrice)} up to ${r.caseLimit} cases${r.note ? ` (${r.note})` : ""}`);
  return `Loaded ${rules.length} price${rules.length === 1 ? "" : "s"}, live until ${when}:\n${items.map((i) => `• ${i}`).join("\n")}`;
}

/** Writes the rules live. Replaces any live rule on the same product/size/pack. */
export async function goLive(db: Db, args: { customerId: string; sheetId: string | null; memberId: string | null; rules: ParsedRule[]; expiresAt: Date; now: Date }) {
  const live = await db.select().from(schema.priceRules).where(and(eq(schema.priceRules.customerId, args.customerId), gt(schema.priceRules.expiresAt, args.now)));
  const key = (r: { product: string; size: string | null; pack: string | null }) => `${r.product}|${r.size ?? ""}|${(r.pack ?? "").split(" ")[0]}`.toLowerCase();
  for (const r of args.rules) {
    const dup = live.find((l) => key(l) === key(r));
    if (dup) await db.update(schema.priceRules).set({ expiresAt: args.now }).where(eq(schema.priceRules.id, dup.id));
    await db.insert(schema.priceRules).values({ customerId: args.customerId, sheetId: args.sheetId, product: r.product, size: r.size, pack: r.pack, minPrice: r.minPrice.toFixed(2), caseLimit: r.caseLimit, liveFrom: args.now, expiresAt: args.expiresAt });
  }
  if (args.sheetId) await db.update(schema.priceSheets).set({ confirmedById: args.memberId, confirmedAt: args.now }).where(eq(schema.priceSheets.id, args.sheetId));
  await db.insert(schema.events).values({ customerId: args.customerId, type: "rules.live", payload: { count: args.rules.length, by: args.memberId, sheetId: args.sheetId, expiresAt: args.expiresAt.toISOString() } });
}

export async function defaultExpiry(db: Db, customerId: string, now: Date): Promise<{ expires: Date; timezone: string }> {
  const { customer, settings } = await loadCustomer(db, customerId);
  return { expires: nextOpening(now, settings.hours, customer.timezone, settings.holidays), timezone: customer.timezone };
}

/** Applies a parsed command for a rep who may set prices. Typed rules come back staged (pendingSheetId) for a YES. */
export async function applyRuleCommand(db: Db, args: { customerId: string; memberId: string; cmd: RuleCommand; now: Date }): Promise<string | { text: string; pendingSheetId: string }> {
  const { customerId, memberId, cmd, now } = args;
  const { expires: defaultExp, timezone } = await defaultExpiry(db, customerId, now);
  switch (cmd.kind) {
    case "rules": {
      // Read back before anything goes live, like a sheet. Rules never outlive the next opening.
      const asked = cmd.until ? resolveUntil(cmd.until, now, timezone) : null;
      const expires = asked && asked < defaultExp ? asked : defaultExp;
      const staged = await stagePriceSheet(db, { customerId, memberId, parsed: { rules: cmd.rules.map((r) => ({ ...r, note: r.note ?? null })), question: null, language: "en" }, receivedVia: "command", rawText: null, now, expiresAt: expires });
      return { text: staged.text, pendingSheetId: staged.sheet.id };
    }
    case "pause": case "resume": {
      const live = await db.select().from(schema.priceRules).where(and(eq(schema.priceRules.customerId, customerId), gt(schema.priceRules.expiresAt, now)));
      const hit = cmd.target ? live.filter((r) => r.product.toLowerCase() === cmd.target!.toLowerCase() || `${r.size ?? ""} ${r.product}`.toLowerCase().includes(cmd.target!.toLowerCase())) : live;
      if (!hit.length) return cmd.target ? `No live price for "${cmd.target}" tonight.` : "No prices are live tonight.";
      for (const r of hit) await db.update(schema.priceRules).set({ on: cmd.kind === "resume" }).where(eq(schema.priceRules.id, r.id));
      await db.insert(schema.events).values({ customerId, type: `rules.${cmd.kind}`, payload: { by: memberId, ids: hit.map((r) => r.id) } });
      return cmd.kind === "pause"
        ? `Paused ${cmd.target ? hit.map((r) => `${r.size ?? ""} ${r.product}`.trim()).join(", ") : "all prices"}. Orders go to the team until you resume.`
        : `Resumed ${cmd.target ? hit.map((r) => `${r.size ?? ""} ${r.product}`.trim()).join(", ") : "all prices"}.`;
    }
    case "same": {
      const prev = await lastNightsRules(db, customerId, now);
      if (!prev.length) return "There were no prices last night. Send tonight's sheet or type them, e.g. \"4x4 VR 8.50 600\".";
      const [sheet] = await db.insert(schema.priceSheets).values({ customerId, receivedVia: "command", parsed: prev, sentById: memberId, parsedAt: now }).returning();
      await goLive(db, { customerId, sheetId: sheet.id, memberId, rules: prev, expiresAt: defaultExp, now });
      return readBack(prev, defaultExp, timezone);
    }
    case "status": {
      const live = await db.select().from(schema.priceRules).where(and(eq(schema.priceRules.customerId, customerId), gt(schema.priceRules.expiresAt, now)));
      if (!live.length) return "No prices live tonight. Every order goes to the team.";
      return `Live tonight:\n${live.map((r) => `• ${[r.size, r.product, r.pack].filter(Boolean).join(" ")} ${fmtMoney(Number(r.minPrice))}: ${r.casesCleared} of ${r.caseLimit} sold${r.on ? "" : " (paused)"}`).join("\n")}`;
    }
  }
}

/** The most recent expired set of rules (last night's), for "same as last night". */
export async function lastNightsRules(db: Db, customerId: string, now: Date): Promise<ParsedRule[]> {
  const [latest] = await db.select().from(schema.priceRules).where(and(eq(schema.priceRules.customerId, customerId), lt(schema.priceRules.expiresAt, now))).orderBy(desc(schema.priceRules.liveFrom)).limit(1);
  if (!latest) return [];
  const windowStart = new Date(latest.liveFrom.getTime() - 12 * 60 * 60 * 1000);
  const rows = await db.select().from(schema.priceRules).where(and(eq(schema.priceRules.customerId, customerId), lt(schema.priceRules.expiresAt, now), gt(schema.priceRules.liveFrom, windowStart))).orderBy(schema.priceRules.liveFrom);
  const seen = new Map<string, ParsedRule>(); // later rows win, so a mid-night correction beats the original
  for (const r of rows) seen.set(`${r.product}|${r.size}|${r.pack}`, { product: r.product, size: r.size, pack: r.pack, minPrice: Number(r.minPrice), caseLimit: r.caseLimit });
  return Array.from(seen.values());
}

// ---- Price sheets (PDF, photo, pasted text) read by Claude ----

const SheetSchema = z.object({
  rules: z.array(z.object({
    product: z.string().describe("Canonical English product name, e.g. 'Vine-ripe tomatoes', 'Roma tomatoes', 'Red bell peppers'"),
    size: z.string().nullable().describe("'4x4', '5x6', 'XL', or null"),
    pack: z.string().nullable().describe("'25 lb 2-layer', '15 lb', '11 lb', or null"),
    minPrice: z.number().describe("Price per case in dollars; the minimum clearing price"),
    caseLimit: z.number().int().describe("Cases available; the auto-clear limit"),
    note: z.string().nullable().describe("Anything a rep should know, e.g. 'price per lb converted', or null"),
  })),
  question: z.string().nullable().describe("ONE clarifying question if the sheet is ambiguous (per lb vs per case? delivered vs FOB? no quantities?), else null"),
  language: z.enum(["en", "es"]),
});

const SHEET_SYSTEM = `You read a fresh-produce sales desk's daily price sheet (PDF, photo, spreadsheet text or a typed list) and turn it into auto-clear rules: one per product line with the minimum price per case and the number of cases available.
Rules: prices per pound must be converted to per case using the pack weight and noted. If quantities are missing, ask one question rather than inventing them. Skip lines with no price. Keep sizes as written (4x4, 5x6, XL). Products get canonical English names. Spanish sheets are common.`;

export async function parsePriceSheet(input: { text?: string; file?: { base64: string; mediaType: string } }): Promise<z.infer<typeof SheetSchema>> {
  const content: Array<Record<string, unknown>> = [];
  if (input.file) {
    if (input.file.mediaType === "application/pdf") content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: input.file.base64 } });
    else content.push({ type: "image", source: { type: "base64", media_type: input.file.mediaType, data: input.file.base64 } });
  }
  content.push({ type: "text", text: input.text ? `Price sheet text:\n${input.text}` : "Read the attached price sheet." });
  const response = await llm().messages.parse({
    model: MODEL, max_tokens: 4000,
    output_config: { effort: "medium", format: zodOutputFormat(SheetSchema) },
    system: [{ type: "text", text: SHEET_SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: content as never }],
  });
  if (response.stop_reason === "refusal" || !response.parsed_output) throw new Error("Price sheet could not be read");
  return response.parsed_output;
}

/** Applies a rep's "fix" ("4x4 should be 8.75", "drop the Romas") to a pending sheet. */
export async function fixPriceSheet(rules: ParsedRule[], fix: string): Promise<z.infer<typeof SheetSchema>> {
  const response = await llm().messages.parse({
    model: MODEL, max_tokens: 3000,
    output_config: { effort: "low", format: zodOutputFormat(SheetSchema) },
    system: [{ type: "text", text: `${SHEET_SYSTEM}\nYou are given the rules already read and a correction from the sales manager. Return the full corrected list.` }],
    messages: [{ role: "user", content: `Current rules:\n${JSON.stringify(rules, null, 1)}\n\nCorrection: "${fix}"` }],
  });
  if (response.stop_reason === "refusal" || !response.parsed_output) throw new Error("Fix could not be applied");
  return response.parsed_output;
}

/** Stores a parsed sheet as pending and returns the read-back for the rep (Yes / Fix). */
export async function stagePriceSheet(db: Db, args: { customerId: string; memberId: string; parsed: z.infer<typeof SheetSchema>; receivedVia: string; fileUrl?: string | null; rawText?: string | null; now: Date; expiresAt?: Date }) {
  const { expires: defaultExp, timezone } = await defaultExpiry(db, args.customerId, args.now);
  const expires = args.expiresAt && args.expiresAt < defaultExp ? args.expiresAt : defaultExp;
  const [sheet] = await db.insert(schema.priceSheets).values({
    customerId: args.customerId, receivedVia: args.receivedVia, fileUrl: args.fileUrl ?? null, rawText: args.rawText ?? null,
    parsed: args.parsed.rules.map((r) => ({ ...r, note: r.note ?? undefined })), question: args.parsed.question, sentById: args.memberId, parsedAt: args.now,
    expiresAt: expires,
  }).returning();
  const text = args.parsed.rules.length
    ? `${readBack(args.parsed.rules.map((r) => ({ ...r, note: r.note ?? undefined })), expires, timezone)}\n${args.parsed.question ? `One question: ${args.parsed.question}\n` : ""}Reply YES to go live, or tell me what to fix.`
    : `I couldn't find prices on that sheet.${args.parsed.question ? ` ${args.parsed.question}` : ""} Send a clearer photo or type them, e.g. "4x4 VR 8.50 600".`;
  return { sheet, text };
}

/** Yes / Fix on a staged sheet. */
export async function answerSheetReadBack(db: Db, args: { customerId: string; memberId: string; sheetId: string; text: string; now: Date }): Promise<{ text: string; live: boolean }> {
  const [sheet] = await db.select().from(schema.priceSheets).where(eq(schema.priceSheets.id, args.sheetId));
  if (!sheet || !sheet.parsed) return { text: "That sheet is no longer pending. Send it again.", live: false };
  const t = args.text.trim().toLowerCase();
  // A plain yes goes live; "yes but change 4x4 to 8.75" is a fix.
  if (/^(yes|y|si|sí|ok|okay|looks right|go live|go|dale|correct|correcto)[\s.!]*$/.test(t)) {
    if (!sheet.parsed.length) return { text: "Nothing to go live: no prices were read. Send a clearer photo or type them, e.g. \"4x4 VR 8.50 600\".", live: false };
    const { expires: defaultExp, timezone } = await defaultExpiry(db, args.customerId, args.now);
    const expires = sheet.expiresAt && sheet.expiresAt < defaultExp && sheet.expiresAt > args.now ? sheet.expiresAt : defaultExp;
    await goLive(db, { customerId: args.customerId, sheetId: sheet.id, memberId: args.memberId, rules: sheet.parsed, expiresAt: expires, now: args.now });
    return { text: `Live. ${sheet.parsed.length} price${sheet.parsed.length === 1 ? "" : "s"} until ${expires.toLocaleString("en-US", { timeZone: timezone, weekday: "short", hour: "numeric", minute: "2-digit" }).replace(",", "")}.`, live: true };
  }
  if (/^(no|cancel|drop it|forget it|nevermind|never mind)$/.test(t)) {
    await db.update(schema.priceSheets).set({ parsed: null }).where(eq(schema.priceSheets.id, sheet.id));
    return { text: "Dropped. Nothing went live.", live: false };
  }
  const fixed = await fixPriceSheet(sheet.parsed, args.text);
  await db.update(schema.priceSheets).set({ parsed: fixed.rules.map((r) => ({ ...r, note: r.note ?? undefined })), question: fixed.question }).where(eq(schema.priceSheets.id, sheet.id));
  const { expires, timezone } = await defaultExpiry(db, args.customerId, args.now);
  return { text: `${readBack(fixed.rules.map((r) => ({ ...r, note: r.note ?? undefined })), expires, timezone)}\nReply YES to go live, or tell me what else to fix.`, live: false };
}

/** The nightly prompt text; the WhatsApp route sets the rep's thread to awaiting_same_prices. */
export async function samePricesPromptText(db: Db, customerId: string, now: Date): Promise<string | null> {
  const prev = await lastNightsRules(db, customerId, now);
  if (!prev.length) return null;
  return `Same prices as last night?\n${prev.map((r) => `• ${[r.size, r.product].filter(Boolean).join(" ")} ${fmtMoney(r.minPrice)} up to ${r.caseLimit}`).join("\n")}\nReply YES to restart them, or send tonight's sheet. No answer means no auto-clear tonight.`;
}
