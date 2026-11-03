// One place for "what time is it for this customer". Arizona has no daylight saving;
// everything else does, so every local reading goes through Intl, never arithmetic.
export type LocalParts = { weekday: number; minutes: number; hour: number; isoDate: string };

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(timeZone: string) {
  let f = fmtCache.get(timeZone);
  if (!f) { f = new Intl.DateTimeFormat("en-US", { timeZone, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short" }); fmtCache.set(timeZone, f); }
  return f;
}

/** Weekday (0 = Monday), minutes since local midnight, hour, and the local ISO date. */
export function localParts(d: Date, timeZone: string): LocalParts {
  const parts = fmt(timeZone).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  const hour = Number(get("hour")) % 24;
  return { weekday: WEEKDAYS.indexOf(get("weekday")), minutes: hour * 60 + Number(get("minute")), hour, isoDate: `${get("year")}-${get("month")}-${get("day")}` };
}

export const toMinutes = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };

/** True when the IANA name is one Intl knows. */
export function validTimeZone(tz: string): boolean {
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; }
}

/** "4x4 Vine-ripe tomatoes 25 lb": the way a line is named everywhere. */
export const itemName = (l: { size: string | null; product: string; pack: string | null }) => [l.size, l.product, l.pack].filter(Boolean).join(" ");
