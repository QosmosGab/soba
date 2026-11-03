// Everything a new customer needs to take a first call tonight: defaults,
// the owner as a rep who sets prices and is on call, the lines, a panel link.
import type { Db } from "@/db";
import { schema } from "@/db";
import { DEFAULT_HOURS } from "./hours";
import { toE164 } from "./requests";
import { randomBytes } from "node:crypto";

export const newToken = () => randomBytes(18).toString("base64url");

/** Everything a new customer needs to take a first call tonight. */
export async function provisionCustomer(db: Db, a: { name: string; timezone?: string; owner: { name: string; cell: string; email?: string | null }; voiceNumber?: string | null; companyNumber?: string | null; textNumber?: string | null }) {
  const [c] = await db.insert(schema.customers).values({ name: a.name, timezone: a.timezone ?? "America/Phoenix", panelToken: newToken() }).returning();
  await db.insert(schema.settings).values({ customerId: c.id, hours: DEFAULT_HOURS, greeting: `${a.name}, sales. How can I help?` });
  const [owner] = await db.insert(schema.teamMembers).values({ customerId: c.id, name: a.owner.name, cell: toE164(a.owner.cell) ?? a.owner.cell, email: a.owner.email ?? null, canSetPrices: true, canApprove: true, canEditSettings: true, isOwner: true, isOnCall: true, summaryEmail: Boolean(a.owner.email) }).returning();
  await db.insert(schema.coverage).values([0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ memberId: owner.id, weekday })));
  if (a.voiceNumber) await db.insert(schema.lines).values({ customerId: c.id, kind: "voice", twilioNumber: toE164(a.voiceNumber)!, companyNumber: toE164(a.companyNumber) });
  if (a.textNumber) await db.insert(schema.lines).values({ customerId: c.id, kind: "text", twilioNumber: toE164(a.textNumber)! });
  await db.insert(schema.events).values({ customerId: c.id, type: "customer.created", payload: {} });
  return { customer: c, owner };
}

