// Sends an event to Inngest; in tests and dry runs it only records the event in a buffer
// the tests can inspect, so the service layer never needs a running Inngest.
import { env } from "@/lib/env";

export type SobaEvent =
  | { name: "soba/card.sent"; data: { requestId: string; customerId: string } }
  | { name: "soba/decision.made"; data: { decisionId: string; requestId: string; customerId: string } }
  | { name: "soba/callback.retry"; data: { callbackId: string; requestId: string; customerId: string } };

export const sentEvents: SobaEvent[] = [];

export async function inngestSend(event: SobaEvent) {
  if (env.dryRun) { sentEvents.push(event); return; }
  if (!env.inngestEventKey) { console.error(`[soba] INNGEST_EVENT_KEY is not set; ${event.name} will not run`, event.data); sentEvents.push(event); return; }
  const { inngest } = await import("./client");
  await inngest.send(event);
}
