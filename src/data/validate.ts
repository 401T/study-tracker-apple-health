/**
 * Normalization of canonical-format data (e.g. a JSON export being re-imported).
 *
 * Rules:
 * - Known fields are type-checked; invalid values are reported as issues, and the
 *   ORIGINAL value is kept in `extra.__invalid` rather than silently discarded.
 * - Unknown fields are moved into `extra` — never dropped.
 * - Ids are kept verbatim (stringified only if they were numbers; the original
 *   type is remembered in `extra.__idType`).
 */

import {
  DEFAULT_SETTINGS, SCHEMA_ID, SCHEMA_VERSION, SUBJECT_COLORS,
  type ActiveSession, type Extra, type Settings, type StudyDataset, type StudyPlan,
  type StudyRecord, type Subject, type Task,
} from "./schema";
import { deviceTimezone, isLocalDate, nowISO } from "./time";

export interface Issue {
  path: string;
  message: string;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

class Reader {
  constructor(private src: Obj, private path: string, private issues: Issue[]) {}
  private used = new Set<string>(["extra"]);
  private invalid: Obj = {};

  private take(k: string): unknown {
    this.used.add(k);
    return this.src[k];
  }
  private bad(k: string, v: unknown, msg: string) {
    if (v !== undefined) this.invalid[k] = v;
    this.issues.push({ path: `${this.path}.${k}`, message: msg });
  }
  id(k = "id"): string {
    const v = this.take(k);
    if (typeof v === "string" && v) return v;
    if (typeof v === "number" && Number.isFinite(v)) {
      this.invalid.__idType = "number";
      return String(v);
    }
    this.bad(k, v, "missing id");
    return "";
  }
  str(k: string, fallback = ""): string {
    const v = this.take(k);
    if (typeof v === "string") return v;
    if (v === undefined || v === null) return fallback;
    this.bad(k, v, "expected string");
    return fallback;
  }
  strOrNull(k: string): string | null {
    const v = this.take(k);
    if (v === undefined || v === null || v === "") return null;
    if (typeof v === "string") return v;
    if (typeof v === "number") return String(v);
    this.bad(k, v, "expected string or null");
    return null;
  }
  date(k: string): string {
    const v = this.take(k);
    if (isLocalDate(v)) return v;
    this.bad(k, v, "expected YYYY-MM-DD");
    return "";
  }
  dateOrNull(k: string): string | null {
    const v = this.take(k);
    if (v === undefined || v === null || v === "") return null;
    if (isLocalDate(v)) return v;
    this.bad(k, v, "expected YYYY-MM-DD or null");
    return null;
  }
  instantOrNull(k: string): string | null {
    const v = this.take(k);
    if (v === undefined || v === null || v === "") return null;
    if (typeof v === "string" && !Number.isNaN(Date.parse(v))) return v;
    this.bad(k, v, "expected ISO 8601 date-time or null");
    return null;
  }
  instant(k: string, fallback: string): string {
    return this.instantOrNull(k) ?? fallback;
  }
  sec(k: string, fallback = 0): number {
    const v = this.take(k);
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) return Math.round(v);
    if (v === undefined || v === null) return fallback;
    this.bad(k, v, "expected non-negative number of seconds");
    return fallback;
  }
  secOrNull(k: string): number | null {
    const v = this.take(k);
    if (v === undefined || v === null) return null;
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) return Math.round(v);
    this.bad(k, v, "expected non-negative seconds or null");
    return null;
  }
  bool(k: string, fallback = false): boolean {
    const v = this.take(k);
    if (typeof v === "boolean") return v;
    if (v === undefined || v === null) return fallback;
    this.bad(k, v, "expected boolean");
    return fallback;
  }
  num(k: string, fallback = 0): number {
    const v = this.take(k);
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (v === undefined || v === null) return fallback;
    this.bad(k, v, "expected number");
    return fallback;
  }
  oneOf<T extends string | number>(k: string, allowed: readonly T[], fallback: T): T {
    const v = this.take(k);
    if (allowed.includes(v as T)) return v as T;
    if (v !== undefined && v !== null) this.bad(k, v, `expected one of ${allowed.join(", ")}`);
    return fallback;
  }
  /** Everything not consumed: previous extra + unknown keys + invalid originals. */
  extra(): Extra | undefined {
    const out: Extra = isObj(this.src.extra) ? { ...this.src.extra } : {};
    for (const [k, v] of Object.entries(this.src)) if (!this.used.has(k)) out[k] = v;
    if (Object.keys(this.invalid).length) {
      const { __idType, ...rest } = this.invalid;
      if (__idType) out.__idType = __idType;
      if (Object.keys(rest).length) out.__invalid = { ...(out.__invalid as Obj | undefined), ...rest };
    }
    return Object.keys(out).length ? out : undefined;
  }
}

function withExtra<T extends object>(base: T, extra: Extra | undefined): T & { extra?: Extra } {
  return extra ? { ...base, extra } : base;
}

export function normalizeRecord(raw: unknown, path: string, issues: Issue[]): StudyRecord | null {
  if (!isObj(raw)) {
    issues.push({ path, message: "record is not an object" });
    return null;
  }
  const r = new Reader(raw, path, issues);
  const now = nowISO();
  const rec: StudyRecord = {
    id: r.id(),
    date: r.date("date"),
    timezone: r.str("timezone", deviceTimezone()),
    startAt: r.instantOrNull("startAt"),
    endAt: r.instantOrNull("endAt"),
    durationSec: r.sec("durationSec"),
    elapsedSec: r.secOrNull("elapsedSec"),
    breakSec: r.sec("breakSec"),
    subjectId: r.strOrNull("subjectId"),
    taskId: r.strOrNull("taskId"),
    note: r.str("note"),
    source: r.oneOf("source", ["timer", "manual", "import", "legacy", "agent"] as const, "import"),
    createdAt: r.instant("createdAt", now),
    updatedAt: r.instant("updatedAt", now),
    deletedAt: r.instantOrNull("deletedAt"),
  };
  return withExtra(rec, r.extra());
}

export function normalizeSubject(raw: unknown, path: string, issues: Issue[], index: number): Subject | null {
  if (!isObj(raw)) {
    issues.push({ path, message: "subject is not an object" });
    return null;
  }
  const r = new Reader(raw, path, issues);
  const now = nowISO();
  const s: Subject = {
    id: r.id(),
    name: r.str("name", "(名称なし)"),
    color: r.oneOf("color", SUBJECT_COLORS, SUBJECT_COLORS[index % SUBJECT_COLORS.length]),
    weeklyGoalSec: r.secOrNull("weeklyGoalSec"),
    archived: r.bool("archived"),
    order: r.num("order", index),
    createdAt: r.instant("createdAt", now),
    updatedAt: r.instant("updatedAt", now),
  };
  return withExtra(s, r.extra());
}

export function normalizeTask(raw: unknown, path: string, issues: Issue[]): Task | null {
  if (!isObj(raw)) {
    issues.push({ path, message: "task is not an object" });
    return null;
  }
  const r = new Reader(raw, path, issues);
  const now = nowISO();
  const t: Task = {
    id: r.id(),
    subjectId: r.strOrNull("subjectId"),
    title: r.str("title"),
    status: r.oneOf("status", ["open", "done"] as const, "open"),
    dueDate: r.dateOrNull("dueDate"),
    note: r.str("note"),
    createdAt: r.instant("createdAt", now),
    updatedAt: r.instant("updatedAt", now),
  };
  return withExtra(t, r.extra());
}

export function normalizePlan(raw: unknown, path: string, issues: Issue[]): StudyPlan | null {
  if (!isObj(raw)) {
    issues.push({ path, message: "plan is not an object" });
    return null;
  }
  const r = new Reader(raw, path, issues);
  const now = nowISO();
  const p: StudyPlan = {
    id: r.id(),
    periodStart: r.date("periodStart"),
    periodEnd: r.date("periodEnd"),
    subjectId: r.strOrNull("subjectId"),
    plannedSec: r.sec("plannedSec"),
    note: r.str("note"),
    createdAt: r.instant("createdAt", now),
    updatedAt: r.instant("updatedAt", now),
  };
  return withExtra(p, r.extra());
}

export function normalizeSettings(raw: unknown, issues: Issue[]): Settings {
  if (!isObj(raw)) return { ...DEFAULT_SETTINGS };
  const r = new Reader(raw, "settings", issues);
  const s: Settings = {
    theme: r.oneOf("theme", ["system", "light", "dark"] as const, DEFAULT_SETTINGS.theme),
    glass: r.oneOf("glass", ["standard", "reduced"] as const, DEFAULT_SETTINGS.glass),
    dailyGoalSec: r.sec("dailyGoalSec", DEFAULT_SETTINGS.dailyGoalSec),
    weekStartsOn: r.oneOf("weekStartsOn", [0, 1] as const, DEFAULT_SETTINGS.weekStartsOn),
  };
  return withExtra(s, r.extra());
}

function normalizeActive(raw: unknown, issues: Issue[]): ActiveSession | null {
  if (!isObj(raw)) return null;
  if (typeof raw.startedAt !== "string" || Number.isNaN(Date.parse(raw.startedAt))) {
    issues.push({ path: "activeSession", message: "invalid startedAt; session ignored" });
    return null;
  }
  const breaks = Array.isArray(raw.breaks)
    ? raw.breaks.filter(isObj).map((b) => ({
        start: String(b.start),
        end: typeof b.end === "string" ? b.end : null,
      }))
    : [];
  return {
    startedAt: raw.startedAt,
    subjectId: typeof raw.subjectId === "string" ? raw.subjectId : null,
    taskId: typeof raw.taskId === "string" ? raw.taskId : null,
    note: typeof raw.note === "string" ? raw.note : "",
    breaks,
  };
}

const KNOWN_TOP = new Set([
  "schema", "schemaVersion", "meta", "settings", "subjects", "tasks", "records", "plans",
  "activeSession", "extensions",
]);

/** Parse anything claiming to be a canonical dataset. Never throws on bad items. */
export function normalizeDataset(raw: unknown): { dataset: StudyDataset; issues: Issue[] } {
  const issues: Issue[] = [];
  const src: Obj = isObj(raw) ? raw : {};
  if (!isObj(raw)) issues.push({ path: "$", message: "dataset is not an object" });
  if (src.schema !== undefined && src.schema !== SCHEMA_ID)
    issues.push({ path: "schema", message: `unexpected schema id ${String(src.schema)}` });

  const list = <T>(k: string, fn: (v: unknown, p: string, i: number) => T | null): T[] => {
    const arr = src[k];
    if (arr === undefined) return [];
    if (!Array.isArray(arr)) {
      issues.push({ path: k, message: "expected array" });
      return [];
    }
    return arr.map((v, i) => fn(v, `${k}[${i}]`, i)).filter((x): x is T => x !== null);
  };

  const meta = isObj(src.meta) ? src.meta : {};
  const now = nowISO();
  const extensions: Extra = isObj(src.extensions) ? { ...src.extensions } : {};
  for (const [k, v] of Object.entries(src)) if (!KNOWN_TOP.has(k)) extensions[k] = v;

  const dataset: StudyDataset = {
    schema: SCHEMA_ID,
    schemaVersion: SCHEMA_VERSION,
    meta: {
      ...(meta as object),
      createdAt: typeof meta.createdAt === "string" ? meta.createdAt : now,
      updatedAt: typeof meta.updatedAt === "string" ? meta.updatedAt : now,
      timezone: typeof meta.timezone === "string" ? meta.timezone : deviceTimezone(),
    },
    settings: normalizeSettings(src.settings, issues),
    subjects: list("subjects", (v, p, i) => normalizeSubject(v, p, issues, i)),
    tasks: list("tasks", (v, p) => normalizeTask(v, p, issues)),
    records: list("records", (v, p) => normalizeRecord(v, p, issues)),
    plans: list("plans", (v, p) => normalizePlan(v, p, issues)),
    activeSession: normalizeActive(src.activeSession, issues),
  };
  if (Object.keys(extensions).length) dataset.extensions = extensions;

  // Referential checks (reported, not "fixed": we never re-point user data).
  const subjectIds = new Set(dataset.subjects.map((s) => s.id));
  const taskIds = new Set(dataset.tasks.map((t) => t.id));
  const seen = new Set<string>();
  dataset.records.forEach((r, i) => {
    if (seen.has(r.id)) issues.push({ path: `records[${i}].id`, message: `duplicate id ${r.id}` });
    seen.add(r.id);
    if (r.subjectId && !subjectIds.has(r.subjectId))
      issues.push({ path: `records[${i}].subjectId`, message: `unknown subject ${r.subjectId}` });
    if (r.taskId && !taskIds.has(r.taskId))
      issues.push({ path: `records[${i}].taskId`, message: `unknown task ${r.taskId}` });
    if (r.elapsedSec !== null && r.elapsedSec - r.breakSec !== r.durationSec)
      issues.push({ path: `records[${i}]`, message: "durationSec != elapsedSec - breakSec" });
  });
  return { dataset, issues };
}

export function emptyDataset(): StudyDataset {
  const now = nowISO();
  return {
    schema: SCHEMA_ID,
    schemaVersion: SCHEMA_VERSION,
    meta: { createdAt: now, updatedAt: now, timezone: deviceTimezone() },
    settings: { ...DEFAULT_SETTINGS },
    subjects: [],
    tasks: [],
    records: [],
    plans: [],
    activeSession: null,
  };
}
