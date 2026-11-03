// Creates/refreshes one customer's intake agent and prints what ElevenLabs now holds.
//   ELEVENLABS_API_KEY=... SOBA_SYNC_AGENTS=1 PGLITE_DIR=.pglite SOBA_DRY_RUN=1 npx tsx scripts/agent-sync.ts "<customer name>"
import { eq } from "drizzle-orm";
import { getDb, schema } from "../src/db";
import { syncIntakeAgent } from "../src/lib/agents";
import { elevenClient } from "../src/lib/providers/elevenlabs";

async function main() {
  const db = await getDb();
  const [c] = await db.select().from(schema.customers).where(eq(schema.customers.name, process.argv[2] ?? ""));
  if (!c) throw new Error("customer not found");
  const r = await syncIntakeAgent(db, c.id);
  console.log("sync:", r);
  if (!r.agentId) return;
  const a = await elevenClient().conversationalAi.agents.get(r.agentId);
  const ag = a.conversationConfig.agent;
  console.log(JSON.stringify({
    name: a.name, tags: a.tags, firstMessage: ag?.firstMessage, language: ag?.language, timezone: ag?.prompt?.timezone,
    promptChars: ag?.prompt?.prompt?.length, toolIds: ag?.prompt?.toolIds, builtIn: Object.keys(ag?.prompt?.builtInTools ?? {}),
    placeholders: ag?.dynamicVariables, voice: a.conversationConfig.tts?.voiceId, ttsModel: a.conversationConfig.tts?.modelId,
    presets: Object.keys(a.conversationConfig.languagePresets ?? {}), webhook: a.platformSettings?.workspaceOverrides?.webhooks,
  }, null, 1));
}
main().then(() => process.exit(0), (e) => { console.error(e?.body ?? e); process.exit(1); });
