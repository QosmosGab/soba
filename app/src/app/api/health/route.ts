import { getDb, schema } from "@/db";
import { sql } from "drizzle-orm";

export async function GET() {
  const db = await getDb();
  const [row] = await db.select({ n: sql<number>`count(*)` }).from(schema.customers);
  return Response.json({ ok: true, customers: Number(row.n), at: new Date().toISOString() });
}
