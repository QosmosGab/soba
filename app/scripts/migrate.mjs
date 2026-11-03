// Applies the SQL migrations in drizzle/ to DATABASE_URL before `next build` on Vercel.
// Without DATABASE_URL (local dev, tests) there is nothing to do: PGlite migrates itself on open.
import { spawnSync } from "node:child_process";
if (!process.env.DATABASE_URL) { console.log("migrate: no DATABASE_URL, skipping"); process.exit(0); }
const r = spawnSync("npx", ["drizzle-kit", "migrate"], { stdio: "inherit", env: process.env });
process.exit(r.status ?? 1);
