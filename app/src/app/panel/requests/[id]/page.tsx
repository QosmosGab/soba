// One request: contact, order fields, the call notes or messages, history, and
// for open requests the same four options a rep has on WhatsApp.
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { panelCustomer } from "@/lib/auth";
import { requestDetail, statusClass, statusLabel } from "@/lib/panel-data";
import { decide } from "../../actions";

const $ = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const $2 = (n: number | string | null) => n == null ? "" : `$${Number(n).toFixed(2)}`;

export default async function RequestPage({ params }: { params: Promise<{ id: string }> }) {
  const customer = (await panelCustomer())!;
  const { id } = await params;
  const d = await requestDetail(await getDb(), customer.id, id);
  if (!d) notFound();
  const { request: r, lines, buyer, events, messages, decisions, members } = d;
  const tz = customer.timezone;
  const t = (x: Date) => x.toLocaleString("en-US", { timeZone: tz, weekday: "short", hour: "numeric", minute: "2-digit" }).replace(",", "");
  const name = (mid: string | null) => members.find((m) => m.id === mid)?.name ?? "a rep";
  const open = r.status === "in_progress";
  const takeover = decisions.filter((x) => x.action === "take_over").pop();
  const pendingUndo = decisions.filter((x) => !x.undone && x.undoDeadline && x.undoDeadline > new Date()).pop();
  const transcript = r.transcript ?? messages.filter((m) => m.channel !== "whatsapp" && m.party !== "rep").map((m) => `${m.party === "desk" ? "Desk" : "Buyer"}: ${m.body ?? ""}`).join("\n");
  const won = r.status === "auto_cleared" || r.status === "approved";

  return (
    <section className="cols" style={{ gridTemplateColumns: "minmax(0,3fr) minmax(0,2fr)" }}>
      <div className="card">
        <div className="between"><div><div className="muted small"><Link href="/panel">← Requests</Link> · Request #{r.ref} · {r.channel === "call" ? "Call" : "Text"} · {t(r.receivedAt)}</div><h2 style={{ margin: "4px 0 0", fontSize: 19 }}>{buyer?.company ?? r.callerCompany ?? r.callerName ?? "Unknown buyer"}{buyer?.city ? ` · ${buyer.city}` : ""}</h2></div>
          <span className={"st " + statusClass(r.status)}>{takeover && open ? `${name(takeover.memberId)} took over` : statusLabel(r, name(r.decidedById))}</span></div>
        {r.flags.length > 0 && <div className="chips">{r.flags.map((f) => <span key={f} className="chip">{f.replace(/_/g, " ")}</span>)}</div>}
        <div className="kv" style={{ marginTop: 12 }}>
          <span>Contact</span><div>{[r.callerName ?? buyer?.contactName, r.callbackNumber].filter(Boolean).join(" · ") || "not captured"}</div>
          {lines.map((l, i) => (<FragmentLine key={l.id} idx={lines.length > 1 ? i + 1 : null} l={l} won={won} />))}
          {lines.length === 0 && <><span>Summary</span><div>{r.summary}</div></>}
          {d.amount > 0 && <><span>Amount</span><div><b>{$(d.amount)}</b></div></>}
          {r.callbackPermission != null && <><span>Callback</span><div>{r.callbackPermission ? "Buyer agreed to a call or text back" : "Buyer declined callbacks"}</div></>}
        </div>
        <div style={{ marginTop: 16 }}><div className="small muted" style={{ fontWeight: 600, marginBottom: 6 }}>{r.channel === "call" ? "Call notes" : "Messages"}</div><div className="tr transcript">{transcript || "No notes captured."}</div></div>

        {open && !takeover && (
          <div className="stack" style={{ gap: 8, marginTop: 18 }}>
            <div className="small muted" style={{ fontWeight: 600 }}>Decide</div>
            {pendingUndo ? (
              <form action={decide} className="notice between"><span>{pendingUndo.action === "approve" ? "Approved" : pendingUndo.action === "counter" ? `Countered at ${$2(pendingUndo.counterPrice)}` : "Rejected"}; the desk acts at {t(pendingUndo.undoDeadline!)}.</span><input type="hidden" name="requestId" value={r.id} /><button className="btn sm" name="action" value="undo">Undo</button></form>
            ) : (
              <>
                <div className="acts">
                  <form action={decide}><input type="hidden" name="requestId" value={r.id} />{lines[0]?.cases != null && <label className="hint" style={{ display: "block", marginBottom: 6 }}>Cases <input className="num" type="number" name="cases" min={1} max={lines[0].cases} defaultValue={lines[0].cases} /></label>}<button className="btn green" name="action" value="approve" style={{ width: "100%" }}>Approve</button></form>
                  <form action={decide}><input type="hidden" name="requestId" value={r.id} /><label className="hint" style={{ display: "block", marginBottom: 6 }}>Final price <input className="num" name="price" placeholder="8.50" required /></label><button className="btn ghost" name="action" value="counter" style={{ width: "100%" }}>Counter</button></form>
                  <form action={decide}><input type="hidden" name="requestId" value={r.id} /><button className="btn ghost" name="action" value="take_over" style={{ width: "100%" }}>Take over</button></form>
                  <form action={decide}><input type="hidden" name="requestId" value={r.id} /><label className="hint" style={{ display: "block", marginBottom: 6 }}>Reason (optional) <input name="reason" placeholder="we're short" style={{ width: "100%" }} /></label><button className="btn danger" name="action" value="reject" style={{ width: "100%" }}>Reject</button></form>
                </div>
                <p className="hint" style={{ margin: 0 }}>Approve calls or texts the buyer to confirm; Counter offers your price once. Both wait the undo window first.</p>
              </>
            )}
          </div>
        )}
        {open && takeover && (
          <div className="stack" style={{ gap: 8, marginTop: 18 }}><div className="small muted">{name(takeover.memberId)} has the buyer's details. How did it go?</div>
            <div className="acts"><form action={decide}><input type="hidden" name="requestId" value={r.id} /><button className="btn green" name="action" value="won" style={{ width: "100%" }}>Won</button></form><form action={decide}><input type="hidden" name="requestId" value={r.id} /><button className="btn ghost" name="action" value="lost" style={{ width: "100%" }}>Lost</button></form></div></div>
        )}
        {won && (
          <form action={decide} style={{ marginTop: 16 }} className="between"><span className="small muted">{r.enteredAt ? `Entered in your system ${t(r.enteredAt)}` : "Not yet entered in your order system"}</span><input type="hidden" name="requestId" value={r.id} />{!r.enteredAt && <button className="btn ghost sm" name="action" value="entered">Mark entered</button>}</form>
        )}
      </div>
      <div className="card">
        <h2>History</h2>
        <div className="tl" style={{ marginTop: 10 }}>
          {events.map((e) => <div key={e.id}><em>{t(e.at)}</em><span>{describe(e.type, e.payload, name)}</span></div>)}
        </div>
        {messages.filter((m) => m.party === "rep").length > 0 && (
          <><h2 style={{ marginTop: 18 }}>Team messages</h2><div className="tl" style={{ marginTop: 10 }}>
            {messages.filter((m) => m.party === "rep").map((m) => <div key={m.id}><em>{t(m.sentAt)}</em><span><b>{m.direction === "in" ? name(m.memberId) : `to ${name(m.memberId)}`}:</b> {(m.body ?? "").split("\n")[0]}</span></div>)}
          </div></>
        )}
      </div>
    </section>
  );
}

function FragmentLine({ idx, l, won }: { idx: number | null; l: { product: string; size: string | null; pack: string | null; cases: number | null; priceOffered: string | null; finalPrice: string | null; pickupDate: string | null; fulfillment: string | null; destination: string | null; poNumber: string | null; notOnSheet: boolean }; won: boolean }) {
  const pickup = l.pickupDate ? new Date(l.pickupDate + "T12:00:00Z").toLocaleString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" }) : "not set";
  return (
    <>
      {idx && <><span style={{ fontWeight: 700 }}>Line {idx}</span><div /></>}
      <span>Product</span><div>{l.product}{l.notOnSheet ? <span className="oncall" style={{ marginLeft: 6 }}>not on sheet</span> : null}</div>
      {l.size && <><span>Size</span><div>{l.size}</div></>}
      {l.pack && <><span>Pack</span><div>{l.pack}</div></>}
      <span>Quantity</span><div>{l.cases != null ? `${l.cases} cases` : "not given"}</div>
      <span>Price</span><div>{won && l.finalPrice ? `${$2(l.finalPrice)} a case` : l.priceOffered ? `offers ${$2(l.priceOffered)} a case` : "wants a quote"}</div>
      <span>Pickup</span><div>{pickup}{l.fulfillment === "delivered" ? ` · delivered${l.destination ? ` to ${l.destination}` : ""}` : l.fulfillment === "collect" ? " · buyer's truck" : ""}</div>
      {l.poNumber && <><span>PO</span><div>{l.poNumber}</div></>}
    </>
  );
}

function describe(type: string, p: Record<string, unknown>, name: (id: string | null) => string): string {
  const by = typeof p.by === "string" ? name(p.by) : null;
  switch (type) {
    case "request.created": return `${p.channel === "call" ? "Call answered by the desk" : "Text received on the order line"}`;
    case "request.repeat_contact": return "Buyer contacted again; told it's with the team";
    case "autoclear.cleared": return "Cleared at tonight's price";
    case "autoclear.declined": return `Not auto-cleared: ${p.reason}`;
    case "card.sent": return `Card sent to ${(p.recipients as string[])?.length ?? 0} rep${(p.recipients as string[])?.length === 1 ? "" : "s"}`;
    case "card.urgent_ring": return "On-call rep phoned (urgent)";
    case "card.reminder.oncall": return "Reminder sent to the on-call rep";
    case "card.reminder.owner": return "Reminder sent to the owner at opening";
    case "decision.approve": return `${by} approved${p.cases ? ` ${p.cases} cases` : ""}`;
    case "decision.counter": return `${by} countered at $${Number(p.price).toFixed(2)}${p.cases ? ` for up to ${p.cases}` : ""}`;
    case "decision.reject": return `${by} rejected${p.reason ? ` (${p.reason})` : ""}`;
    case "decision.take_over": return `${by} took it over`;
    case "decision.undone": return `${by} undid the last decision`;
    case "rep.acknowledged": return `${by}: "${p.text}"`;
    case "callback.placed": return `Desk called the buyer (${p.intent})`;
    case "callback.declined": return "Buyer declined on the callback";
    case "callback.changed": return `Buyer changed the order: ${p.details ?? ""}`;
    case "callback.no_answer": return "No answer on the callback; offer sent in writing";
    case "callback.bought_elsewhere": return `Buyer bought elsewhere${p.competitor ? ` (${p.competitor})` : ""}`;
    case "deal.confirmed": return `Confirmed ${p.source === "auto" ? "at tonight's price" : `after ${by ?? "a rep"} ${p.source === "counter" ? "countered" : "approved"}`}; confirmation sent, order card sent`;
    case "request.rejected": return "Buyer told the order can't be filled";
    case "takeover.won": return `${by} won it`;
    case "takeover.lost": return `${by} marked it lost`;
    default: return type.replace(/[._]/g, " ");
  }
}
