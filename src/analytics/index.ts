/**
 * Pure aggregation functions. Inputs: a dataset and local dates. No I/O, no Date.now()
 * unless a date is omitted. Every value here is COMPUTED from records — callers
 * (UI, AI agent API) must present it as such, not as a measurement.
 */

import type { StudyDataset, StudyRecord, Subject } from "../data/schema";
import {
  addDays, addMonths, daysBetween, eachDay, endOfMonth, startOfMonth, startOfWeek, today,
} from "../data/time";

export const NO_SUBJECT = "(none)";

export function activeRecords(ds: StudyDataset): StudyRecord[] {
  return ds.records.filter((r) => !r.deletedAt && r.date);
}

export function recordsInRange(ds: StudyDataset, start: string, end: string): StudyRecord[] {
  return activeRecords(ds)
    .filter((r) => r.date >= start && r.date <= end)
    .sort((a, b) => (a.date + (a.startAt ?? "")).localeCompare(b.date + (b.startAt ?? "")));
}

export interface DayTotal {
  date: string;
  sec: number;
}

export function dailyTotals(ds: StudyDataset, start: string, end: string): DayTotal[] {
  const map = new Map<string, number>(eachDay(start, end).map((d) => [d, 0]));
  for (const r of recordsInRange(ds, start, end)) map.set(r.date, (map.get(r.date) ?? 0) + r.durationSec);
  return [...map].map(([date, sec]) => ({ date, sec }));
}

export interface SubjectShare {
  subjectId: string;
  name: string;
  color: Subject["color"] | "gray";
  sec: number;
  /** 0..1 of the period total; 0 when total is 0. */
  share: number;
  recordCount: number;
}

export function subjectName(ds: StudyDataset, id: string | null): string {
  if (!id) return "科目なし";
  return ds.subjects.find((s) => s.id === id)?.name ?? `不明な科目 (${id})`;
}

export function bySubject(ds: StudyDataset, start: string, end: string): SubjectShare[] {
  const recs = recordsInRange(ds, start, end);
  const total = recs.reduce((s, r) => s + r.durationSec, 0);
  const map = new Map<string, { sec: number; n: number }>();
  for (const r of recs) {
    const k = r.subjectId ?? NO_SUBJECT;
    const v = map.get(k) ?? { sec: 0, n: 0 };
    v.sec += r.durationSec;
    v.n++;
    map.set(k, v);
  }
  return [...map]
    .map(([id, v]) => {
      const s = ds.subjects.find((x) => x.id === id);
      return {
        subjectId: id,
        name: id === NO_SUBJECT ? "科目なし" : s?.name ?? `不明な科目 (${id})`,
        color: s?.color ?? ("gray" as const),
        sec: v.sec,
        share: total ? v.sec / total : 0,
        recordCount: v.n,
      };
    })
    .sort((a, b) => b.sec - a.sec);
}

export interface PeriodSummary {
  start: string;
  end: string;
  days: number;
  totalSec: number;
  /** total / number of calendar days in the period (elapsed days only, if the period includes the future). */
  avgPerDaySec: number;
  activeDays: number;
  recordCount: number;
  goalSec: number;
  daysGoalMet: number;
  bestDay: DayTotal | null;
  daily: DayTotal[];
  bySubject: SubjectShare[];
}

export function summarizePeriod(ds: StudyDataset, start: string, end: string, asOf = today()): PeriodSummary {
  const daily = dailyTotals(ds, start, end);
  const elapsed = daily.filter((d) => d.date <= asOf);
  const totalSec = daily.reduce((s, d) => s + d.sec, 0);
  const goal = ds.settings.dailyGoalSec;
  const best = daily.reduce<DayTotal | null>((b, d) => (d.sec > (b?.sec ?? 0) ? d : b), null);
  return {
    start,
    end,
    days: daily.length,
    totalSec,
    avgPerDaySec: elapsed.length ? Math.round(totalSec / elapsed.length) : 0,
    activeDays: daily.filter((d) => d.sec > 0).length,
    recordCount: recordsInRange(ds, start, end).length,
    goalSec: goal,
    daysGoalMet: goal > 0 ? daily.filter((d) => d.sec >= goal).length : 0,
    bestDay: best,
    daily,
    bySubject: bySubject(ds, start, end),
  };
}

export interface DaySummary {
  date: string;
  totalSec: number;
  goalSec: number;
  /** total / goal, uncapped (1.2 = 120%). null when no goal is set. */
  goalRatio: number | null;
  records: StudyRecord[];
  bySubject: SubjectShare[];
}

export function summarizeDay(ds: StudyDataset, date = today()): DaySummary {
  const records = recordsInRange(ds, date, date);
  const totalSec = records.reduce((s, r) => s + r.durationSec, 0);
  const goalSec = ds.settings.dailyGoalSec;
  return { date, totalSec, goalSec, goalRatio: goalSec > 0 ? totalSec / goalSec : null, records, bySubject: bySubject(ds, date, date) };
}

export type PeriodKind = "week" | "month" | "halfyear" | "year";

/** Range for a period kind containing `anchor`. */
export function periodRange(kind: PeriodKind, anchor: string, weekStartsOn: 0 | 1): { start: string; end: string } {
  switch (kind) {
    case "week": {
      const start = startOfWeek(anchor, weekStartsOn);
      return { start, end: addDays(start, 6) };
    }
    case "month":
      return { start: startOfMonth(anchor), end: endOfMonth(anchor) };
    case "halfyear": {
      const end = endOfMonth(anchor);
      return { start: startOfMonth(addMonths(anchor, -5)), end };
    }
    case "year": {
      const end = endOfMonth(anchor);
      return { start: startOfMonth(addMonths(anchor, -11)), end };
    }
  }
}

export function shiftAnchor(kind: PeriodKind, anchor: string, dir: -1 | 1): string {
  switch (kind) {
    case "week": return addDays(anchor, 7 * dir);
    case "month": return addMonths(anchor, dir);
    case "halfyear": return addMonths(anchor, 6 * dir);
    case "year": return addMonths(anchor, 12 * dir);
  }
}

export interface Bucket {
  key: string;
  start: string;
  end: string;
  sec: number;
}

/** Chart buckets: days for week/month, weeks for half-year, months for year. */
export function buckets(ds: StudyDataset, kind: PeriodKind, start: string, end: string, weekStartsOn: 0 | 1): Bucket[] {
  const daily = dailyTotals(ds, start, end);
  if (kind === "week" || kind === "month") return daily.map((d) => ({ key: d.date, start: d.date, end: d.date, sec: d.sec }));
  const out: Bucket[] = [];
  if (kind === "halfyear") {
    for (let s = startOfWeek(start, weekStartsOn); s <= end; s = addDays(s, 7)) {
      const e = addDays(s, 6);
      out.push({ key: s, start: s, end: e, sec: daily.filter((d) => d.date >= s && d.date <= e).reduce((a, d) => a + d.sec, 0) });
    }
    return out;
  }
  for (let s = start; s <= end; s = addMonths(s, 1)) {
    const e = endOfMonth(s);
    out.push({ key: s.slice(0, 7), start: s, end: e, sec: daily.filter((d) => d.date >= s && d.date <= e).reduce((a, d) => a + d.sec, 0) });
  }
  return out;
}

export interface Comparison {
  currentSec: number;
  previousSec: number;
  deltaSec: number;
  /** null when previous is 0 (percentage undefined). */
  deltaRatio: number | null;
}

export function compare(currentSec: number, previousSec: number): Comparison {
  return { currentSec, previousSec, deltaSec: currentSec - previousSec, deltaRatio: previousSec > 0 ? (currentSec - previousSec) / previousSec : null };
}

/** Period-to-date comparison: this period so far vs the same number of days of the previous period. */
export function compareToPrevious(ds: StudyDataset, start: string, end: string, asOf = today()): Comparison & { prevStart: string; prevEnd: string } {
  const len = daysBetween(start, end) + 1;
  const prevStart = addDays(start, -len);
  const cutoff = asOf < end ? asOf : end;
  const elapsed = Math.max(0, daysBetween(start, cutoff) + 1);
  const prevEnd = addDays(prevStart, elapsed - 1);
  const cur = summarizePeriod(ds, start, cutoff, asOf).totalSec;
  const prev = elapsed > 0 ? summarizePeriod(ds, prevStart, prevEnd, asOf).totalSec : 0;
  return { ...compare(cur, prev), prevStart, prevEnd };
}

export interface Streak {
  current: number;
  longest: number;
  /** True if today has no record yet but yesterday does (streak still alive). */
  pendingToday: boolean;
}

export function streak(ds: StudyDataset, asOf = today()): Streak {
  const days = new Set(activeRecords(ds).filter((r) => r.durationSec > 0).map((r) => r.date));
  const sorted = [...days].sort();
  let longest = 0, run = 0, prev: string | null = null;
  for (const d of sorted) {
    run = prev && addDays(prev, 1) === d ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = d;
  }
  let current = 0;
  let cursor = days.has(asOf) ? asOf : addDays(asOf, -1);
  while (days.has(cursor)) {
    current++;
    cursor = addDays(cursor, -1);
  }
  return { current, longest, pendingToday: !days.has(asOf) && current > 0 };
}

export interface WeeklyTrend {
  weeks: Bucket[];
  /** Least-squares slope in seconds per week. */
  slopeSecPerWeek: number;
  direction: "up" | "down" | "flat";
  method: string;
}

export function weeklyTrend(ds: StudyDataset, weeks = 8, asOf = today()): WeeklyTrend {
  const ws = ds.settings.weekStartsOn;
  const lastStart = startOfWeek(asOf, ws);
  const list: Bucket[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const s = addDays(lastStart, -7 * i);
    const e = addDays(s, 6);
    list.push({ key: s, start: s, end: e, sec: summarizePeriod(ds, s, e, asOf).totalSec });
  }
  // Exclude the current (incomplete) week from the slope.
  const complete = list.slice(0, -1);
  const n = complete.length;
  let slope = 0;
  if (n >= 2) {
    const mx = (n - 1) / 2;
    const my = complete.reduce((a, b) => a + b.sec, 0) / n;
    let num = 0, den = 0;
    complete.forEach((b, i) => {
      num += (i - mx) * (b.sec - my);
      den += (i - mx) ** 2;
    });
    slope = den ? num / den : 0;
  }
  const mean = n ? complete.reduce((a, b) => a + b.sec, 0) / n : 0;
  const direction = Math.abs(slope) < Math.max(600, mean * 0.05) ? "flat" : slope > 0 ? "up" : "down";
  return {
    weeks: list,
    slopeSecPerWeek: Math.round(slope),
    direction,
    method: `least-squares linear fit over the ${n} most recent complete weeks (current week excluded)`,
  };
}

export interface SubjectChange {
  subjectId: string;
  name: string;
  recentSec: number;
  previousSec: number;
  deltaSec: number;
  deltaRatio: number | null;
}

/** Last `windowDays` vs the `windowDays` before that, per subject (complete days only, ending yesterday). */
export function subjectChanges(ds: StudyDataset, windowDays = 14, asOf = today()): SubjectChange[] {
  const end = addDays(asOf, -1);
  const start = addDays(end, -(windowDays - 1));
  const pEnd = addDays(start, -1);
  const pStart = addDays(pEnd, -(windowDays - 1));
  const cur = new Map(bySubject(ds, start, end).map((s) => [s.subjectId, s]));
  const prev = new Map(bySubject(ds, pStart, pEnd).map((s) => [s.subjectId, s]));
  const ids = new Set([...cur.keys(), ...prev.keys()]);
  return [...ids]
    .map((id) => {
      const c = cur.get(id)?.sec ?? 0, p = prev.get(id)?.sec ?? 0;
      return { subjectId: id, name: cur.get(id)?.name ?? prev.get(id)!.name, recentSec: c, previousSec: p, ...(({ deltaSec, deltaRatio }) => ({ deltaSec, deltaRatio }))(compare(c, p)) };
    })
    .sort((a, b) => a.deltaSec - b.deltaSec);
}

export interface PlanVsActualRow {
  planId: string;
  periodStart: string;
  periodEnd: string;
  subjectId: string | null;
  name: string;
  plannedSec: number;
  actualSec: number;
  /** actual / planned; null when planned is 0. */
  ratio: number | null;
  /** True when the period has not ended yet as of `asOf`. */
  inProgress: boolean;
}

export function planVsActual(ds: StudyDataset, start: string, end: string, asOf = today()): PlanVsActualRow[] {
  return ds.plans
    .filter((p) => p.periodEnd >= start && p.periodStart <= end)
    .map((p) => {
      const recs = recordsInRange(ds, p.periodStart, p.periodEnd).filter((r) => p.subjectId === null || r.subjectId === p.subjectId);
      const actualSec = recs.reduce((s, r) => s + r.durationSec, 0);
      return {
        planId: p.id,
        periodStart: p.periodStart,
        periodEnd: p.periodEnd,
        subjectId: p.subjectId,
        name: p.subjectId ? subjectName(ds, p.subjectId) : "全体",
        plannedSec: p.plannedSec,
        actualSec,
        ratio: p.plannedSec > 0 ? actualSec / p.plannedSec : null,
        inProgress: p.periodEnd >= asOf,
      };
    })
    .sort((a, b) => a.periodStart.localeCompare(b.periodStart) || a.name.localeCompare(b.name));
}

/** Nice axis maximum + ticks for durations, in seconds (steps of 15m/30m/1h/2h/…). */
export function durationTicks(maxSec: number, target = 4): { max: number; ticks: number[] } {
  const steps = [900, 1800, 3600, 7200, 10800, 14400, 21600, 36000, 72000, 144000, 360000];
  const raw = Math.max(maxSec, 1) / target;
  const step = steps.find((s) => s >= raw) ?? Math.ceil(raw / 360000) * 360000;
  const max = Math.max(step, Math.ceil(maxSec / step) * step);
  const ticks: number[] = [];
  for (let v = 0; v <= max; v += step) ticks.push(v);
  return { max, ticks };
}
