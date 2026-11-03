import { Clover } from "@/components/clover";
import Link from "next/link";
import { redirect } from "next/navigation";
import { eq, and } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { panelCustomer } from "@/lib/auth";
import { Tabs } from "./tabs";
import { Status } from "./status";
import { signOut } from "./actions";

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const customer = await panelCustomer();
  if (!customer) redirect("/");
  const db = await getDb();
  const [settings] = await db.select().from(schema.settings).where(eq(schema.settings.customerId, customer.id));
  const [voice] = await db.select().from(schema.lines).where(and(eq(schema.lines.customerId, customer.id), eq(schema.lines.kind, "voice")));
  const answering = settings?.answering ?? false;
  const linesOk = voice?.lastForwardingTestOk !== false;
  return (
    <>
      <header className="top"><div className="top-in">
        <Link href="/panel" className="brand" style={{ textDecoration: "none" }}><span className="mark"><Clover /></span>soba</Link>
        <Tabs />
        <div className="grow" />
        <Status live={answering} linesOk={linesOk} />
        <div className="who">
          <span className="who-name">{customer.name}</span>
          <form action={signOut}><button className="btn ghost sm" type="submit">Sign out</button></form>
        </div>
      </div></header>
      <main className="page">{children}</main>
    </>
  );
}
