// Settings: left-hand sections, each a plain form. A setup banner stays until
// the five first-login steps are done.
import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { panelCustomer } from "@/lib/auth";
import { DAY_KEYS } from "@/lib/hours";
import { fillConfirmation } from "@/lib/callbacks";
import { saveCompany, addMember, toggleMember, saveHours, saveVoice, saveCallbacks, saveSummary, sendTestSummary, saveLines, testForwarding } from "../actions";

const SECTIONS = [["company", "Company and team"], ["lines", "Phone and text lines"], ["hours", "Hours"], ["voice", "How the desk talks"], ["callbacks", "Callbacks and confirmations"], ["summary", "Morning summary"], ["compliance", "Compliance and billing"], ["tests", "Test calls"]] as const;
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const TZ = [["America/Phoenix", "Arizona (no daylight saving)"], ["America/Los_Angeles", "Pacific"], ["America/Denver", "Mountain"], ["America/Chicago", "Central"], ["America/New_York", "Eastern"]];

function Toggle({ action, hidden, on, label }: { action: (f: FormData) => Promise<void>; hidden: Record<string, string>; on: boolean; label: string }) {
  return <form action={action} className="inline">{Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}<button className="tog" role="switch" aria-checked={on} aria-label={label} type="submit" /></form>;
}

export default async function Settings({ searchParams }: { searchParams: Promise<{ s?: string }> }) {
  const customer = (await panelCustomer())!;
  const sec = (await searchParams).s ?? "company";
  const db = await getDb();
  const [s] = await db.select().from(schema.settings).where(eq(schema.settings.customerId, customer.id));
  const members = await db.select().from(schema.teamMembers).where(and(eq(schema.teamMembers.customerId, customer.id), eq(schema.teamMembers.active, true)));
  const [voice] = await db.select().from(schema.lines).where(and(eq(schema.lines.customerId, customer.id), eq(schema.lines.kind, "voice")));
  const [text] = await db.select().from(schema.lines).where(and(eq(schema.lines.customerId, customer.id), eq(schema.lines.kind, "text")));
  const rules = await db.select().from(schema.priceRules).where(eq(schema.priceRules.customerId, customer.id));
  const tz = customer.timezone;
  const t = (x: Date | null) => x ? x.toLocaleString("en-US", { timeZone: tz, weekday: "short", hour: "numeric", minute: "2-digit" }).replace(",", "") : "never";
  const setup = [Boolean(customer.name), members.length > 0, voice?.lastForwardingTestOk === true, Boolean(s.hours), rules.length > 0];
  const done = setup.filter(Boolean).length;
  const fmt = (n: string | null) => n ? n.replace(/^\+1(\d{3})(\d{3})(\d{4})$/, "($1) $2-$3") : "not set";
  const preview = fillConfirmation(s.confirmationTemplate, { company: customer.name, cases: 300, product: "4x4 vine-ripes", price: 8.5, pickup: "Mon", ref: 1047 });

  return (
    <>
      {done < 5 && (
        <div className="setup"><div><b style={{ color: "var(--accent-deep)" }}>Setup {done} of 5 done</b><div className="small" style={{ color: "var(--accent-deep)" }}>{!setup[1] ? "Add the reps who get requests" : !setup[2] ? "Forward your company line and run a test call" : !setup[4] ? "Add tonight's price sheet to start confirming orders automatically" : "Almost there"}</div><div className="dots">{setup.map((ok, i) => <i key={i} className={ok ? "" : "off"} />)}</div></div>
          <Link className="btn green" href={!setup[1] ? "/panel/settings?s=company" : !setup[2] ? "/panel/settings?s=lines" : "/panel/controls"} style={{ textDecoration: "none" }}>{!setup[1] ? "Add your team" : !setup[2] ? "Set up forwarding" : "Add prices"}</Link></div>
      )}
      <div className="setwrap">
        <nav className="side" aria-label="Settings sections">{SECTIONS.map(([k, l]) => <Link key={k} href={`/panel/settings?s=${k}`} className="si" aria-current={sec === k} style={{ textDecoration: "none" }}>{l}{k === "lines" && voice?.lastForwardingTestOk && <span className="ok">✓</span>}</Link>)}</nav>
        <section className="card">
          <h2 style={{ fontSize: 17 }}>{SECTIONS.find(([k]) => k === sec)?.[1]}</h2>

          {sec === "company" && (<div>
            <form action={saveCompany}>
              <div className="field"><label htmlFor="name">Company name the desk uses</label><input id="name" name="name" defaultValue={customer.name} /></div>
              <div className="field"><label htmlFor="tz">Time zone</label><select id="tz" name="timezone" defaultValue={tz}>{TZ.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
              <button className="btn green" style={{ marginTop: 12 }}>Save</button>
            </form>
            <div className="tbl" style={{ marginTop: 20 }}><table><thead><tr><th>Team member</th><th>WhatsApp</th><th>Sets prices</th><th>Approves</th><th>Edits settings</th><th>Order clerk</th></tr></thead><tbody>
              {members.map((m) => <tr key={m.id}><td><b>{m.name}</b><div className="hint">{m.email ?? ""}</div></td><td className="small">{fmt(m.cell)}{m.whatsappOptedIn ? "" : <div className="hint">not opted in yet</div>}</td>
                {(["canSetPrices", "canApprove", "canEditSettings", "isOrderClerk"] as const).map((k) => <td key={k}><Toggle action={toggleMember} hidden={{ memberId: m.id, key: k }} on={m[k]} label={`${m.name} ${k}`} /></td>)}</tr>)}
            </tbody></table></div>
            <form action={addMember} className="row" style={{ marginTop: 12, flexWrap: "wrap" }}><input name="name" placeholder="Name" required /><input name="cell" placeholder="WhatsApp number" required /><input name="email" placeholder="Email (optional)" /><button className="btn sm" type="submit">Add team member</button></form>
            <p className="hint">New members get a WhatsApp asking them to opt in. Decisions made here on the panel are recorded under {members.find((m) => m.isOwner)?.name ?? members[0]?.name ?? "the owner"}.</p>
          </div>)}

          {sec === "lines" && (<div>
            <form action={saveLines}>
              <div className="item"><div><b>Company line forwarding</b><span className="hint">{voice ? `Forward ${fmt(voice.companyNumber)} to ${fmt(voice.twilioNumber)} after hours (and after ${s.ringCount} rings during the day). Last test ${t(voice.lastForwardingTestAt)}.` : "No voice line provisioned yet."}</span></div>
                <div className="row"><span className={"badge " + (voice?.lastForwardingTestOk ? "good" : "wait")}>{voice?.lastForwardingTestOk ? "Working" : voice?.lastForwardingTestOk === false ? "Failed" : "Not tested"}</span></div></div>
              <div className="item"><div><b>Callbacks show your company number</b><span className="hint">Buyers see {fmt(voice?.companyNumber ?? null)} when we call them back</span></div><span className={"badge " + (voice?.callerIdVerified ? "good" : "wait")}>{voice?.callerIdVerified ? "Verified" : "Pending"}</span></div>
              <div className="item"><div><b>Text line for orders</b><span className="hint">{text ? `${fmt(text.twilioNumber)} · buyers can text orders any time` : "Not provisioned yet"}</span></div><span className={"badge " + (text?.textRegistrationStatus === "approved" ? "good" : "wait")}>{text?.textRegistrationStatus ?? "Carrier approval pending"}</span></div>
              <div className="field"><label htmlFor="companyNumber">Your company line</label><input id="companyNumber" name="companyNumber" defaultValue={voice?.companyNumber ?? ""} placeholder="(520) 555-0100" /></div>
              <div className="field"><label htmlFor="backup">Backup number if anything goes down</label><input id="backup" name="backupNumber" defaultValue={voice?.backupNumber ?? ""} placeholder="A rep's cell" /></div>
              <details className="adv"><summary style={{ padding: "12px 14px", fontWeight: 600, color: "var(--muted)", cursor: "pointer" }}>Advanced: rings before pickup, blocked numbers, timers</summary><div className="in">
                <div className="field"><label htmlFor="rings">Rings before the desk picks up during the day</label><select id="rings" name="ringCount" defaultValue={s.ringCount}>{[3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}</option>)}</select></div>
                <div className="field"><label htmlFor="blocked">Blocked numbers</label><textarea id="blocked" name="blockedNumbers" rows={2} defaultValue={s.blockedNumbers.join("\n")} placeholder="One per line" /></div>
                <div className="field"><label htmlFor="esc">Minutes before an unanswered card is sent again to the on-call rep</label><input id="esc" className="num" name="escalationMinutes" type="number" defaultValue={s.escalationMinutes} /></div>
                <div className="field"><label htmlFor="spt">Ask &quot;same prices as last night?&quot; at</label><input id="spt" name="samePricesPromptTime" type="time" defaultValue={s.samePricesPromptTime} /></div>
                <div className="field"><label htmlFor="ret">Keep call notes for (months)</label><input id="ret" className="num" name="retentionMonths" type="number" defaultValue={s.retentionMonths} /></div>
                <input type="hidden" name="testNumbers" value={s.testNumbers.join("\n")} />
              </div></details>
              <button className="btn green" style={{ marginTop: 14 }}>Save</button>
            </form>
            <form action={testForwarding} style={{ marginTop: 10 }}><button className="btn ghost sm" disabled={!voice?.companyNumber || !text}>Test forwarding now</button> <span className="hint">We call your company line; if forwarding works the call reaches the desk and this turns green within five minutes.</span></form>
          </div>)}

          {sec === "hours" && (<form action={saveHours}>
            <p className="hint">The desk answers outside these hours. On closed days it answers all day.</p>
            <div className="tbl"><table><tbody>{DAY_KEYS.map((k, i) => { const d = s.hours[k]; return <tr key={k}><td><b>{DAYS[i]}</b></td><td><span className="row"><input type="time" name={`${k}_open`} defaultValue={d?.open ?? "06:00"} aria-label={`${DAYS[i]} opens`} /> to <input type="time" name={`${k}_close`} defaultValue={d?.close ?? "17:00"} aria-label={`${DAYS[i]} closes`} /></span></td><td className="r"><label className="row small muted" style={{ justifyContent: "flex-end" }}>Open <input type="checkbox" name={`${k}_open_switch`} defaultChecked={!d?.closed} /></label></td></tr>; })}</tbody></table></div>
            <div className="field"><label htmlFor="hol">Holidays (one date per line, YYYY-MM-DD)</label><textarea id="hol" name="holidays" rows={3} defaultValue={s.holidays.join("\n")} /></div>
            <button className="btn green" style={{ marginTop: 16 }}>Save hours</button>
          </form>)}

          {sec === "voice" && (<form action={saveVoice}>
            <div className="field"><label htmlFor="greet">Greeting</label><input id="greet" name="greeting" defaultValue={s.greeting} /><span className="hint">Buyers hear this when the desk picks up.</span></div>
            <div className="field"><label htmlFor="voice">Voice</label><select id="voice" name="voice" defaultValue={s.voice}><option value="default">Marco · warm, Mexican Spanish and English</option><option value="elena">Elena · clear, Mexican Spanish and English</option><option value="james">James · US English</option></select></div>
            {([["spanish", "Switch to Spanish when the buyer does", ""], ["quotePrices", "Tell buyers tonight's price when they ask", "Only prices you set. Anything else goes to your team."], ["timingPromises", "Tell buyers when to expect an answer", "Off: the desk makes no timing promises"], ["urgentRing", "Ring the on-call rep for loads being rejected right now", ""]] as const).map(([k, label, hint]) => (
              <div key={k} className="sw"><div><b>{label}</b>{hint && <span className="hint">{hint}</span>}</div><input type="checkbox" name={k} defaultChecked={s[k]} aria-label={label} /></div>
            ))}
            <div className="field"><label htmlFor="info">What the desk can tell buyers</label><textarea id="info" name="businessInfo" rows={4} defaultValue={s.businessInfo} placeholder={"Pickup: 672 W. Frontage Rd, Nogales AZ, 6am to 5pm.\nTerms: 10 days.\nWe carry vine-ripes, Romas, grape tomatoes, bell peppers and eggplant."} /></div>
            <button className="btn green" style={{ marginTop: 16 }}>Save</button> <span className="hint">Changes apply to the next call.</span>
          </form>)}

          {sec === "callbacks" && (<form action={saveCallbacks}>
            <div className="field"><label htmlFor="undo">Time to undo a tap before the desk acts</label><select id="undo" name="undoMinutes" defaultValue={String(Math.round(s.undoSeconds / 60))}><option value="1">1 minute</option><option value="2">2 minutes</option><option value="5">5 minutes</option></select></div>
            <div className="field"><label htmlFor="noans">If the buyer doesn&apos;t pick up the callback</label><select id="noans" name="noAnswerAction" defaultValue={s.noAnswerAction}><option value="text">Send a text with the offer</option><option value="whatsapp">Send a WhatsApp with the offer</option><option value="none">Do nothing; show In progress in the morning</option></select></div>
            <div className="sw"><div><b>Text before calling back</b><span className="hint">&quot;{customer.name} calling you back about your order&quot;, so the call isn&apos;t taken for spam</span></div><input type="checkbox" name="textFirst" defaultChecked={s.textFirstBeforeCall} /></div>
            <div className="field"><label htmlFor="conf">Confirmation message</label><textarea id="conf" name="confirmationTemplate" rows={3} defaultValue={s.confirmationTemplate} /><span className="hint">Preview: {preview}</span></div>
            <button className="btn green" style={{ marginTop: 16 }}>Save</button>
          </form>)}

          {sec === "summary" && (<div>
            <form action={saveSummary}>
              <div className="field"><label htmlFor="mins">Send it</label><select id="mins" name="minutes" defaultValue={String(s.summaryMinutesBefore)}><option value="5">5 minutes before opening</option><option value="15">15 minutes before opening</option><option value="30">30 minutes before opening</option></select></div>
              {([["orders", "Overnight orders"], ["rules", "Sold at the prices you set"], ["other", "Also overnight"], ["transcripts", "Calls and messages"]] as const).map(([k, l]) => <div key={k} className="sw"><b>{l}</b><input type="checkbox" name={`section_${k}`} defaultChecked={s.summarySections.includes(k)} /></div>)}
              <div className="sw"><b>Send a short note on quiet nights</b><input type="checkbox" name="quietNightNote" defaultChecked={s.quietNightNote} /></div>
              <div className="field"><label htmlFor="lang">Language</label><select id="lang" name="language" defaultValue={s.summaryLanguage}><option value="en">English</option><option value="es">Spanish</option></select></div>
              <button className="btn green" style={{ marginTop: 14 }}>Save</button>
            </form>
            <div className="tbl" style={{ marginTop: 18 }}><table><thead><tr><th>Who gets it</th><th>WhatsApp</th><th>Email</th></tr></thead><tbody>
              {members.map((m) => <tr key={m.id}><td><b>{m.name}</b>{!m.email && <div className="hint">no email on file</div>}</td><td><Toggle action={toggleMember} hidden={{ memberId: m.id, key: "summaryWhatsapp" }} on={m.summaryWhatsapp} label={`${m.name} WhatsApp`} /></td><td><Toggle action={toggleMember} hidden={{ memberId: m.id, key: "summaryEmail" }} on={m.summaryEmail} label={`${m.name} email`} /></td></tr>)}
            </tbody></table></div>
            <form action={sendTestSummary} style={{ marginTop: 14 }}><button className="btn ghost">Send me a test</button></form>
          </div>)}

          {sec === "compliance" && (<div>
            <div className="item"><div><b>Text line registration</b><span className="hint">Carriers approve business texting before it goes live</span></div><span className={"badge " + (text?.textRegistrationStatus === "approved" ? "good" : "wait")}>{text?.textRegistrationStatus ?? "In review"}</span></div>
            <div className="item"><div><b>WhatsApp business number</b><span className="hint">Used to message your team</span></div><span className="badge good">Shared Soba number</span></div>
            <div className="item"><div><b>Buyer permission to call back</b><span className="hint">Asked on every call and saved with it</span></div><span className="badge good">On</span></div>
            <div className="item"><div><b>Call notes kept for</b></div><span>{s.retentionMonths} months</span></div>
            <div className="item"><div><b>Plan</b><span className="hint">{customer.plan} · {members.length} rep{members.length === 1 ? "" : "s"}</span></div><span className="hint">Billing is handled by Soba during the pilot</span></div>
          </div>)}

          {sec === "tests" && (<form action={saveLines}>
            <p className="hint">Calls from these numbers run the full flow but never count in your results. The desk still sends the cards and messages, so your team sees exactly what a buyer would get.</p>
            <div className="field"><label htmlFor="testnums">Test numbers (one per line)</label><textarea id="testnums" name="testNumbers" rows={3} defaultValue={s.testNumbers.join("\n")} /></div>
            <input type="hidden" name="ringCount" value={s.ringCount} /><input type="hidden" name="blockedNumbers" value={s.blockedNumbers.join("\n")} /><input type="hidden" name="retentionMonths" value={s.retentionMonths} /><input type="hidden" name="samePricesPromptTime" value={s.samePricesPromptTime} /><input type="hidden" name="escalationMinutes" value={s.escalationMinutes} /><input type="hidden" name="companyNumber" value={voice?.companyNumber ?? ""} /><input type="hidden" name="backupNumber" value={voice?.backupNumber ?? ""} />
            <button className="btn green" style={{ marginTop: 12 }}>Save</button>
            <p className="hint" style={{ marginTop: 14 }}>To place a test call, phone {fmt(voice?.twilioNumber ?? null)} from one of these numbers.</p>
          </form>)}
        </section>
      </div>
    </>
  );
}
