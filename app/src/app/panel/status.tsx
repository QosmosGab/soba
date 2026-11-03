"use client";
// The header status: a Live / Pause menu. Picking the other state asks first,
// then submits setAnswering with the chosen value.
import { useEffect, useRef, useState } from "react";
import { setAnswering } from "./actions";

const Chev = () => <svg className="chev" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 6l4 4 4-4" /></svg>;
const Tick = () => <svg className="tick" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 8.5l3 3 7-7" /></svg>;

export function Status({ live, linesOk }: { live: boolean; linesOk: boolean }) {
  const [open, setOpen] = useState(false);
  const [ask, setAsk] = useState<null | boolean>(null); // the state being confirmed
  const [busy, setBusy] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const dlg = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", off); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", off); document.removeEventListener("keydown", esc); };
  }, [open]);

  useEffect(() => {
    const d = dlg.current; if (!d) return;
    if (ask !== null && !d.open) d.showModal();
    if (ask === null && d.open) d.close();
  }, [ask]);

  const pick = (value: boolean) => { setOpen(false); if (value !== live) setAsk(value); };
  const confirm = async () => {
    if (ask === null) return;
    setBusy(true);
    const f = new FormData(); f.set("value", ask ? "1" : "0");
    try { await setAnswering(f); } finally { setBusy(false); setAsk(null); }
  };

  return (
    <div className="status" ref={wrap}>
      <button type="button" className={"pillstat" + (live ? "" : " off")} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} title={live && !linesOk ? "Forwarding check failed, see Settings" : undefined}>
        <span className="dot" />{live ? "Live" : "Paused"}<Chev />
      </button>
      {open && (
        <div className="menu" role="menu">
          <button type="button" role="menuitemradio" aria-checked={live} className="live" onClick={() => pick(true)}>
            <span className="dot" /><span>Live<small>Soba answers after hours</small></span>{live && <Tick />}
          </button>
          <button type="button" role="menuitemradio" aria-checked={!live} onClick={() => pick(false)}>
            <span className="dot" /><span>Pause<small>Calls ring through to you</small></span>{!live && <Tick />}
          </button>
        </div>
      )}
      <dialog className="confirm" ref={dlg} onClose={() => setAsk(null)}>
        {ask === true ? (
          <><h3>Turn Soba on?</h3><p>Soba will answer the company line after hours and confirm orders at tonight&apos;s prices.</p></>
        ) : (
          <><h3>Pause Soba?</h3><p>After-hours calls will ring through to your team until you turn it back on. Tonight&apos;s prices stay saved.</p></>
        )}
        <div className="acts">
          <button type="button" className="btn ghost" onClick={() => setAsk(null)} disabled={busy}>Cancel</button>
          <button type="button" className={"btn" + (ask ? "" : " danger")} onClick={confirm} disabled={busy}>{busy ? "Saving…" : ask ? "Turn on" : "Pause"}</button>
        </div>
      </dialog>
    </div>
  );
}
