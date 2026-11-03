/**
 * Integrity fingerprint: the numbers that must be identical before and after any
 * migration, import, export round-trip or UI swap.
 */

import type { StudyDataset, StudyRecord } from "./schema";

export interface Fingerprint {
  recordCount: number;
  activeRecordCount: number;
  totalDurationSec: number;
  bySubjectSec: Record<string, number>;
  subjectCount: number;
  taskCount: number;
  planCount: number;
  firstDate: string | null;
  lastDate: string | null;
  /** Order-independent hash over (id, date, startAt, endAt, durationSec, subjectId, taskId). */
  recordsHash: string;
}

/** FNV-1a 32-bit, hex. Deterministic and dependency-free. */
export function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export function recordKey(r: StudyRecord): string {
  return [r.id, r.date, r.startAt ?? "", r.endAt ?? "", r.durationSec, r.subjectId ?? "", r.taskId ?? ""].join("|");
}

export function fingerprint(ds: StudyDataset): Fingerprint {
  const active = ds.records.filter((r) => !r.deletedAt);
  const bySubjectSec: Record<string, number> = {};
  let total = 0;
  for (const r of active) {
    total += r.durationSec;
    const k = r.subjectId ?? "(none)";
    bySubjectSec[k] = (bySubjectSec[k] ?? 0) + r.durationSec;
  }
  const dates = ds.records.map((r) => r.date).filter(Boolean).sort();
  return {
    recordCount: ds.records.length,
    activeRecordCount: active.length,
    totalDurationSec: total,
    bySubjectSec,
    subjectCount: ds.subjects.length,
    taskCount: ds.tasks.length,
    planCount: ds.plans.length,
    firstDate: dates[0] ?? null,
    lastDate: dates[dates.length - 1] ?? null,
    recordsHash: fnv1a(ds.records.map(recordKey).sort().join("\n")),
  };
}

export interface FingerprintDiff {
  equal: boolean;
  differences: string[];
}

export function compareFingerprints(a: Fingerprint, b: Fingerprint): FingerprintDiff {
  const differences: string[] = [];
  const keys: (keyof Fingerprint)[] = [
    "recordCount", "activeRecordCount", "totalDurationSec", "subjectCount", "taskCount",
    "planCount", "firstDate", "lastDate", "recordsHash",
  ];
  for (const k of keys) if (a[k] !== b[k]) differences.push(`${k}: ${String(a[k])} → ${String(b[k])}`);
  const subj = new Set([...Object.keys(a.bySubjectSec), ...Object.keys(b.bySubjectSec)]);
  for (const s of subj)
    if ((a.bySubjectSec[s] ?? 0) !== (b.bySubjectSec[s] ?? 0))
      differences.push(`bySubjectSec[${s}]: ${a.bySubjectSec[s] ?? 0} → ${b.bySubjectSec[s] ?? 0}`);
  return { equal: differences.length === 0, differences };
}
