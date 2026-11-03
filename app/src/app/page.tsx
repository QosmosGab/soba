import { redirect } from "next/navigation";
import { panelCustomer } from "@/lib/auth";

export default async function Home() {
  if (await panelCustomer()) redirect("/panel");
  return (
    <main className="login">
      <div className="brand" style={{ marginBottom: 18 }}><div className="mark">S</div>Soba</div>
      <div className="card">
        <h2>Open your panel</h2>
        <p className="muted" style={{ marginTop: 6 }}>Use the link from your welcome message. It signs you in on this device for 90 days.</p>
        <form action="/p" method="get" className="field">
          <label htmlFor="t">Or paste your access code</label>
          <div className="row"><input id="t" name="t" placeholder="Access code" style={{ flex: 1 }} /><button className="btn green" type="submit">Open</button></div>
        </form>
      </div>
    </main>
  );
}
