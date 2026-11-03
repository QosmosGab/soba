import { redirect } from "next/navigation";
export async function GET(req: Request) {
  const t = new URL(req.url).searchParams.get("t") ?? "";
  redirect(`/p/${encodeURIComponent(t.trim())}`);
}
