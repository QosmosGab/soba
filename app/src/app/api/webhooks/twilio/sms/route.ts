// Inbound SMS on a customer's text line. A rep's cell replying by text goes
// through the card logic; anyone else is a buyer talking to the desk.
import { getDb } from "@/db";
import { readForm, verifyTwilio } from "@/lib/providers/twilio";
import { handleBuyerText } from "@/lib/textdesk";
import { handleRepMessage } from "@/lib/decisions";
import { lineByNumber, memberByCell, recordInbound, twiml, json } from "@/lib/http";

export async function POST(req: Request) {
  const { params } = await readForm(req);
  if (!verifyTwilio(req, params)) return json({ error: "bad signature" }, 403);
  const db = await getDb();
  const now = new Date();
  const line = await lineByNumber(db, params.To);
  if (!line) return twiml();
  const body = (params.Body ?? "").trim();
  const member = await memberByCell(db, params.From);
  if (member && member.customerId === line.customerId) {
    const fresh = await recordInbound(db, { customerId: line.customerId, direction: "in", party: "rep", channel: "sms", body, providerId: params.MessageSid, memberId: member.id, sentAt: now });
    if (fresh && body) await handleRepMessage(db, { member, text: body, now });
    return twiml();
  }
  await handleBuyerText(db, { customerId: line.customerId, lineId: line.id, from: params.From, body, providerId: params.MessageSid ?? null, now });
  return twiml();
}
