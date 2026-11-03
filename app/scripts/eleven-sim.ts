// Runs one ElevenLabs simulation test against an agent and prints the transcript.
//   ELEVENLABS_API_KEY=... npx tsx scripts/eleven-sim.ts <agentId> "<test name>" "<scenario>" "<success condition>" ['{"dynamic":"variables"}']
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
const client = new ElevenLabsClient({ apiKey: process.env.ELEVENLABS_API_KEY });
const [agentId, name, scenario, success, varsJson] = process.argv.slice(2);
const dynamicVariables = varsJson ? (JSON.parse(varsJson) as Record<string, unknown>) : undefined;
async function main() {
  const existing = (await client.conversationalAi.tests.list({ search: name, pageSize: 10 })).tests.find((t) => t.name === name);
  const spec = { simulationScenario: scenario, successConditions: [success], simulationMaxTurns: 12, simulatedUserModel: "gemini-2.5-flash" as const, evaluationModel: "gemini-2.5-flash" as const, dynamicVariables };
  if (existing) await client.conversationalAi.tests.update(existing.id, { type: "simulation", name, ...spec });
  const testId = existing?.id ?? (await client.conversationalAi.tests.create({ type: "simulation", name, ...spec })).id;
  const inv = await client.conversationalAi.agents.runTests(agentId, { tests: [{ testId }] });
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const r = await client.conversationalAi.tests.invocations.get(inv.id);
    const run = r.testRuns[0];
    if (run.status !== "pending") {
      console.log("STATUS", run.status, "| credits", run.creditsUsed);
      for (const t of run.agentResponses ?? []) console.log(`${t.role.toUpperCase()}: ${(t.message ?? "").trim().slice(0, 300)}${t.toolCalls?.length ? " | tools: " + t.toolCalls.map((c) => c.toolName + " " + JSON.stringify(c.paramsAsJson ?? "").slice(0, 200)).join("; ") : ""}${t.toolResults?.length ? " | results: " + t.toolResults.map((c) => String(c.resultValue ?? "").slice(0, 200)).join("; ") : ""}`);
      console.log("RATIONALE", JSON.stringify(run.conditionResult?.rationale ?? null).slice(0, 500));
      return;
    }
  }
  console.log("timed out waiting; invocation", inv.id);
}
main().catch((e) => { console.error(e?.body ?? e); process.exit(1); });
