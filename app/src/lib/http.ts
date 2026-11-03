// Small helpers shared by the route handlers.
import { and, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { toE164 } from "./requests";

export const json = (body: unknown, status = 200) => Response.json(body, { status });
export const twiml = (inner = "") => new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${inner}</Response>`, { headers: { "content-type": "text/xml" } });

/** The customer line behind one of our Twilio numbers. */
export async function lineByNumber(db: Db, number: string | null) {
  const n = toE164(number);
  if (!n) return null;
  const [line] = await db.select().from(schema.lines).where(eq(schema.lines.twilioNumber, n));
  return line ?? null;
}

/** The line whose ElevenLabs intake agent this is (fallback when the called number is missing). */
export async function lineByAgent(db: Db, agentId: string | null | undefined) {
  if (!agentId) return null;
  const [line] = await db.select().from(schema.lines).where(eq(schema.lines.elevenAgentId, agentId));
  return line ?? null;
}

/** A team member by cell, across customers (one WhatsApp number serves every customer). */
export async function memberByCell(db: Db, cell: string | null) {
  const n = toE164(cell);
  if (!n) return null;
  const [m] = await db.select().from(schema.teamMembers).where(and(eq(schema.teamMembers.cell, n), eq(schema.teamMembers.active, true)));
  return m ?? null;
}

/** Records an inbound message once; false when the provider id was seen before (a retry). */
export async function recordInbound(db: Db, row: typeof schema.messages.$inferInsert): Promise<boolean> {
  const r = await db.insert(schema.messages).values(row).onConflictDoNothing().returning({ id: schema.messages.id });
  return r.length > 0;
}

export function safeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
