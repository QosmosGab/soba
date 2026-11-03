// Creates (or updates) everything Soba needs in ElevenLabs: the shared tool secret,
// the soba_desk webhook tool, the intake agent, the callback agent and the post-call
// webhook. Idempotent: existing objects are found by name and updated.
//
//   ELEVENLABS_API_KEY=... APP_URL=https://app.usesoba.com \
//   SOBA_TOOL_SECRET=... [SOBA_WEBHOOK_SECRET=...] npx tsx scripts/eleven-setup.ts
//
// Prints a JSON summary (ids and any newly generated secrets) on the last line.
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

const apiKey = process.env.ELEVENLABS_API_KEY;
const appUrl = (process.env.APP_URL ?? "https://app.usesoba.com").replace(/\/$/, "");
if (!apiKey) throw new Error("ELEVENLABS_API_KEY missing");
const client = new ElevenLabsClient({ apiKey });

const LLM = "gemini-2.5-flash" as const;      // Gemini per the vendor rule; flash for voice latency
const TTS_MODEL = "eleven_flash_v2" as const;   // English agents must use turbo/flash v2; Spanish preset switches to v2.5 below
const VOICE_ID = "cjVigY5qzO86Huf0OWal";       // Eric: smooth, trustworthy, American

// Placeholder values so the template agents can be test-called before a real customer exists.
const TEST_CUSTOMER = {
  customer_name: "Del Campo Supreme",
  greeting: "Del Campo Supreme, sales. How can I help?",
  business_info: "We ship from Nogales, Arizona. Pickup is at the Nogales warehouse, weekdays from 6 AM. Delivered loads by arrangement.",
  quote_prices: "You may tell the caller tonight's price on a product if the lookup returned one.",
  timing_promises: "Never promise when they'll hear back.",
};
const CALLBACK_PLACEHOLDERS = {
  company_name: "Del Campo Supreme", buyer_name: "Mike", buyer_company: "Lopez Bros Produce", ref: "DC-1042",
  intent: "confirm", product: "4x4 vine-ripe tomatoes, 25 lb two-layer", cases: "200", price: "14.50", pickup: "Thursday",
  reason: "", rep_name: "Carlos", original_cases: "200", original_price: "14.50", request_id: "test",
};

function section(md: string, heading: string): string {
  const re = new RegExp(`^## ${heading}\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, "m");
  const m = md.match(re);
  if (!m) throw new Error(`section ${heading} not found`);
  return m[1].trim();
}

async function ensureSecret(name: string, value: string): Promise<string> {
  const existing = (await client.conversationalAi.secrets.list()).secrets.find((s) => s.name === name);
  if (existing) return existing.secretId;
  const created = await client.conversationalAi.secrets.create({ name, value });
  return created.secretId;
}

async function ensureTool(secretId: string): Promise<string> {
  const str = (description: string) => ({ type: "string" as const, description });
  const num = (description: string) => ({ type: "number" as const, description });
  const config = {
    type: "webhook" as const,
    name: "soba_desk",
    description: "Looks up the caller and tonight's prices (lookup), or books an order on the spot if it meets tonight's rules (try_clear). Call lookup first on every call. Call try_clear only when you have product, size, cases, pickup day, a price and the buyer's name.",
    responseTimeoutSecs: 20,
    toolErrorHandlingMode: "hide" as const,
    apiSchema: {
      url: `${appUrl}/api/tools/elevenlabs`,
      method: "POST" as const,
      requestHeaders: { "x-soba-tool-secret": { secretId } },
      requestBodySchema: {
        type: "object" as const,
        required: ["action", "called_number"],
        properties: {
          action: { type: "string" as const, description: "lookup or try_clear", enum: ["lookup", "try_clear"] },
          called_number: { type: "string" as const, dynamicVariable: "system__called_number" },
          caller_id: { type: "string" as const, dynamicVariable: "system__caller_id" },
          conversation_id: { type: "string" as const, dynamicVariable: "system__conversation_id" },
          product: str("Product as the caller said it"),
          size: str("Size, e.g. 4x4"),
          pack: str("Pack, e.g. 25 lb two-layer"),
          cases: num("Number of cases"),
          price: num("Price per case in dollars, only if the caller offered one"),
          pickup: str("Pickup day as said"),
          fulfillment: { type: "string" as const, description: "collect or delivered", enum: ["collect", "delivered"] },
          buyer_name: str("Caller's name"),
          company: str("Caller's company"),
          city: str("Delivery city if delivered"),
          callback_number: str("Number to call or text back"),
          callback_permission: { type: "boolean" as const, description: "true only if the caller agreed to be called or texted back" },
          language: { type: "string" as const, description: "Language the caller mostly used", enum: ["en", "es", "mixed"] },
        },
      },
    },
  };
  const existing = (await client.conversationalAi.tools.list()).tools.find((t) => (t.toolConfig as { name?: string }).name === "soba_desk");
  if (existing) {
    await client.conversationalAi.tools.update(existing.id, { toolConfig: config });
    return existing.id;
  }
  return (await client.conversationalAi.tools.create({ toolConfig: config })).id;
}

async function ensureWebhook(): Promise<{ id: string; secret?: string }> {
  const name = "soba-post-call";
  const existing = (await client.webhooks.list()).webhooks.find((w) => w.name === name);
  if (existing) return { id: existing.webhookId };
  const created = await client.webhooks.create({ settings: { authType: "hmac", name, webhookUrl: `${appUrl}/api/webhooks/elevenlabs` } });
  return { id: created.webhookId, secret: created.webhookSecret };
}

type AgentBody = Parameters<typeof client.conversationalAi.agents.create>[0];

async function ensureAgent(name: string, body: AgentBody): Promise<string> {
  const page = await client.conversationalAi.agents.list({ pageSize: 100 });
  const existing = page.agents.find((a) => a.name === name);
  if (existing) {
    await client.conversationalAi.agents.update(existing.agentId, body);
    return existing.agentId;
  }
  return (await client.conversationalAi.agents.create({ ...body, name })).agentId;
}

function fill(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in vars ? vars[k] : m));
}

async function main() {
  const toolSecret = process.env.SOBA_TOOL_SECRET ?? randomBytes(24).toString("hex");
  const secretId = await ensureSecret("soba_tool_secret", toolSecret);
  const toolId = await ensureTool(secretId);
  const webhook = await ensureWebhook();
  const webhooks = { postCallWebhookId: webhook.id, events: ["transcript" as const] };

  const intakeMd = readFileSync(new URL("../agents/intake-agent.md", import.meta.url), "utf8");
  const callbackMd = readFileSync(new URL("../agents/callback-agent.md", import.meta.url), "utf8");

  const common = {
    asr: { keywords: ["vine-ripe", "Roma", "saladette", "jitomate", "cajas", "pallet", "two-layer", "Nogales"] },
    tts: { modelId: TTS_MODEL, voiceId: VOICE_ID, stability: 0.5, similarityBoost: 0.8, speed: 1.0 },
    turn: { turnTimeout: 7, silenceEndCallTimeout: 20 },
    conversation: { maxDurationSeconds: 600 },
    languagePresets: { es: { overrides: { agent: { language: "es" }, tts: { modelId: "eleven_flash_v2_5" as const } } } },
  };
  const builtInTools = {
    endCall: { name: "end_call", description: "End the call when the conversation is finished or the caller is a robocall or sales pitch.", params: { systemToolType: "end_call" as const } },
    languageDetection: { name: "language_detection", description: "Switch language when the caller speaks Spanish, including mid-sentence.", params: { systemToolType: "language_detection" as const } },
  };

  // Intake agent: {{greeting}} etc. are left as dynamic variables with the test customer as placeholders,
  // so a per-customer copy only needs its placeholders changed.
  const intakePrompt = section(intakeMd, "System prompt");
  const intakeId = await ensureAgent("Soba intake (template)", {
    conversationConfig: {
      ...common,
      agent: {
        firstMessage: "{{greeting}}",
        language: "en",
        dynamicVariables: { dynamic_variable_placeholders: TEST_CUSTOMER }, // typed unknown in the SDK, passed through verbatim, so snake_case,
        prompt: { prompt: intakePrompt, llm: LLM, temperature: 0.3, toolIds: [toolId], builtInTools, timezone: "America/Phoenix" },
      },
    },
    platformSettings: {
      workspaceOverrides: { webhooks },
      privacy: { recordVoice: true, retentionDays: 30 },
    },
    tags: ["soba", "intake"],
  });

  const callbackPrompt = section(callbackMd, "System prompt");
  const callbackFirst = section(callbackMd, "First message");
  const callbackId = await ensureAgent("Soba callback", {
    conversationConfig: {
      ...common,
      agent: {
        firstMessage: callbackFirst,
        language: "en",
        dynamicVariables: { dynamic_variable_placeholders: CALLBACK_PLACEHOLDERS },
        prompt: { prompt: callbackPrompt, llm: LLM, temperature: 0.2, builtInTools: { ...builtInTools, voicemailDetection: { name: "voicemail_detection", description: "Detect voicemail; leave the short message and hang up.", params: { systemToolType: "voicemail_detection" as const, voicemailMessage: "This is the sales desk at {{company_name}} calling about your order. We'll text you." } } }, timezone: "America/Phoenix" },
      },
    },
    platformSettings: {
      workspaceOverrides: { webhooks },
      dataCollection: {
        outcome: { type: "string", description: "How the call ended for the order: confirmed, declined, changed, no_answer or bought_elsewhere.", enum: ["confirmed", "declined", "changed", "no_answer", "bought_elsewhere"] },
        change_details: { type: "string", description: "If the buyer asked for something different (cases, day, product, price), exactly what they asked for. Empty otherwise." },
        competitor: { type: "string", description: "If the buyer bought elsewhere and named who, that name. Empty otherwise." },
        competitor_price: { type: "string", description: "If the buyer gave the competitor's price, that price. Empty otherwise." },
      },
      privacy: { recordVoice: true, retentionDays: 30 },
    },
    tags: ["soba", "callback"],
  });

  console.log(JSON.stringify({ secretId, toolId, webhookId: webhook.id, webhookSecret: webhook.secret, toolSecret: process.env.SOBA_TOOL_SECRET ? undefined : toolSecret, intakeAgentId: intakeId, callbackAgentId: callbackId }));
}

main().catch((e) => { console.error(e?.body ?? e); process.exit(1); });
