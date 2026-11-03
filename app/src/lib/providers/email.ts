// Email through Resend: the morning summary and alerts. From our domain, under the customer's name.
import { Resend } from "resend";
import { env } from "../env";
import { randomBytes } from "node:crypto";
/** Dry-run ids must be unique: provider ids are a unique column. */
const dryId = () => `${Date.now()}_${randomBytes(3).toString("hex")}`;

let _client: Resend | undefined;
function resend() { _client ??= new Resend(env.email.resendKey); return _client; }

export async function sendEmail(args: { to: string[]; subject: string; html: string; text?: string; fromName?: string; replyTo?: string }) {
  if (!args.to.length) return { id: null, dryRun: true };
  if (env.dryRun) return { id: `dry_${dryId()}`, dryRun: true };
  const from = args.fromName ? env.email.from.replace(/^[^<]*</, `${args.fromName} via Soba <`) : env.email.from;
  const r = await resend().emails.send({ from, to: args.to, subject: args.subject, html: args.html, text: args.text, replyTo: args.replyTo });
  if (r.error) throw new Error(`Resend: ${r.error.message}`);
  return { id: r.data?.id ?? null, dryRun: false };
}
