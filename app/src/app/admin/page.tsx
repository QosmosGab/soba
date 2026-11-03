// Internal admin: onboard a customer (settings, lines, first rep), hand out the
// panel link, pause or go live. Gated by ADMIN_TOKEN (?key=… once, then a cookie).
import { Clover } from "@/components/clover";
import { redirect } from "next/navigation";
import { desc } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { isAdmin } from "@/lib/auth";
import { env } from "@/lib/env";
import { createCustomer, setStatus, rotateToken, addLine, addDemoData } from "./actions";

export default async function Admin({ searchParams }: { searchParams: Promise<{ key?: string }> }) {
  const { key } = await searchParams;
  if (key) redirect(`/admin/login?key=${encodeURIComponent(key)}`);
  if (!(await isAdmin())) return <main className="login"><div className="card"><h2>Soba admin</h2><p className="muted">Open /admin?key=&lt;ADMIN_TOKEN&gt; to sign in.</p></div></main>;
  const db = await getDb();
  const customers = await db.select().from(schema.customers).orderBy(desc(schema.customers.createdAt));
  const lines = await db.select().from(schema.lines);
  const members = await db.select().from(schema.teamMembers);
  const counts = await db.select({ customerId: schema.requests.customerId, ref: schema.requests.ref }).from(schema.requests);
  return (
    <>
      <header className="top"><div className="top-in"><div className="brand"><span className="mark"><Clover /></span>soba <span className="co">admin</span></div></div></header>
      <main className="page">
        <section className="card"><h2>Customers</h2>
          <div className="tbl"><table><thead><tr><th>Customer</th><th>Status</th><th>Lines</th><th>Team</th><th>Requests</th><th>Panel link</th><th></th></tr></thead><tbody>
            {customers.map((c) => (
              <tr key={c.id}>
                <td><b>{c.name}</b><div className="hint">{c.timezone} · {c.plan}</div></td>
                <td><span className={"st " + (c.status === "live" ? "approved" : c.status === "paused" ? "rejected" : "progress")}>{c.status}</span></td>
                <td className="small">{lines.filter((l) => l.customerId === c.id).map((l) => <div key={l.id}>{l.kind}: {l.twilioNumber}{l.companyNumber ? ` ← ${l.companyNumber}` : ""}</div>)}
                  <form action={addLine} className="row" style={{ marginTop: 6, flexWrap: "wrap" }}><input type="hidden" name="customerId" value={c.id} /><select name="kind" defaultValue="voice"><option value="voice">voice</option><option value="text">text</option></select><input name="twilioNumber" placeholder="+1520…" style={{ width: 130 }} required /><input name="companyNumber" placeholder="company # (voice)" style={{ width: 140 }} /><input name="elevenAgentId" placeholder="agent id" style={{ width: 110 }} /><input name="elevenPhoneNumberId" placeholder="phone id" style={{ width: 110 }} /><button className="btn ghost sm">Add line</button></form></td>
                <td className="small">{members.filter((m) => m.customerId === c.id).map((m) => <div key={m.id}>{m.name} {m.cell}{m.whatsappOptedIn ? " ✓" : ""}</div>)}</td>
                <td>{counts.filter((r) => r.customerId === c.id).length}</td>
                <td className="small">{c.panelToken ? <code>{env.appUrl}/p/{c.panelToken}</code> : "none"}<form action={rotateToken} style={{ marginTop: 4 }}><input type="hidden" name="customerId" value={c.id} /><button className="btn ghost sm">New link</button></form></td>
                <td><div className="row" style={{ flexWrap: "wrap" }}><form action={setStatus}><input type="hidden" name="customerId" value={c.id} /><button className="btn sm" name="status" value={c.status === "live" ? "paused" : "live"}>{c.status === "live" ? "Pause" : "Go live"}</button></form><form action={addDemoData}><input type="hidden" name="customerId" value={c.id} /><button className="btn ghost sm" title="Two nights of made-up traffic so the panel can be shown; does nothing twice">Add demo data</button></form></div></td>
              </tr>
            ))}
          </tbody></table></div>
        </section>
        <section className="card"><h2>New customer</h2>
          <form action={createCustomer} className="stack" style={{ gap: 10, marginTop: 8 }}>
            <div className="row" style={{ flexWrap: "wrap" }}><input name="name" placeholder="Company name the desk uses" required style={{ minWidth: 260 }} /><select name="timezone" defaultValue="America/Phoenix"><option value="America/Phoenix">Arizona</option><option value="America/Los_Angeles">Pacific</option><option value="America/Denver">Mountain</option><option value="America/Chicago">Central</option><option value="America/New_York">Eastern</option></select></div>
            <div className="row" style={{ flexWrap: "wrap" }}><input name="ownerName" placeholder="Sales manager name" required /><input name="ownerCell" placeholder="Their WhatsApp number" required /><input name="ownerEmail" placeholder="Their email" /></div>
            <div className="row" style={{ flexWrap: "wrap" }}><input name="voiceNumber" placeholder="Our Twilio voice number" /><input name="companyNumber" placeholder="Their company line" /><input name="textNumber" placeholder="Our Twilio text number" /></div>
            <div><button className="btn green">Create</button> <span className="hint">Creates default settings (Mon–Fri 6–5, auto-clear on), the lines, the owner as a rep who sets prices, and a panel link.</span></div>
          </form>
        </section>
      </main>
    </>
  );
}
