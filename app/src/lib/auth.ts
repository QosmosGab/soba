// Panel access: a per-customer link carries a token; visiting it sets a cookie.
// Internal admin uses ADMIN_TOKEN the same way. No passwords in the MVP.
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { env } from "./env";
import { createHmac } from "node:crypto";
export { newToken } from "./provision";

const COOKIE = "soba_panel";
const ADMIN_COOKIE = "soba_admin";

const sign = (v: string) => createHmac("sha256", env.sessionSecret).update(v).digest("hex").slice(0, 32);

export async function setPanelSession(customerId: string) {
  (await cookies()).set(COOKIE, `${customerId}.${sign(customerId)}`, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 90, secure: process.env.NODE_ENV === "production" });
}

export async function clearPanelSession() {
  (await cookies()).delete(COOKIE);
}

/** The signed-in customer, or null. */
export async function panelCustomer() {
  const v = (await cookies()).get(COOKIE)?.value;
  if (!v) return null;
  const [id, sig] = v.split(".");
  if (!id || sign(id) !== sig) return null;
  const db = await getDb();
  const [c] = await db.select().from(schema.customers).where(eq(schema.customers.id, id));
  return c ?? null;
}

export async function customerByToken(token: string) {
  const db = await getDb();
  const [c] = await db.select().from(schema.customers).where(eq(schema.customers.panelToken, token));
  return c ?? null;
}


export async function setAdminSession() {
  (await cookies()).set(ADMIN_COOKIE, sign("admin"), { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30, secure: process.env.NODE_ENV === "production" });
}
export async function isAdmin() {
  return (await cookies()).get(ADMIN_COOKIE)?.value === sign("admin");
}
export function adminTokenOk(token: string | null) {
  try { return Boolean(token) && token === env.adminToken; } catch { return false; }
}
