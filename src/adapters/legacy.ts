/**
 * Legacy adapter: reads an EXISTING data structure (whose exact shape is not
 * known to this repository) through a declarative mapping, and can write
 * changes back into that same structure.
 *
 * Nothing here assumes Muse's real schema. The mapping is filled in by whoever
 * has inspected the real data (see docs/MUSE_MIGRATION.md, step 2).
 *
 * Guarantees (tested in tests/legacy.test.ts):
 * - Every original record becomes exactly one StudyRecord (count preserved).
 * - Original ids are kept verbatim; numeric ids are stringified and their type
 *   is remembered so write-back restores numbers.
 * - Every unmapped field is kept in `extra`; the untouched original object is
 *   kept in `extra.__legacy` so write-back reproduces it byte-for-byte when the
 *   record was not edited.
 * - Durations are converted with an explicit unit; no meaning is invented for
 *   fields the mapping does not name.
 */

import type { Extra, StudyDataset, StudyRecord, Subject, Task } from "../data/schema";
import { SUBJECT_COLORS } from "../data/schema";
import { emptyDataset, normalizeSettings } from "../data/validate";
import { fingerprint } from "../data/integrity";
import { combineLocal, deviceTimezone, isLocalDate, nowISO, toLocalDate } from "../data/time";

export type DurationUnit = "seconds" | "minutes" | "hours" | "milliseconds";

export interface LegacyMapping {
  /** Human label stored in meta.legacy.format, e.g. "muse-artifact-v0 (inspected 2026-11-05)". */
  format: string;
  /** Dot paths inside the legacy root. Use "" for "the root itself is the array". */
  paths: { records: string; subjects?: string; tasks?: string; settings?: string };
  record: {
    id: string;
    /** Field holding the local date (YYYY-MM-DD) OR an ISO date-time. */
    date?: string;
    start?: string;
    end?: string;
    /** Actual study time. If absent it is derived from start/end minus break. */
    duration?: string;
    durationUnit?: DurationUnit;
    breakDuration?: string;
    breakUnit?: DurationUnit;
    /** Field holding a subject id OR a subject name (see subjectRefIsName). */
    subject?: string;
    subjectRefIsName?: boolean;
    task?: string;
    note?: string;
    createdAt?: string;
    updatedAt?: string;
  };
  subject?: { id: string; name: string; color?: string; weeklyGoal?: string; weeklyGoalUnit?: DurationUnit };
  task?: { id: string; title: string; subject?: string; done?: string };
  /** Maps legacy settings keys → canonical settings keys (values copied as-is). */
  settings?: { dailyGoal?: string; dailyGoalUnit?: DurationUnit; theme?: string; weekStartsOn?: string };
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

export function getPath(root: unknown, path: string): unknown {
  if (!path) return root;
  return path.split(".").reduce<unknown>((o, k) => (isObj(o) || Array.isArray(o) ? (o as Obj)[k] : undefined), root);
}

function setPath(root: Obj, path: string, value: unknown) {
  const keys = path.split(".");
  let o: Obj = root;
  for (const k of keys.slice(0, -1)) {
    if (!isObj(o[k])) o[k] = {};
    o = o[k] as Obj;
  }
  o[keys[keys.length - 1]] = value;
}

const UNIT: Record<DurationUnit, number> = { seconds: 1, minutes: 60, hours: 3600, milliseconds: 0.001 };

function toSec(v: unknown, unit: DurationUnit = "seconds"): number | null {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0) return null;
  return Math.round(n * UNIT[unit]);
}

function fromSec(sec: number, unit: DurationUnit = "seconds"): number {
  const v = sec / UNIT[unit];
  return Number.isInteger(v) ? v : Math.round(v * 1000) / 1000;
}

function toInstant(v: unknown, date: string | null): string | null {
  if (typeof v === "number" && Number.isFinite(v)) return new Date(v).toISOString();
  if (typeof v !== "string" || !v) return null;
  if (/^\d{1,2}:\d{2}$/.test(v) && date) return combineLocal(date, v.padStart(5, "0"));
  return Number.isNaN(Date.parse(v)) ? null : v;
}

function toDate(v: unknown, fallbackInstant: string | null): string | null {
  if (isLocalDate(v)) return v;
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)) return v.slice(0, 10);
  if (typeof v === "number" && Number.isFinite(v)) return toLocalDate(new Date(v));
  if (fallbackInstant) return fallbackInstant.slice(0, 10);
  return null;
}

function idOf(v: unknown): { id: string; numeric: boolean } | null {
  if (typeof v === "string" && v) return { id: v, numeric: false };
  if (typeof v === "number" && Number.isFinite(v)) return { id: String(v), numeric: true };
  return null;
}

function rest(obj: Obj, used: (string | undefined)[]): Extra {
  const u = new Set(used.filter(Boolean) as string[]);
  const out: Extra = {};
  for (const [k, v] of Object.entries(obj)) if (!u.has(k)) out[k] = v;
  return out;
}

export interface LegacyImportReport {
  dataset: StudyDataset;
  problems: string[];
  sourceCounts: { records: number; subjects: number; tasks: number };
}

/** Read a legacy structure into the canonical dataset. Pure: never mutates `root`. */
export function importLegacy(root: unknown, m: LegacyMapping): LegacyImportReport {
  const ds = emptyDataset();
  const problems: string[] = [];
  const now = nowISO();
  const tz = deviceTimezone();

  // Subjects
  const subjectsRaw = m.paths.subjects ? getPath(root, m.paths.subjects) : undefined;
  const subjArr: unknown[] = Array.isArray(subjectsRaw)
    ? subjectsRaw
    : isObj(subjectsRaw) ? Object.entries(subjectsRaw).map(([k, v]) => (isObj(v) ? { __key: k, ...v } : { __key: k, __value: v })) : [];
  subjArr.forEach((raw, i) => {
    if (!isObj(raw) || !m.subject) return;
    const ref = idOf(raw[m.subject.id] ?? raw.__key);
    if (!ref) {
      problems.push(`subjects[${i}]: missing id`);
      return;
    }
    const color = m.subject.color ? raw[m.subject.color] : undefined;
    const s: Subject = {
      id: ref.id,
      name: String(raw[m.subject.name] ?? ref.id),
      color: SUBJECT_COLORS.includes(color as never) ? (color as Subject["color"]) : SUBJECT_COLORS[i % SUBJECT_COLORS.length],
      weeklyGoalSec: m.subject.weeklyGoal ? toSec(raw[m.subject.weeklyGoal], m.subject.weeklyGoalUnit) : null,
      archived: false,
      order: i,
      createdAt: now,
      updatedAt: now,
      extra: { ...rest(raw, [m.subject.id, m.subject.name, m.subject.weeklyGoal]), __legacy: raw, ...(ref.numeric ? { __idType: "number" } : {}) },
    };
    ds.subjects.push(s);
  });

  // Tasks
  const tasksRaw = m.paths.tasks ? getPath(root, m.paths.tasks) : undefined;
  (Array.isArray(tasksRaw) ? tasksRaw : []).forEach((raw, i) => {
    if (!isObj(raw) || !m.task) return;
    const ref = idOf(raw[m.task.id]);
    if (!ref) {
      problems.push(`tasks[${i}]: missing id`);
      return;
    }
    const t: Task = {
      id: ref.id,
      subjectId: m.task.subject ? idOf(raw[m.task.subject])?.id ?? null : null,
      title: String(raw[m.task.title] ?? ""),
      status: m.task.done && raw[m.task.done] === true ? "done" : "open",
      dueDate: null,
      note: "",
      createdAt: now,
      updatedAt: now,
      extra: { ...rest(raw, [m.task.id, m.task.title, m.task.subject, m.task.done]), __legacy: raw, ...(ref.numeric ? { __idType: "number" } : {}) },
    };
    ds.tasks.push(t);
  });

  // Records
  const recRaw = getPath(root, m.paths.records);
  if (!Array.isArray(recRaw)) problems.push(`records path "${m.paths.records}" is not an array`);
  const subjectByName = new Map(ds.subjects.map((s) => [s.name, s.id]));
  const rm = m.record;
  (Array.isArray(recRaw) ? recRaw : []).forEach((raw, i) => {
    if (!isObj(raw)) {
      problems.push(`records[${i}]: not an object — kept in extensions.__unreadableRecords`);
      const ext = (ds.extensions ??= {});
      const bucket = (ext.__unreadableRecords ??= []) as { index: number; value: unknown }[];
      bucket.push({ index: i, value: raw });
      return;
    }
    const ref = idOf(raw[rm.id]);
    const dateGuess = toDate(rm.date ? raw[rm.date] : undefined, null);
    const startAt = rm.start ? toInstant(raw[rm.start], dateGuess) : null;
    const date = dateGuess ?? toDate(undefined, startAt);
    let endAt = rm.end ? toInstant(raw[rm.end], date) : null;
    if (startAt && endAt && Date.parse(endAt) < Date.parse(startAt) && date) {
      // "23:30 → 00:40" style clock times: the end is on the next day.
      endAt = new Date(Date.parse(endAt) + 86_400_000).toISOString();
    }
    const breakSec = (rm.breakDuration && toSec(raw[rm.breakDuration], rm.breakUnit)) || 0;
    const elapsedSec = startAt && endAt ? Math.round((Date.parse(endAt) - Date.parse(startAt)) / 1000) : null;
    let durationSec = rm.duration ? toSec(raw[rm.duration], rm.durationUnit) : null;
    if (durationSec === null && elapsedSec !== null) durationSec = Math.max(0, elapsedSec - breakSec);
    if (!ref) problems.push(`records[${i}]: missing id (assigned legacy-index-${i})`);
    if (!date) problems.push(`records[${i}]: no usable date`);
    if (durationSec === null) problems.push(`records[${i}]: no usable duration (0 used; original kept)`);

    let subjectId: string | null = null;
    if (rm.subject && raw[rm.subject] !== undefined && raw[rm.subject] !== null && raw[rm.subject] !== "") {
      const v = raw[rm.subject];
      if (rm.subjectRefIsName) {
        const name = String(v);
        subjectId = subjectByName.get(name) ?? null;
        if (!subjectId) {
          // Name-only subjects: create a subject whose id is derived from the name, flagged as synthesized.
          subjectId = `name:${name}`;
          ds.subjects.push({
            id: subjectId, name, color: SUBJECT_COLORS[ds.subjects.length % SUBJECT_COLORS.length],
            weeklyGoalSec: null, archived: false, order: ds.subjects.length, createdAt: now, updatedAt: now,
            extra: { __synthesizedFromRecordField: rm.subject },
          });
          subjectByName.set(name, subjectId);
        }
      } else subjectId = idOf(v)?.id ?? null;
    }

    const consistent = elapsedSec === null || elapsedSec - breakSec === (durationSec ?? 0);
    const rec: StudyRecord = {
      id: ref?.id ?? `legacy-index-${i}`,
      date: date ?? "",
      timezone: tz,
      startAt,
      endAt,
      durationSec: durationSec ?? 0,
      // Keep the invariant durationSec = elapsedSec - breakSec only when the source agrees;
      // otherwise store elapsed as unknown rather than invent a break.
      elapsedSec: consistent ? elapsedSec : null,
      breakSec,
      subjectId,
      taskId: rm.task ? idOf(raw[rm.task])?.id ?? null : null,
      note: rm.note && typeof raw[rm.note] === "string" ? (raw[rm.note] as string) : "",
      source: "legacy",
      createdAt: (rm.createdAt && toInstant(raw[rm.createdAt], null)) || now,
      updatedAt: (rm.updatedAt && toInstant(raw[rm.updatedAt], null)) || now,
      deletedAt: null,
      extra: {
        ...rest(raw, [rm.id, rm.date, rm.start, rm.end, rm.duration, rm.breakDuration, rm.subject, rm.task, rm.note, rm.createdAt, rm.updatedAt]),
        __legacy: raw,
        __legacyIndex: i,
        ...(ref?.numeric ? { __idType: "number" } : {}),
        ...(consistent ? {} : { __elapsedSecFromSource: elapsedSec }),
      },
    };
    ds.records.push(rec);
  });

  // Settings
  const settingsRaw = m.paths.settings ? getPath(root, m.paths.settings) : undefined;
  if (isObj(settingsRaw) && m.settings) {
    const s = normalizeSettings({}, []);
    if (m.settings.dailyGoal) {
      const g = toSec(settingsRaw[m.settings.dailyGoal], m.settings.dailyGoalUnit);
      if (g !== null) s.dailyGoalSec = g;
    }
    if (m.settings.theme && ["system", "light", "dark"].includes(settingsRaw[m.settings.theme] as string))
      s.theme = settingsRaw[m.settings.theme] as typeof s.theme;
    if (m.settings.weekStartsOn && [0, 1].includes(settingsRaw[m.settings.weekStartsOn] as number))
      s.weekStartsOn = settingsRaw[m.settings.weekStartsOn] as 0 | 1;
    s.extra = { __legacy: settingsRaw };
    ds.settings = s;
  }

  ds.meta.legacy = { format: m.format, importedAt: now, fingerprint: "" };
  ds.meta.legacy.fingerprint = fingerprint(ds).recordsHash;
  return {
    dataset: ds,
    problems,
    sourceCounts: {
      records: Array.isArray(recRaw) ? recRaw.length : 0,
      subjects: subjArr.length,
      tasks: Array.isArray(tasksRaw) ? tasksRaw.length : 0,
    },
  };
}

/**
 * Write canonical records back into the legacy structure.
 * Returns a NEW root (deep-cloned); `root` is not mutated.
 * Unedited records are emitted from `extra.__legacy` exactly as they were.
 */
export function exportLegacy(root: unknown, ds: StudyDataset, m: LegacyMapping): unknown {
  const out = structuredClone(root) as Obj;
  const rm = m.record;
  const subjectName = new Map(ds.subjects.map((s) => [s.id, s.name]));
  // Legacy records keep their original order; records created later are appended.
  const idx = (r: StudyRecord) => (typeof r.extra?.__legacyIndex === "number" ? (r.extra.__legacyIndex as number) : Infinity);
  const records = ds.records.filter((r) => !r.deletedAt).sort((a, b) => idx(a) - idx(b));
  const arr: unknown[] = records.map((r) => {
    const legacy = isObj(r.extra?.__legacy) ? (r.extra!.__legacy as Obj) : null;
    const { __legacy, __legacyIndex, __idType, __elapsedSecFromSource, __invalid, ...unknown } = (r.extra ?? {}) as Obj;
    void __legacyIndex; void __elapsedSecFromSource; void __invalid; void __legacy;
    const o: Obj = { ...(legacy ?? {}), ...unknown };
    const put = (k: string | undefined, v: unknown) => {
      if (k) o[k] = v;
    };
    put(rm.id, __idType === "number" ? Number(r.id) : r.id);
    // Only overwrite mapped fields whose canonical value changed vs the original reading,
    // so formats like "HH:MM" or unit choices of untouched records are preserved.
    const orig = legacy ? importLegacy({ r: [legacy] }, { ...m, paths: { records: "r" } }).dataset.records[0] : null;
    if (!orig || orig.date !== r.date) put(rm.date, r.date);
    if (!orig || orig.startAt !== r.startAt) put(rm.start, r.startAt);
    if (!orig || orig.endAt !== r.endAt) put(rm.end, r.endAt);
    if (!orig || orig.durationSec !== r.durationSec) put(rm.duration, fromSec(r.durationSec, rm.durationUnit));
    if (!orig || orig.breakSec !== r.breakSec) put(rm.breakDuration, fromSec(r.breakSec, rm.breakUnit));
    if (!orig || orig.note !== r.note) put(rm.note, r.note);
    if (!orig || orig.taskId !== r.taskId) put(rm.task, r.taskId);
    if (rm.subject && (!orig || orig.subjectId !== r.subjectId)) {
      o[rm.subject] = rm.subjectRefIsName ? subjectName.get(r.subjectId ?? "") ?? null : r.subjectId;
    }
    return o;
  });
  // Re-insert items that were not readable as records, at their original positions.
  const unreadable = (ds.extensions?.__unreadableRecords ?? []) as { index: number; value: unknown }[];
  for (const u of [...unreadable].sort((a, b) => a.index - b.index)) arr.splice(u.index, 0, u.value);
  if (m.paths.records === "") return arr;
  setPath(out, m.paths.records, arr);

  // Subjects / tasks: only array-shaped legacy collections are written back.
  // Object-shaped collections are left untouched (documented in MUSE_MIGRATION.md).
  const back = <T extends { id: string; extra?: Extra }>(path: string | undefined, items: T[], fields: (it: T) => Obj) => {
    if (!path || !Array.isArray(getPath(root, path))) return;
    setPath(out, path, items.filter((it) => !it.extra?.__synthesizedFromRecordField).map((it) => {
      const legacy = isObj(it.extra?.__legacy) ? (it.extra!.__legacy as Obj) : {};
      return { ...legacy, ...fields(it) };
    }));
  };
  if (m.subject) {
    const sm = m.subject;
    // Existing items: only the user-editable name changes. New items get id/name/color.
    back(m.paths.subjects, ds.subjects, (s) =>
      isObj(s.extra?.__legacy)
        ? { [sm.name]: s.name }
        : { [sm.id]: s.id, [sm.name]: s.name, ...(sm.color ? { [sm.color]: s.color } : {}) },
    );
  }
  if (m.task) {
    const tm = m.task;
    back(m.paths.tasks, ds.tasks, (t) => ({
      ...(isObj(t.extra?.__legacy) ? {} : { [tm.id]: t.id, ...(tm.subject ? { [tm.subject]: t.subjectId } : {}) }),
      [tm.title]: t.title,
      ...(tm.done ? { [tm.done]: t.status === "done" } : {}),
    }));
  }
  return out;
}
