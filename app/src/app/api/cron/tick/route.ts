// The nightly clock, invoked by Vercel Cron every five minutes (vercel.json). It
// scans every live customer for what is due: the same-prices prompt, the forwarding
// test, stale callbacks, retention, the morning summary. Every action is idempotent.
import { nightlyTick } from "@/lib/clock";
import { timingSafeEqual } from "node:crypto";

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  const ok = secret ? auth.length === `Bearer ${secret}`.length && timingSafeEqual(Buffer.from(auth), Buffer.from(`Bearer ${secret}`)) : process.env.NODE_ENV !== "production";
  if (!ok) return new Response("Unauthorized", { status: 401 });
  const result = await nightlyTick(new Date());
  return Response.json({ ok: true, at: new Date().toISOString(), result });
}
