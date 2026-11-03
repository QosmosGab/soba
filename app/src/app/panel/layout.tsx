import { Clover } from "@/components/clover";
import Link from "next/link";
import { redirect } from "next/navigation";
import { eq, and } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { panelCustomer } from "@/lib/auth";
import { Tabs } from "./tabs";

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
        <Link href="/panel" className="brand" style={{ textDecoration: "none" }}><span className="mark"><Clover /></span>soba <span className="co">{customer.name}</span></Link>
        <Tabs />
        <div className="grow" />
        <span className={"pillstat" + (answering ? "" : " off")}><span className="dot" />{answering ? (linesOk ? "Answering · lines working" : "Answering · forwarding check failed") : "Paused tonight"}</span>
      </div></header>
      <main className="page">{children}</main>
    </>
  );
}
