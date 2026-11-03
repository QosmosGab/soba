// The contact form on usesoba.com posts here (cross-origin from the static site).
// One email to hello@usesoba.com per submission, reply-to set to the sender.
import { Resend } from "resend";
import { env } from "@/lib/env";

const ORIGINS = new Set(["https://usesoba.com", "https://www.usesoba.com", "http://localhost:4319"]);
const INBOX = "hello@usesoba.com";
const FROM = "Soba <hello@usesoba.com>";

function cors(req: Request) {
  const o = req.headers.get("origin") ?? "";
  return { "access-control-allow-origin": ORIGINS.has(o) ? o : "https://usesoba.com", "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": "content-type", vary: "origin" };
}
const reply = (req: Request, body: unknown, status = 200) => Response.json(body, { status, headers: cors(req) });
const clean = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);

export function OPTIONS(req: Request) { return new Response(null, { status: 204, headers: cors(req) }); }

export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (clean(b.website, 10) || clean(b.company, 10)) return reply(req, { ok: true }); // honeypots filled: pretend success
  const name = clean(b.name, 120), email = clean(b.email, 200), kind = clean(b.kind, 80), orders = clean(b.orders, 120);
  const message = typeof b.message === "string" ? b.message.trim().slice(0, 4000) : "";
  if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return reply(req, { ok: false, error: "name and a valid email are required" }, 400);
  const lines = [`Name: ${name}`, `Email: ${email}`];
  if (kind) lines.push(`Operation: ${kind}`);
  if (orders) lines.push(`After-hours orders today: ${orders}`);
  lines.push("", message || "(no message)");
  const text = lines.join("\n");
  const html = `<pre style="font:14px/1.5 -apple-system,Segoe UI,sans-serif;white-space:pre-wrap">${esc(text)}</pre>`;
  if (env.dryRun) return reply(req, { ok: true, dryRun: true });
  const r = await new Resend(env.email.resendKey).emails.send({ from: FROM, to: [INBOX], replyTo: email, subject: `Site contact: ${name}${kind ? ` (${kind})` : ""}`, text, html });
  if (r.error) return reply(req, { ok: false, error: r.error.message }, 502);
  return reply(req, { ok: true });
}
