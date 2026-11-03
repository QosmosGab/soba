// One Drizzle client. With DATABASE_URL set (Vercel, Neon, any Postgres) it uses
// postgres-js; without it (local dev, tests) it boots PGlite, an embedded Postgres,
// and applies the generated migrations so the schema is always current.
import * as schema from "./schema";
import type { PgDatabase } from "drizzle-orm/pg-core";

export type Db = PgDatabase<any, typeof schema>;

// One client per process, kept on globalThis so every bundle Next builds (pages, route
// handlers, server actions) shares the same embedded database.
const g = globalThis as unknown as { __sobaDb?: Db; __sobaDbPromise?: Promise<Db> };

export async function getDb(): Promise<Db> {
  if (g.__sobaDb) return g.__sobaDb;
  if (g.__sobaDbPromise) return g.__sobaDbPromise;
  g.__sobaDbPromise = openDb().then((db) => { g.__sobaDb = db; return db; });
  return g.__sobaDbPromise;
}

async function openDb(): Promise<Db> {
  if (process.env.DATABASE_URL) {
    const { drizzle } = await import("drizzle-orm/postgres-js");
    const postgres = (await import("postgres")).default;
    return drizzle(postgres(process.env.DATABASE_URL, { prepare: false }), { schema }) as unknown as Db;
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const dataDir = process.env.PGLITE_DIR; // undefined = in-memory (tests)
  const client = dataDir ? new PGlite(dataDir) : new PGlite();
  const db = drizzle(client, { schema });
  // Resolved from the working directory (app/) so Turbopack does not treat it as an asset import.
  const path = await import("node:path");
  await migrate(db, { migrationsFolder: process.env.SOBA_MIGRATIONS_DIR ?? path.join(process.cwd(), "drizzle") });
  return db as unknown as Db;
}

/** Tests: drop the cached client so each file gets a fresh in-memory database. */
export function resetDbForTests() { g.__sobaDb = undefined; g.__sobaDbPromise = undefined; }

export { schema };
