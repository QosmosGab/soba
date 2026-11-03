"use server";
// Every panel mutation. Each one checks the signed-in customer owns the row it
// touches, then revalidates the page it came from.
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb, schema } from "@/db";
import { panelCustomer, clearPanelSession } from "@/lib/auth";
import { handleRepMessage } from "@/lib/decisions";
import { panelActor } from "@/lib/panel-data";
import { parsePriceSheet, stagePriceSheet, answerSheetReadBack, applyRuleCommand, goLive, defaultExpiry } from "@/lib/rules";
import { sendMorningSummary } from "@/lib/summary";
import { nextOpening, snapToQuarter } from "@/lib/hours";
import { validTimeZone } from "@/lib/time";
import { placeForwardingTest } from "@/lib/providers/twilio";
import { sendToRep } from "@/lib/messaging";
import { toE164 } from "@/lib/requests";

async function ctx() {
  const customer = await panelCustomer();
  if (!customer) throw new Error("Not signed in");
  return { customer, db: await getDb(), now: new Date() };
}
const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const num = (f: FormData, k: string) => { const v = Number(str(f, k)); return Number.isFinite(v) && str(f, k) !== "" ? v : null; };
const on = (f: FormData, k: string) => f.get(k) === "on" || f.get(k) === "true" || f.get(k) === "1";

// ---- Session ----

export async function signOut() {
  await clearPanelSession();
  redirect("/");
}

/** The header's Live / Pause menu. Sets a value rather than flipping, so a stale menu can't undo a fresh change. */
export async function setAnswering(form: FormData) {
  const { customer, db } = await ctx();
  const value = on(form, "value");
  const [s] = await db.select().from(schema.settings).where(eq(schema.settings.customerId, customer.id));
  if (s.answering === value) return;
  await db.update(schema.settings).set({ answering: value }).where(eq(schema.settings.customerId, customer.id));
  await db.insert(schema.events).values({ customerId: customer.id, type: "settings.changed", payload: { key: "answering", value, via: "panel" } });
  revalidatePath("/panel", "layout");
}

// ---- Requests ----

export async function decide(form: FormData) {
  const { customer, db, now } = await ctx();
  const requestId = str(form, "requestId"); const action = str(form, "action");
  const [r] = await db.select().from(schema.requests).where(and(eq(schema.requests.id, requestId), eq(schema.requests.customerId, customer.id)));
  if (!r) throw new Error("Unknown request");
  const member = await panelActor(db, customer.id);
  if (!member) throw new Error("Add a team member first");
  const cases = num(form, "cases"); const price = num(form, "price"); const reason = str(form, "reason");
  const run = (text: string, buttonPayload?: string) => handleRepMessage(db, { member, text, buttonPayload, now, silent: true });
  switch (action) {
    case "approve": { const partial = cases != null && cases !== (await lineCases(db, requestId)); await run(partial ? `yes but only ${cases}` : "approve", `${partial ? "approve_partial" : "approve"}:${requestId}`); break; }
    case "counter": if (price != null) await run(`${price.toFixed(2)}${cases != null ? ` max ${cases}` : ""}`, `counter_text:${requestId}`); break;
    case "reject": await run("Reject", `reject:${requestId}`); await run(reason || "skip"); break;
    case "take_over": await run("Take over", `take_over:${requestId}`); break;
    case "won": case "lost": await run(action, `${action}:${requestId}`); break;
    case "undo": await run("undo", `undo:${requestId}`); break;
    case "entered": await db.update(schema.requests).set({ enteredAt: now }).where(eq(schema.requests.id, requestId)); break;
  }
  revalidatePath("/panel"); revalidatePath(`/panel/requests/${requestId}`);
}
async function lineCases(db: Awaited<ReturnType<typeof getDb>>, requestId: string) {
  const [l] = await db.select().from(schema.orderLines).where(eq(schema.orderLines.requestId, requestId));
  return l?.cases ?? null;
}

// ---- Controls ----

export async function toggleSwitch(form: FormData) {
  const { customer, db } = await ctx();
  const key = str(form, "key") as "answering" | "autoClear" | "daytimeOverflow" | "everyoneGetsCards";
  if (!["answering", "autoClear", "daytimeOverflow", "everyoneGetsCards"].includes(key)) throw new Error("bad switch");
  const [s] = await db.select().from(schema.settings).where(eq(schema.settings.customerId, customer.id));
  await db.update(schema.settings).set({ [key]: !s[key] }).where(eq(schema.settings.customerId, customer.id));
  await db.insert(schema.events).values({ customerId: customer.id, type: "settings.changed", payload: { key, value: !s[key], via: "panel" } });
  revalidatePath("/panel/controls");
}

export async function updateRule(form: FormData) {
  const { customer, db } = await ctx();
  const id = str(form, "id");
  const [rule] = await db.select().from(schema.priceRules).where(and(eq(schema.priceRules.id, id), eq(schema.priceRules.customerId, customer.id)));
  if (!rule) throw new Error("Unknown rule");
  const patch: Partial<typeof schema.priceRules.$inferInsert> = {};
  if (str(form, "op") === "toggle") patch.on = !rule.on;
  else { const p = num(form, "minPrice"); const c = num(form, "caseLimit"); if (p != null) patch.minPrice = p.toFixed(2); if (c != null) patch.caseLimit = Math.max(c, rule.casesCleared); }
  await db.update(schema.priceRules).set(patch).where(eq(schema.priceRules.id, id));
  revalidatePath("/panel/controls");
}

export async function pauseAll(form: FormData) {
  const { customer, db, now } = await ctx();
  const member = await panelActor(db, customer.id);
  await applyRuleCommand(db, { customerId: customer.id, memberId: member?.id ?? "", cmd: { kind: str(form, "op") === "resume" ? "resume" : "pause", target: null }, now });
  revalidatePath("/panel/controls");
}

export async function addRule(form: FormData) {
  const { customer, db, now } = await ctx();
  const member = await panelActor(db, customer.id);
  const product = str(form, "product"); const price = num(form, "minPrice"); const cases = num(form, "caseLimit");
  if (!product || price == null || cases == null) return;
  const { expires } = await defaultExpiry(db, customer.id, now);
  await goLive(db, { customerId: customer.id, sheetId: null, memberId: member?.id ?? null, rules: [{ product, size: str(form, "size") || null, pack: str(form, "pack") || null, minPrice: price, caseLimit: cases }], expiresAt: expires, now });
  revalidatePath("/panel/controls");
}

export async function uploadSheet(form: FormData) {
  const { customer, db, now } = await ctx();
  const member = await panelActor(db, customer.id);
  const file = form.get("sheet");
  const text = str(form, "text");
  let parsed;
  if (file instanceof File && file.size > 0) {
    if (!/^(image\/|application\/pdf)/.test(file.type)) throw new Error("PDF or photo only for now; export Excel as PDF.");
    parsed = await parsePriceSheet({ file: { base64: Buffer.from(await file.arrayBuffer()).toString("base64"), mediaType: file.type }, text: text || undefined });
  } else if (text) parsed = await parsePriceSheet({ text });
  else return;
  const staged = await stagePriceSheet(db, { customerId: customer.id, memberId: member?.id ?? "", parsed, receivedVia: "upload", rawText: text || null, now });
  redirect(`/panel/controls?sheet=${staged.sheet.id}`);
}

export async function answerSheet(form: FormData) {
  const { customer, db, now } = await ctx();
  const member = await panelActor(db, customer.id);
  const sheetId = str(form, "sheetId"); const answer = str(form, "answer") || str(form, "fix");
  const r = await answerSheetReadBack(db, { customerId: customer.id, memberId: member?.id ?? "", sheetId, text: answer, now });
  if (r.live || /^(no|cancel)/i.test(answer)) redirect("/panel/controls");
  redirect(`/panel/controls?sheet=${sheetId}`);
}

export async function toggleCoverage(form: FormData) {
  const { customer, db } = await ctx();
  const memberId = str(form, "memberId"); const weekday = Number(str(form, "weekday"));
  const [m] = await db.select().from(schema.teamMembers).where(and(eq(schema.teamMembers.id, memberId), eq(schema.teamMembers.customerId, customer.id)));
  if (!m) throw new Error("Unknown member");
  const existing = await db.select().from(schema.coverage).where(and(eq(schema.coverage.memberId, memberId), eq(schema.coverage.weekday, weekday)));
  if (existing.length) await db.delete(schema.coverage).where(and(eq(schema.coverage.memberId, memberId), eq(schema.coverage.weekday, weekday)));
  else await db.insert(schema.coverage).values({ memberId, weekday });
  revalidatePath("/panel/controls");
}

export async function setOnCall(form: FormData) {
  const { customer, db } = await ctx();
  const memberId = str(form, "memberId");
  await db.update(schema.teamMembers).set({ isOnCall: false }).where(eq(schema.teamMembers.customerId, customer.id));
  await db.update(schema.teamMembers).set({ isOnCall: true }).where(and(eq(schema.teamMembers.id, memberId), eq(schema.teamMembers.customerId, customer.id)));
  revalidatePath("/panel/controls");
}

// ---- Settings ----

export async function saveCompany(form: FormData) {
  const { customer, db } = await ctx();
  const tz = str(form, "timezone");
  await db.update(schema.customers).set({ name: str(form, "name") || customer.name, timezone: tz && validTimeZone(tz) ? tz : customer.timezone }).where(eq(schema.customers.id, customer.id));
  revalidatePath("/panel", "layout");
}

export async function addMember(form: FormData) {
  const { customer, db, now } = await ctx();
  const name = str(form, "name"); const cell = toE164(str(form, "cell"));
  if (!name || !cell) return;
  const [m] = await db.insert(schema.teamMembers).values({ customerId: customer.id, name, cell, email: str(form, "email") || null, canApprove: true }).returning();
  await db.insert(schema.coverage).values([0, 1, 2, 3, 4].map((weekday) => ({ memberId: m.id, weekday })));
  await sendToRep(db, m, { customerId: customer.id, body: `${customer.name} added you to Soba, the after-hours desk. Reply OK to get order requests here on WhatsApp.`, template: { kind: "notice" }, now });
  revalidatePath("/panel/settings");
}

export async function toggleMember(form: FormData) {
  const { customer, db } = await ctx();
  const id = str(form, "memberId"); const key = str(form, "key") as "canSetPrices" | "canApprove" | "canEditSettings" | "isOrderClerk" | "summaryWhatsapp" | "summaryEmail" | "active";
  if (!["canSetPrices", "canApprove", "canEditSettings", "isOrderClerk", "summaryWhatsapp", "summaryEmail", "active"].includes(key)) throw new Error("bad key");
  const [m] = await db.select().from(schema.teamMembers).where(and(eq(schema.teamMembers.id, id), eq(schema.teamMembers.customerId, customer.id)));
  if (!m) throw new Error("Unknown member");
  await db.update(schema.teamMembers).set({ [key]: !m[key] }).where(eq(schema.teamMembers.id, id));
  revalidatePath("/panel/settings");
}

export async function saveHours(form: FormData) {
  const { customer, db } = await ctx();
  const hours: Record<string, { open: string; close: string; closed: boolean }> = {};
  for (const d of ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]) hours[d] = { open: snapToQuarter(str(form, `${d}_open`) || "06:00"), close: snapToQuarter(str(form, `${d}_close`) || "17:00"), closed: !on(form, `${d}_open_switch`) };
  if (Object.values(hours).every((h) => h.closed)) throw new Error("At least one day must be open");
  const holidays = str(form, "holidays").split(/[\n,]/).map((s) => s.trim()).filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s));
  await db.update(schema.settings).set({ hours, holidays }).where(eq(schema.settings.customerId, customer.id));
  revalidatePath("/panel/settings");
}

export async function saveVoice(form: FormData) {
  const { customer, db } = await ctx();
  await db.update(schema.settings).set({
    greeting: str(form, "greeting") || `${customer.name}, sales. How can I help?`, voice: str(form, "voice") || "default",
    spanish: on(form, "spanish"), quotePrices: on(form, "quotePrices"), timingPromises: on(form, "timingPromises"), urgentRing: on(form, "urgentRing"),
    businessInfo: str(form, "businessInfo"),
  }).where(eq(schema.settings.customerId, customer.id));
  revalidatePath("/panel/settings");
}

export async function saveCallbacks(form: FormData) {
  const { customer, db } = await ctx();
  await db.update(schema.settings).set({
    undoSeconds: num(form, "undoMinutes") != null ? Math.round(num(form, "undoMinutes")! * 60) : 120,
    noAnswerAction: ["text", "whatsapp", "none"].includes(str(form, "noAnswerAction")) ? str(form, "noAnswerAction") : "text",
    confirmationTemplate: str(form, "confirmationTemplate") || undefined, textFirstBeforeCall: on(form, "textFirst"),
  }).where(eq(schema.settings.customerId, customer.id));
  revalidatePath("/panel/settings");
}

export async function saveSummary(form: FormData) {
  const { customer, db } = await ctx();
  const sections = ["orders", "rules", "other", "transcripts"].filter((s) => on(form, `section_${s}`));
  await db.update(schema.settings).set({ summaryMinutesBefore: num(form, "minutes") ?? 15, summarySections: sections, quietNightNote: on(form, "quietNightNote"), summaryLanguage: str(form, "language") === "es" ? "es" : "en" }).where(eq(schema.settings.customerId, customer.id));
  revalidatePath("/panel/settings");
}

export async function sendTestSummary() {
  const { customer, db, now } = await ctx();
  const [s] = await db.select().from(schema.settings).where(eq(schema.settings.customerId, customer.id));
  const opening = nextOpening(now, s.hours, customer.timezone, s.holidays);
  // A test goes to the owner only, and never blocks the real one: it is keyed on a window one second off.
  await sendMorningSummary(db, customer.id, new Date(opening.getTime() + 1000), now, { onlyMemberId: (await panelActor(db, customer.id))?.id });
  revalidatePath("/panel/settings");
}

export async function saveLines(form: FormData) {
  const { customer, db } = await ctx();
  const [voice] = await db.select().from(schema.lines).where(and(eq(schema.lines.customerId, customer.id), eq(schema.lines.kind, "voice")));
  if (voice) await db.update(schema.lines).set({ backupNumber: toE164(str(form, "backupNumber")) ?? null, companyNumber: toE164(str(form, "companyNumber")) ?? voice.companyNumber }).where(eq(schema.lines.id, voice.id));
  await db.update(schema.settings).set({
    ringCount: num(form, "ringCount") ?? 4,
    blockedNumbers: str(form, "blockedNumbers").split(/[\n,]/).map((s) => toE164(s.trim())).filter((x): x is string => Boolean(x)),
    testNumbers: str(form, "testNumbers").split(/[\n,]/).map((s) => toE164(s.trim())).filter((x): x is string => Boolean(x)),
    retentionMonths: num(form, "retentionMonths") ?? 12,
    samePricesPromptTime: /^\d{2}:\d{2}$/.test(str(form, "samePricesPromptTime")) ? snapToQuarter(str(form, "samePricesPromptTime")) : "17:30",
    escalationMinutes: num(form, "escalationMinutes") ?? 10,
  }).where(eq(schema.settings.customerId, customer.id));
  revalidatePath("/panel/settings");
}

export async function testForwarding() {
  const { customer, db, now } = await ctx();
  const [voice] = await db.select().from(schema.lines).where(and(eq(schema.lines.customerId, customer.id), eq(schema.lines.kind, "voice")));
  const [text] = await db.select().from(schema.lines).where(and(eq(schema.lines.customerId, customer.id), eq(schema.lines.kind, "text")));
  if (!voice?.companyNumber || !text) return;
  await placeForwardingTest(text.twilioNumber, voice.companyNumber);
  await db.update(schema.lines).set({ lastForwardingTestAt: now, lastForwardingTestOk: null }).where(eq(schema.lines.id, voice.id));
  await db.insert(schema.events).values({ customerId: customer.id, type: "forwarding.test_placed", payload: { lineId: voice.id, via: "panel" } });
  revalidatePath("/panel/settings");
}
