// The WhatsApp card a rep gets for a request, and the follow-ups after a tap.
// Pure formatting. WhatsApp template bodies cap at 1,024 characters and each
// variable must be one line, so every field is kept short.
import type { ResolvedLine } from "./extract";

export type CardInput = {
  ref: number;
  channel: "call" | "text";
  receivedAt: Date;
  timezone: string;
  callerName: string | null;
  callerCompany: string | null;
  callerCity: string | null;
  callbackNumber: string | null;
  type: string;
  flags: string[];
  summary: string;
  lines: ResolvedLine[];
  transcriptUrl?: string;
  repeatTimes?: Date[];   // earlier contacts merged into this request
};

const FLAG_WORDS: Record<string, string> = {
  incomplete: "incomplete", unclear: "unclear", not_on_sheet: "not on sheet", wants_quote: "wants a quote",
  urgent: "URGENT", insists_on_person: "wants a person", repeat_caller: "called again", no_callback: "no callback",
  changed: "buyer changed it", test: "TEST CALL", reminder: "reminder",
};
// new_buyer is shown on the panel, not on the card; the card has room for what changes the decision.
const HIDDEN_FLAGS = new Set(["new_buyer"]);

/** +13125550142 → 312-555-0142; other countries keep E.164. */
export function fmtPhone(n: string | null | undefined): string {
  if (!n) return "";
  const m = n.match(/^\+1(\d{3})(\d{3})(\d{4})$/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : n;
}

export function fmtTime(d: Date, timezone: string): string {
  return d.toLocaleString("en-US", { timeZone: timezone, weekday: "short", hour: "numeric", minute: "2-digit" })
    .replace(",", "").replace(" AM", "am").replace(" PM", "pm");
}

export function fmtMoney(n: number | null | undefined): string {
  return n == null ? "" : `$${n.toFixed(2)}`;
}

function fmtPickup(l: ResolvedLine): string {
  const day = l.pickupDate
    ? new Date(l.pickupDate + "T12:00:00Z").toLocaleString("en-US", { timeZone: "UTC", weekday: "short" })
    : (l.pickup ?? "");
  const how = l.fulfillment === "delivered" ? (l.destination ? `delivered to ${l.destination}` : "delivered") : l.fulfillment === "collect" ? "buyer collects" : "";
  return [day, how].filter(Boolean).join(" · ");
}

/** The request card. Returns the plain text body; buttons are added by the sender. */
export function requestCard(c: CardInput): string {
  const who = [c.callerName, c.callerCompany ? `${c.callerCompany}${c.callerCity ? ` (${c.callerCity})` : ""}` : null, fmtPhone(c.callbackNumber)]
    .filter(Boolean).join(" · ");
  const when = `${c.channel}, ${fmtTime(c.receivedAt, c.timezone)}`;
  const flags = c.flags.filter((f) => !HIDDEN_FLAGS.has(f)).map((f) => FLAG_WORDS[f] ?? f);
  if (c.repeatTimes?.length) flags.push(`called ${c.repeatTimes.length + 1} times: ${[...c.repeatTimes, c.receivedAt].map((t) => fmtTime(t, c.timezone)).join(", ")}`);
  const out: string[] = [who, `NEW REQUEST · ref ${c.ref} · ${when}`];
  if (flags.length) out.push(flags.join(" · "));
  out.push("");
  if (c.type === "new_order" && c.lines.length) {
    c.lines.forEach((l, i) => {
      if (c.lines.length > 1) out.push(`Line ${i + 1}`);
      out.push(`Product:  ${l.productCanonical ?? l.product}${l.productCanonical ? "" : " (not on sheet)"}`);
      if (l.size) out.push(`Size:     ${l.size}`);
      if (l.pack) out.push(`Pack:     ${l.pack}`);
      out.push(`Qty:      ${l.cases != null ? `${l.cases} cases` : "not given"}`);
      out.push(`Price:    ${l.priceOffered != null ? `offers ${fmtMoney(l.priceOffered)}/case` : "wants a quote"}`);
      const pk = fmtPickup(l);
      if (pk) out.push(`Pickup:   ${pk}`);
      if (l.poNumber) out.push(`PO:       ${l.poNumber}`);
      if (i < c.lines.length - 1) out.push("");
    });
  } else {
    out.push(c.summary);
  }
  out.push("");
  if (c.transcriptUrl) out.push(`Transcript: ${c.transcriptUrl}`);
  return out.join("\n").trimEnd();
}

/**
 * The same card as WhatsApp template variables. WhatsApp forbids newlines inside a
 * variable, so the template holds the line structure and each field is one line:
 *   {{1}}                      who
 *   NEW REQUEST · ref {{2}} · {{3}}
 *   {{4}}                      flags, or "—"
 *   Product:  {{5}}  Size: {{6}}  Pack: {{7}}  Qty: {{8}}  Price: {{9}}  Pickup: {{10}}
 *   Transcript: {{11}}
 * Several order lines are joined with " | " inside each field.
 */
export function cardTemplateVariables(c: CardInput): Record<string, string> {
  const one = (s: string) => s.replace(/\s*\n\s*/g, " · ").replace(/\s{2,}/g, " ").trim() || "—";
  const who = [c.callerName, c.callerCompany ? `${c.callerCompany}${c.callerCity ? ` (${c.callerCity})` : ""}` : null, fmtPhone(c.callbackNumber)].filter(Boolean).join(" · ");
  const flags = c.flags.filter((f) => !HIDDEN_FLAGS.has(f)).map((f) => FLAG_WORDS[f] ?? f);
  if (c.repeatTimes?.length) flags.push(`called ${c.repeatTimes.length + 1} times`);
  const join = (f: (l: ResolvedLine) => string) => one(c.lines.map(f).filter(Boolean).join(" | "));
  const isOrder = c.type === "new_order" && c.lines.length > 0;
  return {
    "1": one(who || "Unknown caller"),
    "2": String(c.ref),
    "3": one(`${c.channel}, ${fmtTime(c.receivedAt, c.timezone)}`),
    "4": one(flags.join(" · ")),
    "5": isOrder ? join((l) => `${l.productCanonical ?? l.product}${l.productCanonical ? "" : " (not on sheet)"}`) : one(c.summary),
    "6": isOrder ? join((l) => l.size ?? "—") : "—",
    "7": isOrder ? join((l) => l.pack ?? "—") : "—",
    "8": isOrder ? join((l) => (l.cases != null ? `${l.cases} cases` : "not given")) : "—",
    "9": isOrder ? join((l) => (l.priceOffered != null ? `offers ${fmtMoney(l.priceOffered)}/case` : "wants a quote")) : "—",
    "10": isOrder ? join((l) => fmtPickup(l) || "—") : "—",
    "11": one(c.transcriptUrl ?? "—"),
  };
}

/** Which buttons the card carries. Non-orders get Take over only. */
export function cardButtons(type: string): Array<"Approve" | "Counter" | "Reject" | "Take over"> {
  return type === "new_order" ? ["Approve", "Counter", "Reject", "Take over"] : ["Take over"];
}

/** Messages after a tap, from the spec's "After a tap" table. */
/** "Reply UNDO within 2 minutes to stop.", following the customer's undo setting. */
export const undoWord = (undoSeconds: number) => `Reply UNDO within ${undoSeconds >= 120 ? `${Math.round(undoSeconds / 60)} minutes` : undoSeconds >= 60 ? "a minute" : `${undoSeconds} seconds`} to stop.`;

export const afterTap = {
  undoWord,
  approve: (buyerFirst: string, cases: number | null, price: number | null, channel: "call" | "text", undo = undoWord(120)) =>
    `${channel === "call" ? "Calling" : "Texting"} ${buyerFirst} now to confirm${cases != null ? ` ${cases} cs` : ""}${price != null ? ` at ${fmtMoney(price)}` : ""}. ${undo}`,
  counterAsk: () => `Your final price? Reply like "8.50" or "8.50 max 200".`,
  counterSet: (buyerFirst: string, price: number, maxCases: number | null, channel: "call" | "text", undo = undoWord(120)) =>
    `${channel === "call" ? "Calling" : "Texting"} ${buyerFirst} with ${fmtMoney(price)}${maxCases != null ? ` for up to ${maxCases} cs` : ""}, once. ${undo}`,
  rejectAsk: () => `Reason for the buyer? (optional) Reply with a reason, or SKIP.`,
  takeOver: (name: string | null, number: string | null) =>
    `It's yours: ${[name, fmtPhone(number)].filter(Boolean).join(", ") || "no contact details captured"}. Reply WON or LOST when it's settled.`,
  claimed: (repName: string, ref: number, what: string) => `${repName} took ref ${ref}: ${what}.`,
  alreadyTaken: (repName: string) => `Already taken by ${repName}.`,
  acknowledged: () => ``, // "let me think": no reply, logged only
};

/** The order card after a confirmed deal, in the field order of a typical order entry. */
export function orderCard(o: {
  ref: number; customer: string; city: string | null; poNumber: string | null;
  product: string; size: string | null; pack: string | null; cases: number; price: number;
  terms: string; pickupDate: string | null; fulfillment: string | null; contactName: string | null; contactNumber: string | null;
  rule?: { cleared: number; limit: number };
}): string {
  const pickup = o.pickupDate
    ? new Date(o.pickupDate + "T12:00:00Z").toLocaleString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" })
    : "not set";
  const lines = [
    `ORDER · ref ${o.ref}`,
    `Customer:  ${o.customer}${o.city ? `, ${o.city}` : ""}`,
    `PO #:      ${o.poNumber ?? "none given"}`,
    `Item:      ${[o.size, o.product, o.pack].filter(Boolean).join(" ")}`,
    `Qty:       ${o.cases} cs`,
    `Price:     ${fmtMoney(o.price)}/cs ${o.terms}`,
    `Pickup:    ${pickup}${o.fulfillment === "collect" ? " · buyer's truck" : o.fulfillment === "delivered" ? " · delivered" : ""}`,
    `Contact:   ${[o.contactName, o.contactNumber].filter(Boolean).join(", ") || "not given"}`,
  ];
  if (o.rule) lines.push(`Rule:      ${o.rule.cleared} of ${o.rule.limit} cases sold`);
  return lines.join("\n");
}
