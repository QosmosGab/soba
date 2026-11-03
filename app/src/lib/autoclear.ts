// Auto-clear: the six conditions from the spec. All must hold or the request goes to the reps whole.
//  1. Auto-clear switch on, and inside the off-hours window.
//  2. A live rule exists for the product, size and pack.
//  3. Every order line is at or above its rule's price.
//  4. Quantity is within what's left on the rule.
//  5. Price isn't implausibly high (default: more than 30% above the rule).
//  6. Pickup, not delivered.
import type { ResolvedLine } from "./extract";

export type LiveRule = {
  id: string; product: string; size: string | null; pack: string | null;
  minPrice: number; caseLimit: number; casesCleared: number; on: boolean; expiresAt: Date;
};

export type AutoClearSettings = { autoClear: boolean; implausiblePricePct: number; answering?: boolean };

export type AutoClearResult =
  | { clear: true; lines: Array<{ rule: LiveRule; cases: number; price: number }> }
  | { clear: false; reason: string; condition: 1 | 2 | 3 | 4 | 5 | 6 };

const norm = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/\s+/g, " ").replace(/[^a-z0-9 x-]/g, "").trim();

/** A rule matches a line on product, and on size/pack when the rule specifies them. */
export function ruleMatches(rule: LiveRule, line: ResolvedLine): boolean {
  if (norm(rule.product) !== norm(line.productCanonical ?? line.product)) return false;
  if (rule.size && norm(rule.size) !== norm(line.size)) return false;
  if (rule.pack && line.pack && !norm(line.pack).startsWith(norm(rule.pack).split(" ")[0])) return false; // "25 lb" matches "25 lb 2-layer"
  return true;
}

export function decideAutoClear(args: {
  lines: ResolvedLine[]; rules: LiveRule[]; settings: AutoClearSettings; offHours: boolean; now: Date;
}): AutoClearResult {
  const { lines, rules, settings, offHours, now } = args;
  if (settings.answering === false) return { clear: false, reason: "the desk is switched off tonight", condition: 1 };
  if (!settings.autoClear) return { clear: false, reason: "auto-clear is off", condition: 1 };
  if (!offHours) return { clear: false, reason: "desk is open; auto-clear runs after hours only", condition: 1 };
  if (!lines.length) return { clear: false, reason: "no order lines", condition: 2 };

  const out: Array<{ rule: LiveRule; cases: number; price: number }> = [];
  const claimed = new Map<string, number>(); // cases already taken from a rule by an earlier line in this order
  for (const line of lines) {
    if (line.fulfillment === "delivered") return { clear: false, reason: "delivered-price request", condition: 6 };
    if (line.fulfillment !== "collect") return { clear: false, reason: "pickup not confirmed as the buyer's truck", condition: 6 };
    if (line.cases == null || line.priceOffered == null) return { clear: false, reason: "quantity or price missing", condition: 3 };
    const rule = rules.find((r) => r.on && r.expiresAt > now && ruleMatches(r, line));
    if (!rule) return { clear: false, reason: `no live rule for ${line.productCanonical ?? line.product}${line.size ? ` ${line.size}` : ""}`, condition: 2 };
    if (line.priceOffered < rule.minPrice) return { clear: false, reason: `offer $${line.priceOffered.toFixed(2)} is below the rule's $${rule.minPrice.toFixed(2)}`, condition: 3 };
    const ceiling = rule.minPrice * (1 + settings.implausiblePricePct / 100);
    if (line.priceOffered > ceiling) return { clear: false, reason: `offer $${line.priceOffered.toFixed(2)} is more than ${settings.implausiblePricePct}% above the rule; likely misheard`, condition: 5 };
    const left = rule.caseLimit - rule.casesCleared - (claimed.get(rule.id) ?? 0);
    if (line.cases > left) return { clear: false, reason: `${line.cases} cases asked, ${Math.max(left, 0)} left on the rule`, condition: 4 };
    claimed.set(rule.id, (claimed.get(rule.id) ?? 0) + line.cases);
    out.push({ rule, cases: line.cases, price: line.priceOffered });
  }
  return { clear: true, lines: out };
}
