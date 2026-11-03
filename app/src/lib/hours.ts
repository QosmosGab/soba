// The customer's opening hours and the off-hours window, in their time zone.
export type DayHours = { open: string; close: string; closed: boolean };
export type Hours = Record<string, DayHours>; // keys: mon tue wed thu fri sat sun

export const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

function localParts(now: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short" }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  const weekday = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(get("weekday"));
  const hour = Number(get("hour")) % 24;
  return { weekday, minutes: hour * 60 + Number(get("minute")), isoDate: `${get("year")}-${get("month")}-${get("day")}` };
}

const toMin = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };

/** True when the desk is open: a non-closed, non-holiday day, between open and close. */
export function isOpen(now: Date, hours: Hours, timeZone: string, holidays: string[] = []): boolean {
  const { weekday, minutes, isoDate } = localParts(now, timeZone);
  if (holidays.includes(isoDate)) return false;
  const day = hours[DAY_KEYS[weekday]];
  if (!day || day.closed) return false;
  return minutes >= toMin(day.open) && minutes < toMin(day.close);
}

export const isOffHours = (now: Date, hours: Hours, timeZone: string, holidays: string[] = []) => !isOpen(now, hours, timeZone, holidays);

/** The next opening instant after `now`, used for rule expiry and the morning summary. */
export function nextOpening(now: Date, hours: Hours, timeZone: string, holidays: string[] = []): Date {
  // Walk forward minute by minute in 15-minute steps up to 8 days; simple and correct across DST.
  const step = 15 * 60 * 1000;
  let t = new Date(Math.floor(now.getTime() / step) * step + step);
  for (let i = 0; i < 8 * 24 * 4; i++, t = new Date(t.getTime() + step)) {
    const { weekday, minutes, isoDate } = localParts(t, timeZone);
    const day = hours[DAY_KEYS[weekday]];
    if (!day || day.closed || holidays.includes(isoDate)) continue;
    if (minutes === toMin(day.open)) return t;
  }
  throw new Error("No opening found in the next 8 days; check the hours settings");
}

export const DEFAULT_HOURS: Hours = {
  mon: { open: "06:00", close: "17:00", closed: false }, tue: { open: "06:00", close: "17:00", closed: false },
  wed: { open: "06:00", close: "17:00", closed: false }, thu: { open: "06:00", close: "17:00", closed: false },
  fri: { open: "06:00", close: "17:00", closed: false }, sat: { open: "06:00", close: "12:00", closed: true },
  sun: { open: "06:00", close: "12:00", closed: true },
};
