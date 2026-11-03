"use server";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb, schema } from "@/db";
import { isAdmin, newToken } from "@/lib/auth";
import { provisionCustomer } from "@/lib/provision";
import { toE164 } from "@/lib/requests";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
async function guard() { if (!(await isAdmin())) throw new Error("admin only"); return getDb(); }

export async function createCustomer(form: FormData) {
  const db = await guard();
  await provisionCustomer(db, { name: str(form, "name"), timezone: str(form, "timezone") || undefined, owner: { name: str(form, "ownerName"), cell: str(form, "ownerCell"), email: str(form, "ownerEmail") || null }, voiceNumber: str(form, "voiceNumber") || null, companyNumber: str(form, "companyNumber") || null, textNumber: str(form, "textNumber") || null });
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
  await db.insert(schema.lines).values({ customerId: str(form, "customerId"), kind: str(form, "kind") === "text" ? "text" : "voice", twilioNumber: n, companyNumber: toE164(str(form, "companyNumber")), elevenAgentId: str(form, "elevenAgentId") || null, elevenPhoneNumberId: str(form, "elevenPhoneNumberId") || null });
  revalidatePath("/admin");
}
