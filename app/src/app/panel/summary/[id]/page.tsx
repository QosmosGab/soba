// The web version of a morning summary (linked from WhatsApp), with the night's transcripts.
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq, gte, lt } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { panelCustomer } from "@/lib/auth";
import { buildSummary } from "@/lib/summary";

const $ = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

export default async function SummaryPage({ params }: { params: Promise<{ id: string }> }) {
  const customer = (await panelCustomer())!;
  const { id } = await params;
  const db = await getDb();
  const [row] = await db.select().from(schema.summaries).where(and(eq(schema.summaries.id, id), eq(schema.summaries.customerId, customer.id)));
  if (!row) notFound();
  const s = await buildSummary(db, customer.id, row.windowStart, row.windowEnd, row.windowEnd);
  const reqs = await db.select().from(schema.requests).where(and(eq(schema.requests.customerId, customer.id), gte(schema.requests.receivedAt, row.windowStart), lt(schema.requests.receivedAt, row.windowEnd))).orderBy(schema.requests.receivedAt);
  const tz = customer.timezone;
  const t = (x: Date) => x.toLocaleString("en-US", { timeZone: tz, weekday: "short", hour: "numeric", minute: "2-digit" }).replace(",", "");
  return (
    <>
      <section className="hero"><div>
        <div className="muted small">{t(s.windowStart)} to {t(s.windowEnd)}</div>
        <div className="big">{$(s.won)}</div>
        <div style={{ color: "var(--accent-deep)", marginTop: 8 }}>won overnight · {s.wonCount} order{s.wonCount === 1 ? "" : "s"} · this week {$(s.weekTotal)} from {s.weekOrders}</div>
      </div></section>
      <section className="card"><h2>Overnight orders</h2>
        <div className="tbl"><table><thead><tr><th>Buyer</th><th>Product</th><th className="r">Cases</th><th className="r">Price</th><th className="r">Amount</th><th className="r">Status</th></tr></thead><tbody>
          {s.orders.map((o) => <tr key={o.ref}><td><b>{o.buyer}</b>{o.city ? <span className="dim"> · {o.city}</span> : null}</td><td>{o.item}</td><td className="r">{o.cases ?? ""}</td><td className="r">{o.price != null ? `$${o.price.toFixed(2)}` : ""}</td><td className={"r " + (o.status === "in_progress" || o.status === "rejected" ? "dim" : "amt")}>{$(o.amount)}</td><td className="r">{o.statusLabel}{o.entered ? " · entered" : ""}</td></tr>)}
          {s.orders.length === 0 && <tr><td colSpan={6} className="muted">A quiet night.</td></tr>}
        </tbody></table></div>
      </section>
      {s.rules.length > 0 && <section className="card"><h2>Sold at the prices you set</h2>{s.rules.map((r) => <div key={r.label} className="item"><div><b>{r.label}</b><span className="hint">at ${r.price.toFixed(2)} or more</span></div><div><span className="prog"><i style={{ width: `${Math.min(100, r.cleared / Math.max(1, r.limit) * 100)}%` }} /></span>{r.cleared} of {r.limit} cases</div></div>)}</section>}
      {s.nonOrders.length > 0 && <section className="card"><h2>Also overnight</h2><p className="muted">{s.nonOrders.map((n) => `${n.count} ${n.type}`).join(", ")}.</p></section>}
      <section className="card"><h2>Calls and messages</h2>
        {reqs.map((r) => <div key={r.id} style={{ marginTop: 12 }}><div className="between"><b><Link href={`/panel/requests/${r.id}`}>Ref {r.ref} · {r.callerName ?? r.callerCompany ?? "Unknown"}</Link></b><span className="muted small">{t(r.receivedAt)}</span></div><div className="tr transcript" style={{ marginTop: 6 }}>{r.transcript ?? r.summary}</div></div>)}
        {reqs.length === 0 && <p className="muted">No calls or texts overnight.</p>}
      </section>
    </>
  );
}
