/** Calendar/time helpers. Local dates are "YYYY-MM-DD" strings; no Date-object dates leak into the model. */

import type { ISODateTime, LocalDate } from "./schema";

const pad = (n: number, w = 2) => String(Math.abs(Math.trunc(n))).padStart(w, "0");

export function deviceTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** Local calendar date of a Date in the device timezone. */
export function toLocalDate(d: Date): LocalDate {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** ISO 8601 with the device's UTC offset, e.g. 2026-11-03T09:00:00+09:00. */
export function toISOWithOffset(d: Date): ISODateTime {
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  return (
    `${toLocalDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${sign}${pad(off / 60)}:${pad(off % 60)}`
  );
}

export function nowISO(): ISODateTime {
  return toISOWithOffset(new Date());
}

export function parseLocalDate(s: LocalDate): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function isLocalDate(s: unknown): s is LocalDate {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = parseLocalDate(s);
  return toLocalDate(d) === s;
}

export function addDays(s: LocalDate, n: number): LocalDate {
  const d = parseLocalDate(s);
  d.setDate(d.getDate() + n);
  return toLocalDate(d);
}

export function addMonths(s: LocalDate, n: number): LocalDate {
  const d = parseLocalDate(s);
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  return toLocalDate(d);
}

/** Inclusive number of days between two local dates. */
export function daysBetween(a: LocalDate, b: LocalDate): number {
  const ms = parseLocalDate(b).getTime() - parseLocalDate(a).getTime();
  return Math.round(ms / 86_400_000);
}

export function eachDay(start: LocalDate, end: LocalDate): LocalDate[] {
  const out: LocalDate[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}

export function startOfWeek(s: LocalDate, weekStartsOn: 0 | 1): LocalDate {
  const dow = parseLocalDate(s).getDay();
  const diff = (dow - weekStartsOn + 7) % 7;
  return addDays(s, -diff);
}

export function startOfMonth(s: LocalDate): LocalDate {
  return s.slice(0, 8) + "01";
}

export function endOfMonth(s: LocalDate): LocalDate {
  return addDays(addMonths(startOfMonth(s), 1), -1);
}

export function today(): LocalDate {
  return toLocalDate(new Date());
}

/** "HH:MM" of an ISO instant as wall-clock time in its own offset. */
export function clockOf(iso: ISODateTime | null): string | null {
  if (!iso) return null;
  const m = /T(\d{2}):(\d{2})/.exec(iso);
  return m ? `${m[1]}:${m[2]}` : null;
}

/** Seconds between two ISO instants (b - a). */
export function secondsBetween(a: ISODateTime, b: ISODateTime): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 1000);
}

/** Build an ISO instant from a local date + "HH:MM" in the device timezone. */
export function combineLocal(date: LocalDate, hhmm: string): ISODateTime {
  const d = parseLocalDate(date);
  const [h, m] = hhmm.split(":").map(Number);
  d.setHours(h, m, 0, 0);
  return toISOWithOffset(d);
}
