// Twilio: SMS on each customer's text line, WhatsApp from our one business
// number, and webhook signature checks. Nothing here touches the database.
import twilio from "twilio";
import { validateRequest } from "twilio/lib/webhooks/webhooks";
import { env } from "../env";

let _client: ReturnType<typeof twilio> | undefined;
export function twilioClient() {
  _client ??= twilio(env.twilio.accountSid, env.twilio.authToken);
  return _client;
}

export type SendResult = { sid: string | null; dryRun: boolean };

export async function sendSms(args: { from: string; to: string; body: string; statusCallback?: string }): Promise<SendResult> {
  if (env.dryRun) return { sid: `dry_${Date.now()}`, dryRun: true };
  const m = await twilioClient().messages.create({ from: args.from, to: args.to, body: args.body, statusCallback: args.statusCallback });
  return { sid: m.sid, dryRun: false };
}

/**
 * WhatsApp to a rep. With a template SID the message carries quick-reply buttons and can
 * open a conversation; without one it is free-form text, allowed only inside the 24-hour
 * window after the rep's last message. Callers pass both and we pick.
 */
export async function sendWhatsApp(args: {
  to: string;                      // E.164, we add the whatsapp: prefix
  body: string;                    // free-form body, or the fallback when no template is configured
  template?: { sid: string | null; variables: Record<string, string> } | null;
  statusCallback?: string;
}): Promise<SendResult> {
  if (env.dryRun) return { sid: `dry_${Date.now()}`, dryRun: true };
  const to = args.to.startsWith("whatsapp:") ? args.to : `whatsapp:${args.to}`;
  const base = { from: env.twilio.whatsappFrom, to, statusCallback: args.statusCallback };
  const m = args.template?.sid
    ? await twilioClient().messages.create({ ...base, contentSid: args.template.sid, contentVariables: JSON.stringify(args.template.variables) })
    : await twilioClient().messages.create({ ...base, body: args.body });
  return { sid: m.sid, dryRun: false };
}

/** Parse an application/x-www-form-urlencoded webhook body into a flat record. */
export async function readForm(req: Request): Promise<{ raw: string; params: Record<string, string> }> {
  const raw = await req.text();
  const params: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(raw)) params[k] = v;
  return { raw, params };
}

/**
 * The URL Twilio signed is the public one. Behind a proxy (Vercel) the request URL is
 * right, but we let APP_URL win so a different internal host never breaks validation.
 */
export function publicUrl(req: Request): string {
  const u = new URL(req.url);
  const base = new URL(env.appUrl);
  u.protocol = base.protocol; u.host = base.host;
  return u.toString();
}

export function verifyTwilio(req: Request, params: Record<string, string>): boolean {
  if (process.env.SOBA_SKIP_SIGNATURES === "1") return true;
  const sig = req.headers.get("x-twilio-signature") ?? "";
  return validateRequest(env.twilio.authToken, sig, publicUrl(req), params);
}

/** WhatsApp numbers arrive as whatsapp:+1555…; SMS as +1555…. Normalize to E.164. */
export const stripWhatsApp = (n: string) => n.replace(/^whatsapp:/, "");

/** Rings a rep's cell and reads one sentence (urgent requests). From the customer's text line. */
export async function ringRep(db: import("@/db").Db, customerId: string, to: string, say: string): Promise<SendResult> {
  if (env.dryRun) return { sid: `dry_call_${Date.now()}`, dryRun: true };
  const { textLineNumber } = await import("../messaging");
  const from = await textLineNumber(db, customerId);
  if (!from) return { sid: null, dryRun: false };
  const twiml = `<Response><Say voice="Polly.Joanna">${say.replace(/[<>&]/g, "")}</Say><Pause length="1"/><Say voice="Polly.Joanna">${say.replace(/[<>&]/g, "")}</Say></Response>`;
  const c = await twilioClient().calls.create({ from, to, twiml });
  return { sid: c.sid, dryRun: false };
}

/**
 * Nightly forwarding test: our text line calls the customer's company number and hangs up
 * after a short message. If forwarding works the call lands on our voice line and the
 * intake webhook marks the line OK (caller = our number).
 */
export async function placeForwardingTest(from: string, companyNumber: string): Promise<SendResult> {
  if (env.dryRun) return { sid: `dry_test_${Date.now()}`, dryRun: true };
  const c = await twilioClient().calls.create({ from, to: companyNumber, twiml: `<Response><Say>Soba forwarding test.</Say><Pause length="2"/><Hangup/></Response>`, timeout: 40 });
  return { sid: c.sid, dryRun: false };
}
