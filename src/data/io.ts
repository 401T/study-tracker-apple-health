/**
 * JSON and CSV serialization.
 * - JSON is the lossless format (whole dataset, including `extra`/`extensions`).
 * - CSV is records-only; `extra` travels as a JSON column so a CSV round-trip
 *   preserves every record field.
 */

import type { StudyDataset, StudyRecord } from "./schema";
import { normalizeRecord, type Issue } from "./validate";

export function toJSON(ds: StudyDataset): string {
  return JSON.stringify(ds, null, 2);
}

export const CSV_COLUMNS = [
  "id", "date", "start_at", "end_at", "duration_sec", "duration_min", "elapsed_sec", "break_sec",
  "subject_id", "subject_name", "task_id", "task_title", "note", "source", "timezone",
  "created_at", "updated_at", "deleted_at", "extra_json",
] as const;

function cell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCSV(ds: StudyDataset, records: StudyRecord[] = ds.records): string {
  const sub = new Map(ds.subjects.map((s) => [s.id, s.name]));
  const task = new Map(ds.tasks.map((t) => [t.id, t.title]));
  const rows = records.map((r) =>
    [
      r.id, r.date, r.startAt, r.endAt, r.durationSec, Math.round((r.durationSec / 60) * 10) / 10, r.elapsedSec, r.breakSec,
      r.subjectId, r.subjectId ? sub.get(r.subjectId) ?? "" : "", r.taskId, r.taskId ? task.get(r.taskId) ?? "" : "",
      r.note, r.source, r.timezone, r.createdAt, r.updatedAt, r.deletedAt, r.extra ? JSON.stringify(r.extra) : "",
    ].map(cell).join(","),
  );
  // BOM so spreadsheet apps detect UTF-8 (Japanese text).
  return "﻿" + [CSV_COLUMNS.join(","), ...rows].join("\r\n") + "\r\n";
}

/** RFC 4180 parser (quoted fields, embedded newlines). */
export function parseCSV(text: string): string[][] {
  const s = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [], field = "", i = 0, quoted = false;
  while (i < s.length) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') { field += '"'; i += 2; continue; }
      if (c === '"') { quoted = false; i++; continue; }
      field += c; i++; continue;
    }
    if (c === '"') { quoted = true; i++; continue; }
    if (c === ",") { row.push(field); field = ""; i++; continue; }
    if (c === "\r" || c === "\n") {
      row.push(field); rows.push(row); row = []; field = "";
      i += c === "\r" && s[i + 1] === "\n" ? 2 : 1;
      continue;
    }
    field += c; i++;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/** CSV → canonical records (derived columns like subject_name are ignored). */
export function recordsFromCSV(text: string): { records: StudyRecord[]; issues: Issue[] } {
  const [header, ...rows] = parseCSV(text);
  const issues: Issue[] = [];
  if (!header) return { records: [], issues: [{ path: "csv", message: "empty file" }] };
  const col = (name: string) => header.indexOf(name);
  const num = (v: string) => (v === "" ? null : Number(v));
  const str = (v: string) => (v === "" ? null : v);
  const records: StudyRecord[] = [];
  rows.forEach((cols, i) => {
    if (cols.length === 1 && cols[0] === "") return;
    const g = (n: string) => (col(n) >= 0 ? cols[col(n)] ?? "" : "");
    let extra: Record<string, unknown> | undefined;
    try {
      extra = g("extra_json") ? JSON.parse(g("extra_json")) : undefined;
    } catch {
      issues.push({ path: `csv[${i + 1}].extra_json`, message: "invalid JSON (kept as text)" });
      extra = { __extraJsonText: g("extra_json") };
    }
    const r = normalizeRecord(
      {
        id: g("id"), date: g("date"), startAt: str(g("start_at")), endAt: str(g("end_at")),
        durationSec: num(g("duration_sec")), elapsedSec: num(g("elapsed_sec")), breakSec: num(g("break_sec")),
        subjectId: str(g("subject_id")), taskId: str(g("task_id")), note: g("note"),
        source: g("source") || "import", timezone: g("timezone") || undefined,
        createdAt: str(g("created_at")), updatedAt: str(g("updated_at")), deletedAt: str(g("deleted_at")),
        extra,
      },
      `csv[${i + 1}]`,
      issues,
    );
    if (r) records.push(r);
  });
  return { records, issues };
}
