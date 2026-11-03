// Starts the durable timers. In dry runs and tests nothing is scheduled; the
// request is recorded in `scheduled` so a test can assert it. A timer started twice
// is harmless: every step it runs checks the database before acting.
import { env } from "./env";

export type TimerRequest =
  | { kind: "decision"; decisionId: string; requestId: string; customerId: string }
  | { kind: "escalation"; requestId: string; customerId: string }
  | { kind: "callbackRetry"; callbackId: string; requestId: string; customerId: string };

export const scheduled: TimerRequest[] = [];

export async function startTimer(t: TimerRequest): Promise<void> {
  if (env.dryRun) { scheduled.push(t); return; }
  const { start } = await import("workflow/api");
  const { decisionTimer, cardEscalation, callbackRetry } = await import("@/workflows/timers");
  switch (t.kind) {
    case "decision": await start(decisionTimer, [t.decisionId]); return;
    case "escalation": await start(cardEscalation, [t.requestId, t.customerId]); return;
    case "callbackRetry": await start(callbackRetry, [t.callbackId]); return;
  }
}
