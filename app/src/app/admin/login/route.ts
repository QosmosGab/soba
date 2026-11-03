// GET /admin/login?key=<ADMIN_TOKEN>: sets the admin cookie and sends you to /admin.
// A route handler, because a server component is not allowed to set cookies.
import { NextResponse } from "next/server";
import { adminTokenOk, setAdminSession } from "@/lib/auth";

export async function GET(req: Request) {
  const url = new URL(req.url);
  if (!adminTokenOk(url.searchParams.get("key"))) return new NextResponse("Not found", { status: 404 });
  await setAdminSession();
  return NextResponse.redirect(new URL("/admin", url.origin));
}
