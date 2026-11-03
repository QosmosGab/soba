// One Drizzle client. With DATABASE_URL set (Vercel, Neon, any Postgres) it uses
// postgres-js; without it (local dev, tests) it boots PGlite, an embedded Postgres,
// and applies the generated migrations so the schema is always current.
import * as schema from "./schema";
import type { PgDatabase } from "drizzle-orm/pg-core";

export type Db = PgDatabase<any, typeof schema>;

let _db: Db | undefined;

export async function getDb(): Promise<Db> {
  if (_db) return _db;
  if (process.env.DATABASE_URL) {
    const { drizzle } = await import("drizzle-orm/postgres-js");
    const postgres = (await import("postgres")).default;
    _db = drizzle(postgres(process.env.DATABASE_URL, { prepare: false }), { schema }) as unknown as Db;
    return _db;
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const dataDir = process.env.PGLITE_DIR; // undefined = in-memory (tests)
  const client = dataDir ? new PGlite(dataDir) : new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: new URL("../../drizzle", import.meta.url).pathname });
  _db = db as unknown as Db;
  return _db;
}

/** Tests: drop the cached client so each file gets a fresh in-memory database. */
export function resetDbForTests() { _db = undefined; }

export { schema };
