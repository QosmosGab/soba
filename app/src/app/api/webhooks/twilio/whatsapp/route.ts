// Inbound WhatsApp on our business number: reps only. Button taps carry a
// payload; price-setters can send commands and price sheets; everything else
// is a reply to a card. The first message from a known cell counts as opt-in.
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { env } from "@/lib/env";
import { readForm, verifyTwilio, stripWhatsApp } from "@/lib/providers/twilio";
import { handleRepMessage, getThread, setThread } from "@/lib/decisions";
import { parseRepReplyFast } from "@/lib/reply";
import { parseRuleCommand, applyRuleCommand, parsePriceSheet, stagePriceSheet, answerSheetReadBack } from "@/lib/rules";
import { sendToRep } from "@/lib/messaging";
import { memberByCell, recordInbound, twiml, json, safeError } from "@/lib/http";

async function fetchMedia(url: string, contentType: string): Promise<{ base64: string; mediaType: string }> {
  const auth = Buffer.from(`${env.twilio.accountSid}:${env.twilio.authToken}`).toString("base64");
  const r = await fetch(url, { headers: { authorization: `Basic ${auth}` } });
  if (!r.ok) throw new Error(`media fetch ${r.status}`);
  return { base64: Buffer.from(await r.arrayBuffer()).toString("base64"), mediaType: contentType };
}

export async function POST(req: Request) {
  const { params } = await readForm(req);
  if (!verifyTwilio(req, params)) return json({ error: "bad signature" }, 403);
  const db = await getDb();
  const now = new Date();
  const from = stripWhatsApp(params.From ?? "");
  const member = await memberByCell(db, from);
  if (!member) return twiml(); // not a rep we know; silently ignored
  const body = (params.Body ?? "").trim();
  const payload = params.ButtonPayload ?? null;
  const fresh = await recordInbound(db, { customerId: member.customerId, direction: "in", party: "rep", channel: "whatsapp", body, buttonPayload: payload, providerId: params.MessageSid, memberId: member.id, sentAt: now });
  if (!fresh) return twiml();
  const reply = (text: string) => sendToRep(db, member, { customerId: member.customerId, body: text, template: { kind: "notice" }, now });
  if (!member.whatsappOptedIn) {
    await db.update(schema.teamMembers).set({ whatsappOptedIn: true }).where(eq(schema.teamMembers.id, member.id));
    await db.insert(schema.events).values({ customerId: member.customerId, type: "member.opted_in", payload: { memberId: member.id } });
    if (!payload && /^(ok|okay|yes|si|sí|join|start|hi|hello|hola)\b/i.test(body)) { await reply(`You're in, ${member.name}. Order requests will come here; reply with a tap or plain words like "yes", "8.50 max 200" or "take".`); return twiml(); }
  }

  try {
    const thread = await getThread(db, member.id);
    const mediaCount = Number(params.NumMedia ?? 0);

    // Price sheets and commands (only reps allowed to set prices). A clear card reply ("approve", "8.50 max 200",
    // "take") while a sheet or the nightly prompt is pending goes to the card; the price question stays pending.
    const fast = parseRepReplyFast(body);
    const cardReply = Boolean(payload) || (fast != null && fast.action !== "acknowledged" && fast.action !== "unclear" && !/^(yes|y|si|sí|ok|okay|no|nope)[\s.!]*$/i.test(body));
    const askingAboutCard = ["awaiting_counter", "awaiting_reason"].includes(thread.state);
    if (member.canSetPrices && !cardReply && !askingAboutCard) {
      if (mediaCount > 0 && params.MediaUrl0) {
        const type = params.MediaContentType0 ?? "application/octet-stream";
        if (!/^(image\/|application\/pdf)/.test(type)) { await reply("I can read PDFs and photos of the price sheet. Excel isn't supported yet: export it as PDF or type the prices, e.g. \"4x4 VR 8.50 600\"."); return twiml(); }
        const file = await fetchMedia(params.MediaUrl0, type);
        const parsed = await parsePriceSheet({ file, text: body || undefined });
        const staged = await stagePriceSheet(db, { customerId: member.customerId, memberId: member.id, parsed, receivedVia: "whatsapp", fileUrl: params.MediaUrl0, now });
        await setThread(db, member.id, { state: "awaiting_sheet_ok", pendingSheetId: staged.sheet.id });
        await reply(staged.text);
        return twiml();
      }
      if (thread.state === "awaiting_sheet_ok" && thread.pendingSheetId && !payload) {
        const r = await answerSheetReadBack(db, { customerId: member.customerId, memberId: member.id, sheetId: thread.pendingSheetId, text: body, now });
        if (r.live || /^(no|cancel|drop it|forget it)$/i.test(body)) await setThread(db, member.id, { state: "idle", pendingSheetId: null });
        await reply(r.text);
        return twiml();
      }
      if (thread.state === "awaiting_same_prices" && /^(yes|y|si|sí|same|ok|dale)\b/i.test(body)) {
        await setThread(db, member.id, { state: "idle" });
        const same = await applyRuleCommand(db, { customerId: member.customerId, memberId: member.id, cmd: { kind: "same" }, now });
        await reply(typeof same === "string" ? same : same.text);
        return twiml();
      }
      if (thread.state === "awaiting_same_prices" && /^(no|nope|not tonight)\b/i.test(body)) {
        await setThread(db, member.id, { state: "idle" });
        await reply("OK, no auto-clear tonight. Every order goes to the team.");
        return twiml();
      }
      const cmd = parseRuleCommand(body);
      if (cmd) {
        const r = await applyRuleCommand(db, { customerId: member.customerId, memberId: member.id, cmd, now });
        if (typeof r === "string") { await setThread(db, member.id, { state: "idle" }); await reply(r); }
        else { await setThread(db, member.id, { state: "awaiting_sheet_ok", pendingSheetId: r.pendingSheetId }); await reply(r.text); }
        return twiml();
      }
      // Long multi-line text that isn't a clean command: try reading it as a sheet.
      if (!payload && body.split("\n").length >= 3 && /\d/.test(body) && !/^(approve|counter|reject|take)/i.test(body)) {
        const parsed = await parsePriceSheet({ text: body });
        if (parsed.rules.length) {
          const staged = await stagePriceSheet(db, { customerId: member.customerId, memberId: member.id, parsed, receivedVia: "whatsapp", rawText: body, now });
          await setThread(db, member.id, { state: "awaiting_sheet_ok", pendingSheetId: staged.sheet.id });
          await reply(staged.text);
          return twiml();
        }
      }
    }
    if (!body && !payload) return twiml();
    await handleRepMessage(db, { member, text: body || (params.ButtonText ?? ""), buttonPayload: payload, now });
  } catch (err) {
    await db.insert(schema.events).values({ customerId: member.customerId, type: "whatsapp.failed", payload: { memberId: member.id, error: safeError(err) } });
    await reply("Something went wrong on our side. Try again in a minute, or use the panel.");
  }
  return twiml();
}
