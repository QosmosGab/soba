// Local only: creates "Demo Produce Co" in the PGlite database and fills it with the demo nights.
//   PGLITE_DIR=.pglite SOBA_DRY_RUN=1 npx tsx scripts/demo-local.ts
import { getDb, schema } from "../src/db";
import { provisionCustomer } from "../src/lib/provision";
import { seedDemo } from "../src/lib/demo";
import { eq } from "drizzle-orm";
async function main() {
  const db = await getDb();
  let [c] = await db.select().from(schema.customers).where(eq(schema.customers.name, "Demo Produce Co"));
  if (!c) c = (await provisionCustomer(db, { name: "Demo Produce Co", owner: { name: "Jimmy", cell: "+15205550111" }, voiceNumber: "+15205550290" })).customer;
  const r = await seedDemo(db, c.id);
  console.log("added", r.added, "panel /p/" + c.panelToken);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
