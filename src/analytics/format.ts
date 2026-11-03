/** Display formatting (ja-JP). One place so dates, times and units read the same everywhere. */

import { parseLocalDate, today, addDays } from "../data/time";

/** { h, m } parts — used to render numbers large and units small, Health-style. */
export function durationParts(sec: number): { h: number; m: number } {
  const totalMin = Math.round(Math.max(0, sec) / 60);
  return { h: Math.floor(totalMin / 60), m: totalMin % 60 };
}

/** "2時間15分", "45分", "0分". */
export function fmtDuration(sec: number): string {
  if (sec > 0 && sec < 30) return "1分未満";
  const { h, m } = durationParts(sec);
  if (h && m) return `${h}時間${m}分`;
  if (h) return `${h}時間`;
  return `${m}分`;
}

/** Compact "2:15" (h:mm) for axis labels and dense lists. */
export function fmtHM(sec: number): string {
  const { h, m } = durationParts(sec);
  return `${h}:${String(m).padStart(2, "0")}`;
}

/** Axis label: "0", "30分", "1時間", "1.5時間". */
export function fmtAxis(sec: number): string {
  if (sec === 0) return "0";
  if (sec < 3600) return `${Math.round(sec / 60)}分`;
  const h = sec / 3600;
  return `${Number.isInteger(h) ? h : h.toFixed(1)}時間`;
}

/** Stopwatch "01:23:45". */
export function fmtClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
}

const WD = ["日", "月", "火", "水", "木", "金", "土"];

export function weekdayShort(date: string): string {
  return WD[parseLocalDate(date).getDay()];
}

/** "11月3日(月)". With relative labels for today / yesterday when `relative`. */
export function fmtDate(date: string, opts: { relative?: boolean; year?: boolean } = {}): string {
  if (opts.relative) {
    const t = today();
    if (date === t) return "今日";
    if (date === addDays(t, -1)) return "昨日";
  }
  const d = parseLocalDate(date);
  const y = opts.year || d.getFullYear() !== parseLocalDate(today()).getFullYear() ? `${d.getFullYear()}年` : "";
  return `${y}${d.getMonth() + 1}月${d.getDate()}日(${WD[d.getDay()]})`;
}

/** "11月3日〜9日", "10月28日〜11月3日", "2025年12月〜2026年5月". */
export function fmtRange(start: string, end: string, monthly = false): string {
  const a = parseLocalDate(start), b = parseLocalDate(end);
  if (monthly) {
    const ya = a.getFullYear(), yb = b.getFullYear();
    const thisYear = parseLocalDate(today()).getFullYear();
    if (ya === yb && a.getMonth() === b.getMonth()) return `${ya}年${a.getMonth() + 1}月`;
    const left = ya === yb && ya === thisYear ? `${a.getMonth() + 1}月` : `${ya}年${a.getMonth() + 1}月`;
    const right = ya === yb && ya === thisYear ? `${b.getMonth() + 1}月` : `${yb}年${b.getMonth() + 1}月`;
    return `${left}〜${right}`;
  }
  const yr = a.getFullYear() !== parseLocalDate(today()).getFullYear() ? `${a.getFullYear()}年` : "";
  if (a.getMonth() === b.getMonth()) return `${yr}${a.getMonth() + 1}月${a.getDate()}日〜${b.getDate()}日`;
  return `${yr}${a.getMonth() + 1}月${a.getDate()}日〜${b.getMonth() + 1}月${b.getDate()}日`;
}

export function fmtPercent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

/** "+30分" / "−1時間5分" with a real minus sign. */
export function fmtSignedDuration(sec: number): string {
  if (Math.round(sec / 60) === 0) return "±0分";
  return `${sec > 0 ? "+" : "−"}${fmtDuration(Math.abs(sec))}`;
}
