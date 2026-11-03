// Controls: tonight's prices (upload, read-back, editable rules), the three
// switches, and who gets requests by weekday.
import { and, eq, gt, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { panelCustomer } from "@/lib/auth";
import { toggleSwitch, updateRule, pauseAll, addRule, uploadSheet, answerSheet, toggleCoverage, setOnCall } from "../actions";

export default async function Controls({ searchParams }: { searchParams: Promise<{ sheet?: string }> }) {
  const customer = (await panelCustomer())!;
  const sp = await searchParams;
  const db = await getDb();
  const now = new Date();
  const [s] = await db.select().from(schema.settings).where(eq(schema.settings.customerId, customer.id));
  const rules = await db.select().from(schema.priceRules).where(and(eq(schema.priceRules.customerId, customer.id), gt(schema.priceRules.expiresAt, now))).orderBy(schema.priceRules.product, schema.priceRules.size);
  const members = await db.select().from(schema.teamMembers).where(and(eq(schema.teamMembers.customerId, customer.id), eq(schema.teamMembers.active, true)));
  const cov = members.length ? await db.select().from(schema.coverage).where(inArray(schema.coverage.memberId, members.map((m) => m.id))) : [];
  const pending = sp.sheet ? (await db.select().from(schema.priceSheets).where(and(eq(schema.priceSheets.id, sp.sheet), eq(schema.priceSheets.customerId, customer.id))))[0] : null;
  const lastSheet = rules[0]?.sheetId ? (await db.select().from(schema.priceSheets).where(eq(schema.priceSheets.id, rules[0].sheetId)))[0] : null;
  const paused = rules.length > 0 && rules.every((r) => !r.on);
  const tz = customer.timezone;
  const t = (x: Date) => x.toLocaleString("en-US", { timeZone: tz, weekday: "short", hour: "numeric", minute: "2-digit" }).replace(",", "");
  const source = lastSheet ? `Loaded ${lastSheet.receivedVia === "upload" ? "from an upload" : lastSheet.receivedVia === "whatsapp" ? "from a WhatsApp sheet" : "by command"} ${t(lastSheet.createdAt)}${lastSheet.confirmedById ? ` · confirmed by ${members.find((m) => m.id === lastSheet.confirmedById)?.name ?? "a rep"}` : ""}` : null;

  return (
    <div className="ctl">
      <section className="card">
        <div className="between"><h2>Tonight&apos;s prices</h2>{rules.length > 0 && <form action={pauseAll}><button className="btn ghost sm" name="op" value={paused ? "resume" : "pause"}>{paused ? "Resume all" : "Pause all"}</button></form>}</div>
        <p className="muted" style={{ margin: "6px 0 0" }}>Orders at or above these prices are confirmed on the spot, up to the cases you set. They stop when you open{rules[0] ? ` (${t(rules[0].expiresAt)})` : ""}.</p>
        {pending?.parsed ? (
          <div className="notice" style={{ marginTop: 14 }}>
            <div className="between"><b>We read {pending.parsed.length} price{pending.parsed.length === 1 ? "" : "s"}</b><span className="small">Check them before they go live tonight.</span></div>
            {pending.question && <p style={{ margin: "8px 0 0" }}>One question: {pending.question}</p>}
            <div className="tbl" style={{ marginTop: 8 }}><table><thead><tr><th>Product</th><th>Size</th><th>Pack</th><th className="r">Lowest</th><th className="r">Cases</th></tr></thead><tbody>
              {pending.parsed.map((r, i) => <tr key={i}><td>{r.product}</td><td>{r.size ?? ""}</td><td>{r.pack ?? ""}</td><td className="r">${r.minPrice.toFixed(2)}</td><td className="r">{r.caseLimit}</td></tr>)}
            </tbody></table></div>
            <div className="row" style={{ marginTop: 10, flexWrap: "wrap" }}>
              <form action={answerSheet}><input type="hidden" name="sheetId" value={pending.id} /><button className="btn green" name="answer" value="yes">Looks right, go live</button></form>
              <form action={answerSheet} className="row"><input type="hidden" name="sheetId" value={pending.id} /><input name="fix" placeholder="e.g. 4x4 should be 8.75, drop the Romas" style={{ minWidth: 260 }} /><button className="btn ghost">Fix</button></form>
              <form action={answerSheet}><input type="hidden" name="sheetId" value={pending.id} /><button className="btn ghost" name="answer" value="cancel">Drop it</button></form>
            </div>
          </div>
        ) : (
          <form action={uploadSheet} className="drop" encType="multipart/form-data">
            <div><b>Add tonight&apos;s price sheet</b><div className="hint">PDF or a photo, or paste the prices. Or send it to the desk on WhatsApp.</div></div>
            <div className="row" style={{ flexWrap: "wrap" }}><input type="file" name="sheet" accept="application/pdf,image/*" /><input name="text" placeholder="or type: 4x4 VR 8.50 600" style={{ minWidth: 200 }} /><button className="btn green" type="submit">Read it</button></div>
          </form>
        )}
        <div className="tbl"><table><thead><tr><th>Product</th><th>Size</th><th>Lowest price</th><th>Cases</th><th>Sold</th><th>On</th></tr></thead><tbody>
          {rules.map((r) => (
            <tr key={r.id}>
              <td><b>{r.product}</b><div className="hint">{r.pack ?? ""}</div></td><td>{r.size ?? ""}</td>
              <td><form action={updateRule} className="row"><input type="hidden" name="id" value={r.id} /><input className="num" name="minPrice" type="number" step="0.25" defaultValue={Number(r.minPrice)} aria-label="Lowest price" /><button className="btn ghost sm" type="submit">Save</button></form></td>
              <td><form action={updateRule} className="row"><input type="hidden" name="id" value={r.id} /><input className="num" name="caseLimit" type="number" step="50" defaultValue={r.caseLimit} aria-label="Cases" /><button className="btn ghost sm" type="submit">Save</button></form></td>
              <td style={{ whiteSpace: "nowrap" }}><span className="prog"><i style={{ width: `${Math.min(100, r.casesCleared / Math.max(1, r.caseLimit) * 100)}%` }} /></span>{r.casesCleared}</td>
              <td><form action={updateRule}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="op" value="toggle" /><button className="tog" role="switch" aria-checked={r.on} aria-label={`Auto-clear ${r.product}`} type="submit" /></form></td>
            </tr>
          ))}
          {rules.length === 0 && <tr><td colSpan={6} className="muted">No prices tonight. Every order goes to your team.</td></tr>}
        </tbody></table></div>
        <details style={{ marginTop: 12 }}><summary className="linklike small" style={{ cursor: "pointer" }}>Add one line by hand</summary>
          <form action={addRule} className="row" style={{ marginTop: 8, flexWrap: "wrap" }}><input name="product" placeholder="Vine-ripe tomatoes" required /><input name="size" placeholder="4x4" style={{ width: 70 }} /><input name="pack" placeholder="25 lb" style={{ width: 80 }} /><input className="num" name="minPrice" type="number" step="0.25" placeholder="8.50" required /><input className="num" name="caseLimit" type="number" step="50" placeholder="600" required /><button className="btn sm" type="submit">Go live</button></form>
        </details>
        {source && <p className="hint" style={{ margin: "12px 0 0" }}>{source}</p>}
      </section>
      <div className="stack">
        <section className="card"><h2>Switches</h2><div style={{ marginTop: 6 }}>
          {([["answering", "Answer calls after hours", "Turn off if your team is taking calls tonight"], ["autoClear", "Confirm orders at your prices", "Uses tonight's prices on the left"], ["daytimeOverflow", "Pick up missed calls during the day", `After ${s.ringCount} rings with no answer`]] as const).map(([k, label, hint]) => (
            <div key={k} className="sw"><div><b>{label}</b><span className="hint">{hint}</span></div><form action={toggleSwitch}><input type="hidden" name="key" value={k} /><button className="tog" role="switch" aria-checked={s[k]} aria-label={label} type="submit" /></form></div>
          ))}
        </div></section>
        <section className="card">
          <div className="between"><h2>Who gets requests</h2><form action={toggleSwitch} className="row small muted">Everyone <input type="hidden" name="key" value="everyoneGetsCards" /><button className="tog" role="switch" aria-checked={s.everyoneGetsCards} aria-label="Everyone gets requests" type="submit" /></form></div>
          <div className="tbl"><table className="grid7" style={{ marginTop: 8 }}><thead><tr><th></th>{["M", "T", "W", "T", "F", "S", "S"].map((d, i) => <th key={i}>{d}</th>)}</tr></thead><tbody>
            {members.map((m) => (
              <tr key={m.id}>
                <td style={{ whiteSpace: "nowrap" }}><b>{m.name}</b> {m.isOnCall ? <span className="oncall">On call</span> : <form action={setOnCall} className="inline"><input type="hidden" name="memberId" value={m.id} /><button className="setoncall" type="submit">set on call</button></form>}</td>
                {[0, 1, 2, 3, 4, 5, 6].map((wd) => { const onDay = s.everyoneGetsCards || cov.some((c) => c.memberId === m.id && c.weekday === wd); return <td key={wd}><form action={toggleCoverage} className="inline"><input type="hidden" name="memberId" value={m.id} /><input type="hidden" name="weekday" value={wd} /><button className="day" aria-pressed={onDay} disabled={s.everyoneGetsCards} type="submit" aria-label={`${m.name} day ${wd + 1}`}>{onDay ? "✓" : "–"}</button></form></td>; })}
              </tr>
            ))}
            {members.length === 0 && <tr><td colSpan={8} className="muted">Add your team in Settings.</td></tr>}
          </tbody></table></div>
          <p className="hint" style={{ margin: "10px 0 0" }}>Reps scheduled that day get the card; the on-call rep always does, and is phoned for urgent requests.</p>
        </section>
      </div>
    </div>
  );
}
