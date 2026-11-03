/**
 * Canonical data model (schemaVersion 1).
 *
 * Units and conventions — see docs/DATA_SCHEMA.md for the full dictionary.
 * - All durations are integer SECONDS (fields end with `Sec`).
 * - `date` / `periodStart` / `periodEnd` are local calendar dates "YYYY-MM-DD"
 *   in the record's own `timezone`.
 * - Instants (`startAt`, `endAt`, `createdAt`, …) are ISO 8601 strings WITH
 *   a UTC offset, e.g. "2026-11-03T09:00:00+09:00".
 * - `extra` holds every field this app does not understand. It is never
 *   dropped on load, edit, export or import (see adapters/legacy.ts).
 */

export const SCHEMA_ID = "study-tracker-apple-health" as const;
export const SCHEMA_VERSION = 1 as const;

export type ISODateTime = string;
export type LocalDate = string;
export type Extra = Record<string, unknown>;

/** Where a record came from. Lets an AI agent tell measured from typed values. */
export type RecordSource = "timer" | "manual" | "import" | "legacy" | "agent";

export interface Subject {
  id: string;
  name: string;
  /** Key into the subject palette (design-system chart tokens). */
  color: SubjectColor;
  /** Planned study time per week for this subject; null = no goal. */
  weeklyGoalSec: number | null;
  archived: boolean;
  order: number;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  extra?: Extra;
}

export type SubjectColor =
  | "blue" | "green" | "orange" | "pink" | "purple"
  | "teal" | "yellow" | "red" | "indigo" | "brown";

export const SUBJECT_COLORS: SubjectColor[] = [
  "blue", "green", "orange", "pink", "purple", "teal", "yellow", "red", "indigo", "brown",
];

export interface Task {
  id: string;
  subjectId: string | null;
  title: string;
  status: "open" | "done";
  dueDate: LocalDate | null;
  note: string;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  extra?: Extra;
}

/**
 * One block of ACTUAL study. Plans live in StudyPlan, never here.
 *
 * durationSec  = time actually spent studying (the value every total uses).
 * elapsedSec   = wall-clock time between startAt and endAt, breaks included.
 *                null when the start/end times are unknown (manual entry).
 * breakSec     = paused / break time inside the session.
 * Invariant when elapsedSec != null: durationSec = elapsedSec - breakSec.
 */
export interface StudyRecord {
  id: string;
  date: LocalDate;
  timezone: string;
  startAt: ISODateTime | null;
  endAt: ISODateTime | null;
  durationSec: number;
  elapsedSec: number | null;
  breakSec: number;
  subjectId: string | null;
  taskId: string | null;
  /** What was studied (free text, user-authored). */
  note: string;
  source: RecordSource;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  /** Soft delete: excluded from totals, kept so it can be restored. */
  deletedAt: ISODateTime | null;
  extra?: Extra;
}

/** PLANNED study time for a period (inclusive dates). subjectId null = all subjects. */
export interface StudyPlan {
  id: string;
  periodStart: LocalDate;
  periodEnd: LocalDate;
  subjectId: string | null;
  plannedSec: number;
  note: string;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  extra?: Extra;
}

export interface Settings {
  theme: "system" | "light" | "dark";
  /** "standard" = Liquid Glass; "reduced" = opaque controls (Reduce Transparency). */
  glass: "standard" | "reduced";
  /** Liquid Glass refraction (Chromium only). Off = blur + sheen only. */
  refraction: boolean;
  dailyGoalSec: number;
  /** 0 = Sunday, 1 = Monday. */
  weekStartsOn: 0 | 1;
  extra?: Extra;
}

/** An in-progress timer session, persisted so a reload never loses it. */
export interface ActiveSession {
  startedAt: ISODateTime;
  subjectId: string | null;
  taskId: string | null;
  note: string;
  breaks: { start: ISODateTime; end: ISODateTime | null }[];
}

export interface DatasetMeta {
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  /** IANA zone of the device that last wrote the dataset. */
  timezone: string;
  /** Present when this dataset was produced from another storage format. */
  legacy?: { format: string; importedAt: ISODateTime; fingerprint: string };
}

export interface StudyDataset {
  schema: typeof SCHEMA_ID;
  schemaVersion: typeof SCHEMA_VERSION;
  meta: DatasetMeta;
  settings: Settings;
  subjects: Subject[];
  tasks: Task[];
  records: StudyRecord[];
  plans: StudyPlan[];
  activeSession: ActiveSession | null;
  /** Unknown top-level fields from imported data, preserved verbatim. */
  extensions?: Extra;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: "system",
  glass: "standard",
  refraction: true,
  dailyGoalSec: 3 * 3600,
  weekStartsOn: 1,
};
