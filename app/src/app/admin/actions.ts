"use server";
import { and, eq, like } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb, schema } from "@/db";
import { isAdmin, newToken } from "@/lib/auth";
import { provisionCustomer } from "@/lib/provision";
import { seedDemo } from "@/lib/demo";
import { syncIntakeAgent, syncIntakeAgentQuietly } from "@/lib/agents";
import { toE164 } from "@/lib/requests";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
async function guard() { if (!(await isAdmin())) throw new Error("admin only"); return getDb(); }

export async function createCustomer(form: FormData) {
  const db = await guard();
  const { customer } = await provisionCustomer(db, { name: str(form, "name"), timezone: str(form, "timezone") || undefined, owner: { name: str(form, "ownerName"), cell: str(form, "ownerCell"), email: str(form, "ownerEmail") || null }, voiceNumber: str(form, "voiceNumber") || null, companyNumber: str(form, "companyNumber") || null, textNumber: str(form, "textNumber") || null });
  await syncIntakeAgentQuietly(db, customer.id);
  revalidatePath("/admin");
}

export async function setStatus(form: FormData) {
  const db = await guard();
  const status = str(form, "status");
  if (!["live", "paused", "setup"].includes(status)) return;
  await db.update(schema.customers).set({ status }).where(eq(schema.customers.id, str(form, "customerId")));
  revalidatePath("/admin");
}

export async function rotateToken(form: FormData) {
  const db = await guard();
  await db.update(schema.customers).set({ panelToken: newToken() }).where(eq(schema.customers.id, str(form, "customerId")));
  revalidatePath("/admin");
}

export async function addLine(form: FormData) {
  const db = await guard();
  const n = toE164(str(form, "twilioNumber"));
  if (!n) return;
  const customerId = str(form, "customerId");
  const kind = str(form, "kind") === "text" ? "text" : "voice";
  const values = { customerId, kind, twilioNumber: n, companyNumber: toE164(str(form, "companyNumber")), elevenAgentId: str(form, "elevenAgentId") || null, elevenPhoneNumberId: str(form, "elevenPhoneNumberId") || null } as const;
  // An agent created before the number existed left a "pending:" voice line; the real number takes its place and keeps the agent.
  const [pending] = kind === "voice" ? await db.select().from(schema.lines).where(and(eq(schema.lines.customerId, customerId), eq(schema.lines.kind, "voice"), like(schema.lines.twilioNumber, "pending:%"))) : [];
  if (pending) await db.update(schema.lines).set({ ...values, elevenAgentId: values.elevenAgentId ?? pending.elevenAgentId }).where(eq(schema.lines.id, pending.id));
  else await db.insert(schema.lines).values(values);
  if (kind === "voice") await syncIntakeAgentQuietly(db, customerId); // points the imported number at the agent when a phone id was given
  revalidatePath("/admin");
}

export async function addDemoData(form: FormData) {
  const db = await guard();
  await seedDemo(db, str(form, "customerId"));
  revalidatePath("/admin");
}

/** Create or refresh the customer's ElevenLabs intake agent from their Settings. */
export async function syncAgent(form: FormData) {
  const db = await guard();
  await syncIntakeAgent(db, str(form, "customerId"));
  revalidatePath("/admin");
}
