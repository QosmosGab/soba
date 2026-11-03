// The welcome link: /p/<token> signs the customer in and opens the panel.
import { redirect } from "next/navigation";
import { customerByToken, setPanelSession } from "@/lib/auth";

export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const c = await customerByToken(token);
  if (!c) return new Response("That link is not valid. Ask Soba for a new one.", { status: 404 });
  await setPanelSession(c.id);
  redirect("/panel");
}
