import { describe, expect, it } from "vitest";
import { emptyDataset } from "../src/data/validate";
import type { StudyDataset, StudyRecord } from "../src/data/schema";
import {
  bySubject, buckets, compareToPrevious, durationTicks, periodRange, planVsActual, streak, subjectChanges,
  summarizeDay, summarizePeriod, weeklyTrend,
} from "../src/analytics";
import { fmtDuration, fmtSignedDuration } from "../src/analytics/format";
import { toMarkdown } from "../src/adapters/ai-report";
import { syntheticDataset } from "../src/data/synthetic";

function rec(id: string, date: string, min: number, subjectId: string | null = "a", extra: Partial<StudyRecord> = {}): StudyRecord {
  return {
    id, date, timezone: "Asia/Tokyo", startAt: null, endAt: null, durationSec: min * 60, elapsedSec: null, breakSec: 0,
    subjectId, taskId: null, note: "", source: "manual", createdAt: "2026-01-01T00:00:00+09:00",
    updatedAt: "2026-01-01T00:00:00+09:00", deletedAt: null, ...extra,
  };
}

function ds(records: StudyRecord[]): StudyDataset {
  const d = emptyDataset();
  d.settings.dailyGoalSec = 3600;
  d.subjects = [
    { id: "a", name: "数学", color: "blue", weeklyGoalSec: null, archived: false, order: 0, createdAt: "", updatedAt: "" },
    { id: "b", name: "英語", color: "orange", weeklyGoalSec: null, archived: false, order: 1, createdAt: "", updatedAt: "" },
  ];
  d.records = records;
  return d;
}

describe("aggregation", () => {
  const d = ds([
    rec("1", "2026-11-02", 30), rec("2", "2026-11-02", 45, "b"), rec("3", "2026-11-03", 90),
    rec("4", "2026-11-03", 20, null), rec("5", "2026-11-03", 999, "a", { deletedAt: "2026-11-03T00:00:00+09:00" }),
  ]);

  it("daily summary excludes deleted records and computes goal ratio", () => {
    const s = summarizeDay(d, "2026-11-03");
    expect(s.totalSec).toBe(110 * 60);
    expect(s.goalRatio).toBeCloseTo(110 / 60);
  });

  it("subject shares add up to the total", () => {
    const s = bySubject(d, "2026-11-01", "2026-11-03");
    expect(s.reduce((a, b) => a + b.sec, 0)).toBe(185 * 60);
    expect(s.reduce((a, b) => a + b.share, 0)).toBeCloseTo(1);
    expect(s.find((x) => x.subjectId === "(none)")?.name).toBe("科目なし");
  });

  it("period summary averages over elapsed days only", () => {
    const p = summarizePeriod(d, "2026-11-02", "2026-11-08", "2026-11-03");
    expect(p.totalSec).toBe(185 * 60);
    expect(p.avgPerDaySec).toBe(Math.round((185 * 60) / 2));
    expect(p.daysGoalMet).toBe(2);
    expect(p.activeDays).toBe(2);
  });

  it("period ranges respect week start", () => {
    expect(periodRange("week", "2026-11-03", 1)).toEqual({ start: "2026-11-02", end: "2026-11-08" });
    expect(periodRange("week", "2026-11-03", 0)).toEqual({ start: "2026-11-01", end: "2026-11-07" });
    expect(periodRange("month", "2026-02-10", 1)).toEqual({ start: "2026-02-01", end: "2026-02-28" });
  });

  it("buckets sum to the period total", () => {
    const syn = syntheticDataset({ end: "2026-11-03" });
    const { start, end } = periodRange("halfyear", "2026-11-03", 1);
    const b = buckets(syn, "halfyear", start, end, 1);
    // half-year buckets are whole weeks and may extend before `start`: compare on the covered range
    const covered = summarizePeriod(syn, b[0].start, b[b.length - 1].end).totalSec;
    expect(b.reduce((a, x) => a + x.sec, 0)).toBe(covered);
  });

  it("streak counts consecutive days, keeping today's pending streak alive", () => {
    const s = streak(ds([rec("1", "2026-10-30", 10), rec("2", "2026-10-31", 10), rec("3", "2026-11-01", 10), rec("4", "2026-11-02", 10)]), "2026-11-03");
    expect(s).toEqual({ current: 4, longest: 4, pendingToday: true });
  });

  it("compareToPrevious compares the same number of elapsed days", () => {
    const c = compareToPrevious(ds([rec("1", "2026-10-26", 60), rec("2", "2026-10-29", 60), rec("3", "2026-11-02", 30)]), "2026-11-02", "2026-11-08", "2026-11-03");
    expect(c.prevStart).toBe("2026-10-26");
    expect(c.prevEnd).toBe("2026-10-27");
    expect(c.previousSec).toBe(3600);
    expect(c.deltaSec).toBe(-1800);
  });

  it("detects a declining subject", () => {
    const recs: StudyRecord[] = [];
    for (let i = 0; i < 28; i++) {
      const date = new Date(2026, 9, 6 + i);
      const ds_ = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
      recs.push(rec(`e${i}`, ds_, i < 14 ? 60 : 10, "b"));
    }
    const ch = subjectChanges(ds(recs), 14, "2026-11-03");
    expect(ch[0].subjectId).toBe("b");
    expect(ch[0].deltaSec).toBeLessThan(0);
  });

  it("plan vs actual uses only records in the plan's period and subject", () => {
    const d2 = ds([rec("1", "2026-11-02", 60), rec("2", "2026-11-02", 60, "b"), rec("3", "2026-11-09", 60)]);
    d2.plans = [{ id: "p", periodStart: "2026-11-02", periodEnd: "2026-11-08", subjectId: "a", plannedSec: 7200, note: "", createdAt: "", updatedAt: "" }];
    expect(planVsActual(d2, "2026-11-01", "2026-11-30", "2026-11-03")[0]).toMatchObject({ actualSec: 3600, ratio: 0.5, inProgress: true });
  });

  it("weekly trend excludes the current week from the slope", () => {
    const syn = syntheticDataset({ end: "2026-11-03" });
    const t = weeklyTrend(syn, 8, "2026-11-03");
    expect(t.weeks).toHaveLength(8);
    expect(t.method).toContain("7");
  });

  it("axis ticks start at zero and cover the max", () => {
    const t = durationTicks(5 * 3600 + 100);
    expect(t.ticks[0]).toBe(0);
    expect(t.max).toBeGreaterThanOrEqual(5 * 3600 + 100);
  });
});

describe("formatting", () => {
  it("formats durations in Japanese", () => {
    expect(fmtDuration(8100)).toBe("2時間15分");
    expect(fmtDuration(2700)).toBe("45分");
    expect(fmtSignedDuration(-1800)).toBe("−30分");
    expect(fmtDuration(4)).toBe("1分未満");
    expect(fmtDuration(0)).toBe("0分");
  });
});

describe("AI markdown report", () => {
  it("contains units, provenance labels and every record id in range", () => {
    const syn = syntheticDataset({ end: "2026-11-03", days: 20 });
    const md = toMarkdown(syn, { asOf: "2026-11-03", start: "2026-10-14", end: "2026-11-03" });
    expect(md).toContain("単位はすべて **分**");
    expect(md).toContain("実測(タイマー)");
    for (const r of syn.records.filter((r) => r.date >= "2026-10-14")) expect(md).toContain(r.id);
  });
});
