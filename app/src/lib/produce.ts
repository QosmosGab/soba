// Pure helpers for the way produce buyers talk. No network, fully unit-tested.

/** Canonical product names the desk uses, with the words buyers use for them. */
const PRODUCT_ALIASES: Array<[canonical: string, aliases: RegExp]> = [
  ["Vine-ripe tomatoes", /\b(vine[- ]?ripes?|vr|vine ripe tomato(es)?|jitomate(s)? bola|tomate(s)? bola|bola)\b/i],
  ["Roma tomatoes", /\b(romas?|roma tomato(es)?|jitomate(s)? saladette|saladette|tomate(s)? roma)\b/i],
  ["Tomatoes on the vine", /\b(tov|tovs|on the vine|en racimo|racimo)\b/i],
  ["Grape tomatoes", /\b(grape tomato(es)?|grapes?|tomate(s)? uva|uva)\b/i],
  ["Cherry tomatoes", /\b(cherry tomato(es)?|cherr(y|ies)|tomate(s)? cherry)\b/i],
  ["Beefsteak tomatoes", /\b(beefsteaks?|beef)\b/i],
  ["Red bell peppers", /\b(red bells?|red bell peppers?|chile(s)? morr[oó]n(es)? rojo(s)?|morr[oó]n(es)? rojo(s)?|pimiento(s)? rojo(s)?)\b/i],
  ["Yellow bell peppers", /\b(yellow bells?|yellow bell peppers?|morr[oó]n(es)? amarillo(s)?)\b/i],
  ["Green bell peppers", /\b(green bells?|green bell peppers?|morr[oó]n(es)? verde(s)?)\b/i],
  ["Bell peppers", /\b(bells?|bell peppers?|chile(s)? morr[oó]n(es)?|morr[oó]n(es)?)\b/i],
  ["Mini sweet peppers", /\b(mini sweets?|mini sweet peppers?|mini peppers?|pimientos? mini)\b/i],
  ["Cucumbers", /\b(cucumbers?|cukes?|pepinos?)\b/i],
  ["Squash", /\b(squash|calabac[ií]tas?|calabazas?|zucchini)\b/i],
  ["Eggplant", /\b(eggplants?|berenjenas?)\b/i],
];

export function normalizeProduct(text: string): string | null {
  for (const [canonical, re] of PRODUCT_ALIASES) if (re.test(text)) return canonical;
  return null;
}

/** "4x4", "4 by 4", "5x6", "4 x 5" → "4x4". Also XL/L/M size words for peppers. */
export function normalizeSize(text: string): string | null {
  const m = text.match(/\b([3-7])\s*(?:x|by|por)\s*([3-7])\b/i);
  if (m) return `${m[1]}x${m[2]}`;
  const w = text.match(/\b(extra[- ]?large|xl|jumbo|large|lg|medium|med|small)\b/i);
  if (!w) return null;
  const s = w[1].toLowerCase().replace(/[- ]/g, "");
  if (s === "extralarge" || s === "xl") return "XL";
  if (s === "jumbo") return "Jumbo";
  if (s === "large" || s === "lg") return "L";
  if (s === "medium" || s === "med") return "M";
  return "S";
}

/** "25 lb two-layer", "25lb 2 layer", "20 lb", "10 lb flat" → "25 lb 2-layer" style. */
export function normalizePack(text: string): string | null {
  const lb = text.match(/\b(\d{1,2})\s*(?:lb|lbs|pound|pounds|libras?)\b/i);
  const layer = text.match(/\b(two|2|one|1|single)[- ]?layer\b/i) ? (/\b(two|2)/i.test(text.match(/\b(two|2|one|1|single)[- ]?layer\b/i)![0]) ? "2-layer" : "1-layer") : null;
  const flat = /\bflat\b/i.test(text) ? "flat" : null;
  const parts = [lb ? `${lb[1]} lb` : null, layer, flat].filter(Boolean);
  return parts.length ? parts.join(" ") : null;
}

/** "300 cs", "300 cases", "trescientas cajas", "3 hundred boxes" → 300. */
export function parseCases(text: string): number | null {
  const m = text.match(/\b(\d{1,5})\s*(?:cs|cases?|cajas?|boxes?|ctns?|cartons?)\b/i);
  if (m) return Number(m[1]);
  const words: Record<string, number> = { cien: 100, doscientas: 200, doscientos: 200, trescientas: 300, trescientos: 300, cuatrocientas: 400, cuatrocientos: 400, quinientas: 500, quinientos: 500 };
  const w = text.toLowerCase().match(/\b(cien|dos(?:cientas|cientos)|tres(?:cientas|cientos)|cuatro(?:cientas|cientos)|quinient(?:as|os))\b/);
  return w ? words[w[1]] ?? null : null;
}

/** "$8.50", "8.50 a case", "eight fifty" is left to the model; this only parses digits. */
export function parsePrice(text: string): number | null {
  const m = text.match(/\$?\s*(\d{1,3}(?:\.\d{1,2})?)\s*(?:\/|per|a|por|each|la|the)?\s*(?:cs|case|caja|box)?\b/i);
  if (!m) return null;
  const n = Number(m[1]);
  return n > 0 && n < 500 ? n : null;
}

const WEEKDAYS_EN = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const WEEKDAYS_ES = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];
const WEEKDAYS_ES_PLAIN = ["lunes", "martes", "miercoles", "jueves", "viernes", "sabado", "domingo"];

function localDate(now: Date, timeZone: string): { y: number; m: number; d: number; weekday: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  const wd = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(get("weekday"));
  return { y: Number(get("year")), m: Number(get("month")), d: Number(get("day")), weekday: wd };
}

function isoPlusDays(y: number, m: number, d: number, add: number): string {
  const t = new Date(Date.UTC(y, m - 1, d + add));
  return t.toISOString().slice(0, 10);
}

/**
 * Turns "Monday", "el lunes", "tomorrow", "mañana", "today", "Thursday" into an ISO date
 * in the customer's time zone. A weekday means the NEXT occurrence (today counts if the
 * desk is closed, which is why "tomorrow" and weekday names never resolve to today).
 */
export function resolvePickupDate(phrase: string, now: Date, timeZone: string): string | null {
  const p = phrase.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const { y, m, d, weekday } = localDate(now, timeZone);
  if (/\b(today|hoy)\b/.test(p)) return isoPlusDays(y, m, d, 0);
  if (/\b(tomorrow|manana)\b/.test(p)) return isoPlusDays(y, m, d, 1);
  const iso = p.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (iso) return iso[1];
  for (let i = 0; i < 7; i++) {
    if (p.includes(WEEKDAYS_EN[i]) || p.includes(WEEKDAYS_ES_PLAIN[i]) || p.includes(WEEKDAYS_ES[i])) {
      let add = (i - weekday + 7) % 7;
      if (add === 0) add = 7;
      return isoPlusDays(y, m, d, add);
    }
  }
  return null;
}
