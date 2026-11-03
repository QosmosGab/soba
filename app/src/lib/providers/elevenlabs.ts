// ElevenLabs Agents: verifies the post-call webhook and places outbound
// callbacks through the Twilio integration. Identification of the customer
// happens on the called number (system__called_number), never on forwarded_from.
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { env } from "../env";

let _client: ElevenLabsClient | undefined;
export function elevenClient() {
  _client ??= new ElevenLabsClient({ apiKey: env.eleven.apiKey });
  return _client;
}

export type PostCallTurn = { role: "agent" | "user" | string; message: string | null; time_in_call_secs?: number };
export type PostCallEvent = {
  type: string;
  event_timestamp: number;
  data: {
    agent_id: string;
    conversation_id: string;
    status: string;
    transcript: PostCallTurn[];
    metadata?: { start_time_unix_secs?: number; call_duration_secs?: number; termination_reason?: string; phone_call?: Record<string, unknown> };
    analysis?: { transcript_summary?: string; call_successful?: string; data_collection_results?: Record<string, { value?: unknown; rationale?: string }> };
    conversation_initiation_client_data?: { dynamic_variables?: Record<string, unknown> };
  };
};

/** Verifies the ElevenLabs-Signature header (t=…,v0=…; HMAC-SHA256 of `${t}.${body}`, 30-minute window). */
export async function verifyElevenLabs(rawBody: string, sigHeader: string | null): Promise<PostCallEvent> {
  if (process.env.SOBA_SKIP_SIGNATURES === "1") return JSON.parse(rawBody) as PostCallEvent;
  const event = await elevenClient().webhooks.constructEvent(rawBody, sigHeader ?? "", env.eleven.webhookSecret);
  return event as unknown as PostCallEvent;
}

/** The numbers of a call, from the system dynamic variables ElevenLabs fills on Twilio calls. */
export function callNumbers(e: PostCallEvent): { callerId: string | null; calledNumber: string | null; callSid: string | null } {
  const dv = e.data.conversation_initiation_client_data?.dynamic_variables ?? {};
  const pc = e.data.metadata?.phone_call ?? {};
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  return {
    callerId: str(dv.system__caller_id) ?? str(pc.external_number) ?? null,
    calledNumber: str(dv.system__called_number) ?? str(pc.agent_number) ?? null,
    callSid: str(dv.system__call_sid) ?? str(pc.call_sid) ?? null,
  };
}

/** Plain-text transcript, "Desk:" / "Buyer:" per turn, the shape the extractor was built on. */
export function transcriptText(e: PostCallEvent): string {
  return (e.data.transcript ?? [])
    .filter((t) => t.message)
    .map((t) => `${t.role === "agent" ? "Desk" : "Buyer"}: ${t.message}`)
    .join("\n");
}

/** Outbound callback to a buyer. Dynamic variables feed the callback agent's script. */
export async function placeCallback(args: {
  agentId: string; agentPhoneNumberId: string; to: string; variables: Record<string, string | number | boolean>;
}): Promise<{ conversationId: string | null; callSid: string | null; dryRun: boolean }> {
  if (env.dryRun) return { conversationId: `dry_conv_${Date.now()}`, callSid: null, dryRun: true };
  const r = await elevenClient().conversationalAi.twilio.outboundCall({
    agentId: args.agentId, agentPhoneNumberId: args.agentPhoneNumberId, toNumber: args.to,
    conversationInitiationClientData: { dynamicVariables: args.variables },
  });
  return { conversationId: r.conversationId ?? null, callSid: r.callSid ?? null, dryRun: false };
}
