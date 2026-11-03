// Everything in Soba that waits on time, as Vercel Workflows: durable sleeps that
// survive deploys and crashes, each step retried on transient failure. The steps
// call the same service functions the tests cover; the workflow functions only sequence them.
import { sleep } from "workflow";
import { executeDecision, retryCallback } from "@/lib/callbacks";
import { remindOnCard, loadCustomer } from "@/lib/cards";
import { nextOpening } from "@/lib/hours";
import { getDb, schema } from "@/db";
import { eq } from "drizzle-orm";

/** After the undo window, act on a rep's decision (unless it was undone or replaced). */
export async function decisionTimer(decisionId: string) {
  "use workflow";
  const deadline = await readDeadline(decisionId);
  if (deadline) await sleep(new Date(deadline));
  return execute(decisionId);
}

async function readDeadline(decisionId: string): Promise<string | null> {
  "use step";
  const db = await getDb();
  const [d] = await db.select().from(schema.decisions).where(eq(schema.decisions.id, decisionId));
  return d?.undoDeadline?.toISOString() ?? null;
}

async function execute(decisionId: string) {
  "use step";
  return executeDecision(await getDb(), decisionId, new Date());
}

/** A card nobody answers: remind the on-call rep after the escalation delay, then the owner at opening. */
export async function cardEscalation(requestId: string, customerId: string) {
  "use workflow";
  const minutes = await escalationMinutes(customerId);
  await sleep(minutes * 60 * 1000);
  const reminded = await remind(requestId, "oncall");
  if (!reminded) return { done: "claimed" };
  const opening = await nextOpeningIso(customerId);
  await sleep(new Date(opening));
  return remind(requestId, "owner");
}

async function escalationMinutes(customerId: string): Promise<number> {
  "use step";
  return (await loadCustomer(await getDb(), customerId)).settings.escalationMinutes;
}

async function remind(requestId: string, stage: "oncall" | "owner"): Promise<boolean> {
  "use step";
  return remindOnCard(await getDb(), requestId, new Date(), stage);
}

async function nextOpeningIso(customerId: string): Promise<string> {
  "use step";
  const db = await getDb();
  const { customer, settings } = await loadCustomer(db, customerId);
  return nextOpening(new Date(), settings.hours, customer.timezone, settings.holidays).toISOString();
}

/** Second callback attempt ten minutes after no answer. */
export async function callbackRetry(callbackId: string) {
  "use workflow";
  await sleep("10m");
  return retry(callbackId);
}

async function retry(callbackId: string) {
  "use step";
  return retryCallback(await getDb(), callbackId, new Date());
}
