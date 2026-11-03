// Performance (home): the revenue band, the funnel, the requests list, top
// buyers, and the needs-attention strip when something is wrong.
import Link from "next/link";
import { getDb } from "@/db";
import { panelCustomer } from "@/lib/auth";
import { performance, statusClass } from "@/lib/panel-data";

const $ = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const STATUS = [["all", "All"], ["auto_cleared", "Auto-cleared"], ["approved", "Approved"], ["in_progress", "In progress"], ["rejected", "Rejected"]] as const;

export default async function Performance({ searchParams }: { searchParams: Promise<{ range?: string; status?: string; all?: string }> }) {
  const customer = (await panelCustomer())!;
  const sp = await searchParams;
  const range = sp.range === "month" ? "month" : "week";
  const filter = sp.status ?? "all";
  const db = await getDb();
  const p = await performance(db, customer.id, customer.timezone, range, new Date());
  const list = p.rows.filter((r) => filter === "all" || r.status === filter);
  const visible = sp.all ? list : list.slice(0, 8);
  const max = Math.max(...p.series, 1);
  const q = (over: Record<string, string | undefined>) => { const u = new URLSearchParams(); for (const [k, v] of Object.entries({ range, status: filter, ...over })) if (v && v !== "all" && !(k === "range" && v === "week")) u.set(k, v); const s = u.toString(); return s ? `?${s}` : "/panel"; };
  const csv = ["ref,buyer,city,order,cases,price,amount,status", ...p.rows.map((r) => [r.ref, r.buyer, r.city ?? "", r.item.replace(/,/g, " "), r.cases ?? "", r.price?.toFixed(2) ?? "", r.amount.toFixed(0), r.statusLabel].join(","))].join("\n");

  return (
    <>
      {(p.attention.waiting > 0 || p.attention.forwardingBroken) && (
        <div className="alert">
          <span>{p.attention.forwardingBroken ? "Forwarding check failed: after-hours calls may not reach the desk. " : ""}{p.attention.waiting > 0 ? `${p.attention.waiting} request${p.attention.waiting > 1 ? "s" : ""} still waiting on your team` : ""}</span>
          {p.attention.waiting > 0 ? <Link className="btn sm" href={q({ status: "in_progress" })}>Show them</Link> : <Link className="btn sm" href="/panel/settings?s=lines">Check the line</Link>}
        </div>
      )}
      <section className="hero">
        <div>
          <div className="seg" role="group" aria-label="Range"><Link href={q({ range: "week" })} aria-pressed={range === "week"} role="button" style={{ textDecoration: "none" }}>This week</Link><Link href={q({ range: "month" })} aria-pressed={range === "month"} role="button" style={{ textDecoration: "none" }}>This month</Link></div>
          <div className="big">{$(p.booked)}</div>
          <div className="sub" style={{ marginTop: 8 }}>booked through Soba · {p.orders} order{p.orders === 1 ? "" : "s"}</div>
          <div className="split"><div><b>{$(p.recovered)}</b>closed by the desk</div><div><b>{$(p.assisted)}</b>won after a rep took over</div></div>
        </div>
        <div>
          <div className="bars">{p.series.map((v, i) => <div key={i} className={"bar" + (v ? "" : " zero")} style={{ height: v ? Math.max(10, v / max * 100) + "px" : "6px" }} title={$(v)} />)}</div>
          <div className="barlbl">{p.labels.map((l) => <span key={l}>{l}</span>)}</div>
        </div>
      </section>
      <section className="funnel" aria-label="Funnel">
        <div className="step"><b>{p.funnel.handled}</b><span>calls and texts answered</span></div>
        <div className="step"><b>{p.funnel.real}</b><span>real order requests</span></div>
        <div className="step"><b>{p.funnel.decided}</b><span>decided</span></div>
        <div className="step"><b>{p.funnel.confirmed}</b><span>orders confirmed</span></div>
        <div className="step win"><b>{$(p.funnel.booked)}</b><span>booked {range === "week" ? "this week" : "this month"}</span></div>
      </section>
      <section className="cols">
        <div className="card">
          <div className="between"><h2>Requests</h2><details><summary className="btn ghost sm" style={{ listStyle: "none" }}>Export</summary><textarea readOnly rows={6} value={csv} style={{ marginTop: 8, fontFamily: "ui-monospace,monospace", fontSize: 12, width: "100%" }} /></details></div>
          <div className="chips" role="group" aria-label="Filter">{STATUS.map(([k, l]) => <Link key={k} href={q({ status: k })} className="chip" aria-pressed={filter === k} style={{ textDecoration: "none" }}>{l} {p.counts[k]}</Link>)}</div>
          <div className="tbl"><table><thead><tr><th>When</th><th>Buyer</th><th>Order</th><th className="r">Amount</th><th className="r">Status</th></tr></thead><tbody>
            {visible.map((r) => (
              <tr key={r.id} className="click">
                <td className="dim small" style={{ whiteSpace: "nowrap" }}><Link href={`/panel/requests/${r.id}`} style={{ textDecoration: "none" }}>{r.when}</Link></td>
                <td><Link href={`/panel/requests/${r.id}`} style={{ textDecoration: "none" }}><b>{r.buyer}</b>{r.city ? <span className="dim"> · {r.city}</span> : null}{r.isNew ? <span className="newtag">New</span> : null}</Link></td>
                <td style={{ minWidth: 190 }}>{r.item}{r.flags.includes("urgent") ? <span className="oncall" style={{ marginLeft: 6 }}>URGENT</span> : null}</td>
                <td className={"r " + (r.status === "auto_cleared" || r.status === "approved" ? "amt" : "dim")}>{r.amount ? $(r.amount) : ""}</td>
                <td className="r"><span className={"st " + statusClass(r.status)}>{r.takenOver ? `${r.takenOver} took over` : r.statusLabel}</span></td>
              </tr>
            ))}
            {visible.length === 0 && <tr><td colSpan={5} className="muted">Nothing here yet.</td></tr>}
          </tbody></table></div>
          {list.length > 8 && !sp.all && <div style={{ marginTop: 12 }}><Link className="btn ghost sm" href={q({ all: "1" })}>See all {list.length}</Link></div>}
        </div>
        <div className="card"><h2>Top buyers {range === "week" ? "this week" : "this month"}</h2><div style={{ marginTop: 8 }}>
          {p.topBuyers.map((b) => <div key={b.buyer} className="buyer"><div><b>{b.buyer}</b>{b.isNew && <span className="newtag">New</span>}<div className="muted small">{b.city ?? ""}{b.city ? " · " : ""}{b.n} order{b.n > 1 ? "s" : ""}</div></div><div className="amt">{$(b.sum)}</div></div>)}
          {p.topBuyers.length === 0 && <p className="muted small">No orders yet.</p>}
        </div></div>
      </section>
    </>
  );
}
