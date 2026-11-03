import { getDb, schema } from "@/db";
import { sql } from "drizzle-orm";
import { env } from "@/lib/env";

export async function GET() {
  const db = await getDb();
  const [row] = await db.select({ n: sql<number>`count(*)` }).from(schema.customers);
  const missing = env.missing();
  return Response.json({ ok: missing.length === 0 || env.dryRun, customers: Number(row.n), missing, at: new Date().toISOString() });
}
