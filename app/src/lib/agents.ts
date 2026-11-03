// One ElevenLabs intake agent per customer. The template agent (built by
// scripts/eleven-setup.ts) carries the prompt, the soba_desk tool and the
// post-call webhook; a customer's copy differs only in its placeholders
// (name, greeting, what it may say), voice, Spanish preset and time zone.
// Sync is idempotent: no agent yet → duplicate the template; otherwise update.
import { and, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { env } from "./env";
import { elevenClient } from "./providers/elevenlabs";

export const TEMPLATE_AGENT_NAME = "Soba intake (template)";

/** Settings "voice" → ElevenLabs premade voice. The multilingual model speaks Spanish with any of them. */
export const VOICES: Record<string, string> = {
  default: "cjVigY5qzO86Huf0OWal", // Eric: smooth, trustworthy (the voice the template was tuned with)
  elena: "EXAVITQu4vr4xnSDxMaL",   // Sarah: mature, reassuring
  james: "nPczCjzI2devNBz1zQrb",   // Brian: deep, resonant
};

type Customer = typeof schema.customers.$inferSelect;
type Settings = typeof schema.settings.$inferSelect;

/** The five blanks in agents/intake-agent.md, filled from Settings. */
export function intakePlaceholders(customer: Customer, s: Settings): Record<string, string> {
  return {
    customer_name: customer.name,
    greeting: s.greeting || `${customer.name}, sales. How can I help?`,
    business_info: s.businessInfo.trim() || "Nothing beyond the company name; the team answers questions about pickup, terms and stock.",
    quote_prices: s.quotePrices ? "You may tell the caller tonight's price on a product if the lookup returned one." : "Do not quote prices; the team confirms every price.",
    timing_promises: s.timingPromises ? "You may say the team usually answers within the hour." : "Never promise when they'll hear back.",
  };
}

async function templateAgentId(): Promise<string> {
  if (env.eleven.intakeTemplateId) return env.eleven.intakeTemplateId;
  const page = await elevenClient().conversationalAi.agents.list({ pageSize: 100 });
  const t = page.agents.find((a) => a.name === TEMPLATE_AGENT_NAME);
  if (!t) throw new Error(`ElevenLabs agent "${TEMPLATE_AGENT_NAME}" not found; run scripts/eleven-setup.ts`);
  return t.agentId;
}

export type SyncResult = { skipped?: string; agentId?: string; created?: boolean; phoneAssigned?: boolean };

/**
 * Creates or updates the customer's intake agent and stores its id on their voice line.
 * Skips (never throws) without an API key or in dry-run, so local saves and tests stay offline.
 */
export async function syncIntakeAgent(db: Db, customerId: string): Promise<SyncResult> {
  if (!process.env.ELEVENLABS_API_KEY) return { skipped: "no ELEVENLABS_API_KEY" };
  if (env.dryRun && process.env.SOBA_SYNC_AGENTS !== "1") return { skipped: "dry run" };
  const [customer] = await db.select().from(schema.customers).where(eq(schema.customers.id, customerId));
  const [s] = await db.select().from(schema.settings).where(eq(schema.settings.customerId, customerId));
  if (!customer || !s) throw new Error("customer or settings missing");
  const voiceLines = await db.select().from(schema.lines).where(and(eq(schema.lines.customerId, customerId), eq(schema.lines.kind, "voice")));
  let line = voiceLines.find((l) => !l.twilioNumber.startsWith("pending:")) ?? voiceLines[0];

  const client = elevenClient();
  const name = `Soba intake · ${customer.name}`;
  let agentId = line?.elevenAgentId ?? null;
  let created = false;
  if (!agentId) {
    agentId = (await client.conversationalAi.agents.duplicate(await templateAgentId(), { name })).agentId;
    created = true;
  }
  await client.conversationalAi.agents.update(agentId, {
    name,
    tags: ["soba", "intake", customer.id],
    conversationConfig: {
      agent: {
        firstMessage: "{{greeting}}",
        language: "en",
        dynamicVariables: { dynamic_variable_placeholders: intakePlaceholders(customer, s) }, // snake_case: typed unknown, passed verbatim
        prompt: { timezone: customer.timezone },
      },
      tts: { voiceId: VOICES[s.voice] ?? VOICES.default },
      languagePresets: s.spanish ? { es: { overrides: { agent: { language: "es" }, tts: { modelId: "eleven_flash_v2_5" } } } } : {},
    },
  });

  // Remember the id. A customer with no number yet gets a placeholder voice line that Twilio setup fills in later.
  if (line) {
    if (line.elevenAgentId !== agentId) await db.update(schema.lines).set({ elevenAgentId: agentId }).where(eq(schema.lines.id, line.id));
  } else {
    [line] = await db.insert(schema.lines).values({ customerId, kind: "voice", twilioNumber: `pending:${customerId.slice(0, 8)}`, elevenAgentId: agentId }).returning();
  }
  // Point the imported Twilio number at this agent once there is one.
  let phoneAssigned = false;
  if (line.elevenPhoneNumberId) {
    await client.conversationalAi.phoneNumbers.update(line.elevenPhoneNumberId, { agentId });
    phoneAssigned = true;
  }
  await db.insert(schema.events).values({ customerId, type: "agent.synced", payload: { agentId, created, phoneAssigned } });
  return { agentId, created, phoneAssigned };
}

/** Best-effort sync after a Settings save: the save must succeed even when ElevenLabs is down. */
export async function syncIntakeAgentQuietly(db: Db, customerId: string): Promise<void> {
  try { await syncIntakeAgent(db, customerId); }
  catch (e) { console.error("agent sync failed", customerId, e instanceof Error ? e.message : e); }
}
