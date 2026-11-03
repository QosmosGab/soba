// ElevenLabs post-call webhook. Two agents post here: the intake agent on each
// customer line (transcript → request) and the callback agent (outcome). The
// customer is found by the number that was called; retries are ignored by
// conversation id.
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { verifyElevenLabs, callNumbers, transcriptText, type PostCallEvent } from "@/lib/providers/elevenlabs";
import { handleIntake } from "@/lib/intake";
import { handleCallbackOutcome, type CallbackOutcome } from "@/lib/callbacks";
import { json, lineByNumber, lineByAgent, recordInbound, safeError } from "@/lib/http";
import type { Extracted } from "@/lib/requests";
import { toE164 } from "@/lib/requests";

const unreadable = (transcript: string, callerId: string | null): Extracted => ({
  type: "other", callerName: null, callerCompany: null, callerCity: null, callbackNumber: toE164(callerId), callbackPermission: null,
  preferredChannel: "call", lines: [], language: "en", flags: ["unclear"], summary: `The desk could not read this call. Notes: ${transcript.slice(0, 300)}`, complaint: null, resolvedLines: [],
});

export async function POST(req: Request) {
  const raw = await req.text();
  let event: PostCallEvent;
  try { event = await verifyElevenLabs(raw, req.headers.get("elevenlabs-signature")); }
  catch (err) { return json({ error: safeError(err) }, 401); }
  if (event.type !== "post_call_transcription") return json({ ok: true, ignored: event.type });
  const db = await getDb();
  const now = new Date();
  const data = event.data;
  const dv = data.conversation_initiation_client_data?.dynamic_variables ?? {};

  // Callback agent: the outcome comes back as data-collection fields.
  const isCallbackAgent = data.agent_id === process.env.ELEVENLABS_CALLBACK_AGENT_ID || (typeof dv.intent === "string" && typeof dv.request_id === "string");
  if (isCallbackAgent) {
    const dc = data.analysis?.data_collection_results ?? {};
    const get = (k: string) => { const v = dc[k]?.value; return typeof v === "string" && v.trim() ? v.trim() : null; };
    const raw = (get("outcome") ?? "no_answer").toLowerCase().replace(/[\s-]+/g, "_");
    const outcome = (["confirmed", "declined", "changed", "no_answer", "bought_elsewhere"].includes(raw) ? raw : "no_answer") as CallbackOutcome["outcome"];
    const r = await handleCallbackOutcome(db, data.conversation_id, { outcome, notes: data.analysis?.transcript_summary ?? null, changeDetails: get("change_details"), competitor: get("competitor"), competitorPrice: get("competitor_price"), transcript: transcriptText(event) }, now);
    return json({ ok: true, callback: r });
  }

  const { callerId, calledNumber, callSid } = callNumbers(event);
  const line = (await lineByNumber(db, calledNumber)) ?? (await lineByAgent(db, data.agent_id));
  if (!line) {
    await db.insert(schema.events).values({ type: "intake.unknown_line", payload: { conversationId: data.conversation_id, calledNumber, agentId: data.agent_id } });
    return json({ ok: false, error: `No line for called number ${calledNumber} or agent ${data.agent_id}` }, 200);
  }
  const transcript = transcriptText(event);
  const fresh = await recordInbound(db, { customerId: line.customerId, direction: "in", party: "buyer", channel: "voice", body: transcript, providerId: data.conversation_id, sentAt: now });
  if (!fresh) return json({ ok: true, duplicate: true });
  if (!transcript.trim()) {
    await db.insert(schema.events).values({ customerId: line.customerId, type: "intake.empty_call", payload: { conversationId: data.conversation_id, callerId, callSid, reason: data.metadata?.termination_reason ?? null } });
    return json({ ok: true, empty: true });
  }
  try {
    const result = await handleIntake(db, { customerId: line.customerId, channel: "call", transcript, now, callerId, providerConversationId: data.conversation_id });
    if ("requestId" in result) await db.update(schema.messages).set({ requestId: result.requestId }).where(eq(schema.messages.providerId, data.conversation_id));
    return json({ ok: true, result });
  } catch (err) {
    // Nothing is dropped: the reps get the raw notes as an "unclear" card.
    await db.insert(schema.events).values({ customerId: line.customerId, type: "intake.failed", payload: { conversationId: data.conversation_id, error: safeError(err) } });
    try {
      const result = await handleIntake(db, { customerId: line.customerId, channel: "call", transcript, now, callerId, providerConversationId: data.conversation_id, extracted: unreadable(transcript, callerId) });
      return json({ ok: true, result, degraded: true });
    } catch (err2) {
      return json({ ok: false, error: safeError(err2) }, 500);
    }
  }
}


