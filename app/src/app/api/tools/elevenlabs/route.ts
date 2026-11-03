// The tool the intake agent calls mid-call. Authenticated by a shared secret header
// set on the ElevenLabs tool; the work is in src/lib/tool.ts.
import { getDb } from "@/db";
import { env } from "@/lib/env";
import { json } from "@/lib/http";
import { deskTool } from "@/lib/tool";
import { timingSafeEqual } from "node:crypto";

const sameSecret = (a: string | null, b: string) => a != null && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export async function POST(req: Request) {
  if (process.env.SOBA_SKIP_SIGNATURES !== "1" && !sameSecret(req.headers.get("x-soba-tool-secret"), env.eleven.toolSecret)) return json({ error: "unauthorized" }, 401);
  const r = await deskTool(await getDb(), await req.json().catch(() => ({})), new Date());
  return json(r.body, r.status);
}
