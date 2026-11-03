// The customer's opening hours and the off-hours window, in their time zone.
import { localParts, toMinutes } from "./time";

export type DayHours = { open: string; close: string; closed: boolean };
export type Hours = Record<string, DayHours>; // keys: mon tue wed thu fri sat sun

export const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

const dayFor = (hours: Hours, weekday: number, isoDate: string, holidays: string[]) => {
  const day = hours[DAY_KEYS[weekday]];
  return !day || day.closed || holidays.includes(isoDate) ? null : day;
};

/** True when the desk is open: a non-closed, non-holiday day, between open and close. */
export function isOpen(now: Date, hours: Hours, timeZone: string, holidays: string[] = []): boolean {
  const { weekday, minutes, isoDate } = localParts(now, timeZone);
  const day = dayFor(hours, weekday, isoDate, holidays);
  return day != null && minutes >= toMinutes(day.open) && minutes < toMinutes(day.close);
}

export const isOffHours = (now: Date, hours: Hours, timeZone: string, holidays: string[] = []) => !isOpen(now, hours, timeZone, holidays);

const MINUTE = 60 * 1000;
const WEEK_MINUTES = 8 * 24 * 60;

/** The next opening instant after `now`, used for rule expiry and the morning summary. Throws only when no day is open at all. */
export function nextOpening(now: Date, hours: Hours, timeZone: string, holidays: string[] = []): Date {
  let t = new Date(Math.floor(now.getTime() / MINUTE) * MINUTE + MINUTE);
  for (let i = 0; i < WEEK_MINUTES; i++, t = new Date(t.getTime() + MINUTE)) {
    const { weekday, minutes, isoDate } = localParts(t, timeZone);
    const day = dayFor(hours, weekday, isoDate, holidays);
    if (day && minutes === toMinutes(day.open)) return t;
  }
  throw new Error("No opening in the next week; check the hours settings");
}

/** The closing instant before `at`, walking back over closed days and holidays. */
export function previousClosing(at: Date, hours: Hours, timeZone: string, holidays: string[] = []): Date {
  let t = new Date(Math.floor(at.getTime() / MINUTE) * MINUTE - MINUTE);
  for (let i = 0; i < WEEK_MINUTES; i++, t = new Date(t.getTime() - MINUTE)) {
    const { weekday, minutes, isoDate } = localParts(t, timeZone);
    const day = dayFor(hours, weekday, isoDate, holidays);
    if (day && minutes === toMinutes(day.close)) return t;
  }
  throw new Error("No closing in the past week; check the hours settings");
}

/** "06:50" → "06:45": settings are kept on a 15-minute grid so every clock in the app agrees. */
export const snapToQuarter = (hhmm: string) => {
  const m = hhmm.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return "06:00";
  const total = Math.min(23 * 60 + 45, Math.round((Number(m[1]) * 60 + Number(m[2])) / 15) * 15);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
};

export const DEFAULT_HOURS: Hours = {
  mon: { open: "06:00", close: "17:00", closed: false }, tue: { open: "06:00", close: "17:00", closed: false },
  wed: { open: "06:00", close: "17:00", closed: false }, thu: { open: "06:00", close: "17:00", closed: false },
  fri: { open: "06:00", close: "17:00", closed: false }, sat: { open: "06:00", close: "12:00", closed: true },
  sun: { open: "06:00", close: "12:00", closed: true },
};
