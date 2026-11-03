/**
 * StudyStore — the only place that mutates the dataset.
 *
 * - Presentation code reads `store.data` and calls the mutation methods.
 * - Every mutation stamps `updatedAt`, persists through the StorageAdapter,
 *   and notifies subscribers.
 * - If stored data cannot be parsed, the store enters READ-ONLY mode and never
 *   writes, so unreadable data is not overwritten.
 * - A backup is taken before any bulk operation (import, restore, legacy
 *   migration) and automatically once per day on the first write.
 */

import type { StorageAdapter, BackupInfo } from "../adapters/storage";
import type {
  ActiveSession, Settings, StudyDataset, StudyPlan, StudyRecord, Subject, Task,
} from "./schema";
import { SUBJECT_COLORS } from "./schema";
import { newId } from "./ids";
import { emptyDataset, normalizeDataset, type Issue } from "./validate";
import { deviceTimezone, nowISO, secondsBetween, today, toLocalDate } from "./time";
import { compareFingerprints, fingerprint } from "./integrity";

export type Listener = (ds: StudyDataset) => void;

export type RecordInput = Pick<StudyRecord, "date" | "durationSec" | "breakSec" | "subjectId" | "taskId" | "note"> &
  Partial<Pick<StudyRecord, "startAt" | "endAt" | "elapsedSec" | "source" | "timezone">>;

export class StudyStore {
  data: StudyDataset = emptyDataset();
  issues: Issue[] = [];
  readOnly = false;
  loadError: string | null = null;
  private listeners = new Set<Listener>();
  private lastAutoBackupDay: string | null = null;
  private saving: Promise<void> = Promise.resolve();

  constructor(readonly storage: StorageAdapter) {}

  async init(): Promise<void> {
    let raw: unknown;
    try {
      raw = await this.storage.load();
    } catch (e) {
      this.readOnly = true;
      this.loadError = `保存データを読み込めませんでした（${(e as Error).message}）。データ保護のため読み取り専用で起動しています。`;
      this.emit();
      return;
    }
    if (raw !== null) {
      const { dataset, issues } = normalizeDataset(raw);
      this.data = dataset;
      this.issues = issues;
    }
    this.emit();
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    for (const fn of this.listeners) fn(this.data);
  }

  private async persist() {
    if (this.readOnly) throw new Error("read-only: stored data could not be parsed");
    const day = today();
    if (this.lastAutoBackupDay !== day) {
      const existing = await this.storage.load().catch(() => null);
      if (existing !== null) await this.storage.backup(`自動バックアップ ${day}`, existing);
      this.lastAutoBackupDay = day;
    }
    this.data.meta.updatedAt = nowISO();
    this.data.meta.timezone = deviceTimezone();
    await this.storage.save(this.data);
  }

  /**
   * Apply a mutation and queue a save. Throws synchronously in read-only mode
   * (before touching data). The returned promise never rejects; save failures
   * are reported through `onSaveError` and kept in `saveError`.
   */
  private commit(mutator: (ds: StudyDataset) => void): Promise<void> {
    if (this.readOnly) throw new Error("読み取り専用モードのため保存できません");
    mutator(this.data);
    this.emit();
    this.saving = this.saving
      .then(() => this.persist())
      .then(() => {
        this.saveError = null;
      })
      .catch((e: Error) => {
        this.saveError = e;
        for (const fn of this.errorListeners) fn(e);
      });
    return this.saving;
  }

  saveError: Error | null = null;
  private errorListeners = new Set<(e: Error) => void>();
  onSaveError(fn: (e: Error) => void) {
    this.errorListeners.add(fn);
  }

  // ---------- Records ----------
  addRecord(input: RecordInput): StudyRecord {
    const now = nowISO();
    const rec: StudyRecord = {
      id: newId("rec"),
      timezone: input.timezone ?? deviceTimezone(),
      startAt: input.startAt ?? null,
      endAt: input.endAt ?? null,
      elapsedSec: input.elapsedSec ?? null,
      source: input.source ?? "manual",
      date: input.date,
      durationSec: Math.max(0, Math.round(input.durationSec)),
      breakSec: Math.max(0, Math.round(input.breakSec)),
      subjectId: input.subjectId,
      taskId: input.taskId,
      note: input.note,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    void this.commit((ds) => ds.records.push(rec));
    return rec;
  }

  /** Patch known fields; `id`, `createdAt`, `source` and `extra` are never touched. */
  updateRecord(id: string, patch: Partial<RecordInput>): void {
    void this.commit((ds) => {
      const r = ds.records.find((x) => x.id === id);
      if (!r) throw new Error(`record ${id} not found`);
      const { source: _ignored, ...rest } = patch;
      void _ignored;
      const timeKeys = ["durationSec", "breakSec", "startAt", "endAt", "elapsedSec", "date"] as const;
      const timesChanged = timeKeys.some((k) => k in rest && rest[k] !== r[k]);
      Object.assign(r, rest, { updatedAt: nowISO() });
      // A measured value that the user later changed is no longer purely measured.
      if (r.source === "timer" && timesChanged) r.extra = { ...r.extra, editedAfterMeasurement: true };
    });
  }

  deleteRecord(id: string): void {
    void this.commit((ds) => {
      const r = ds.records.find((x) => x.id === id);
      if (r) r.deletedAt = r.updatedAt = nowISO();
    });
  }

  restoreRecord(id: string): void {
    void this.commit((ds) => {
      const r = ds.records.find((x) => x.id === id);
      if (r) {
        r.deletedAt = null;
        r.updatedAt = nowISO();
      }
    });
  }

  // ---------- Subjects ----------
  addSubject(name: string, color?: Subject["color"], weeklyGoalSec: number | null = null): Subject {
    const now = nowISO();
    const s: Subject = {
      id: newId("sub"),
      name,
      color: color ?? SUBJECT_COLORS[this.data.subjects.length % SUBJECT_COLORS.length],
      weeklyGoalSec,
      archived: false,
      order: this.data.subjects.length,
      createdAt: now,
      updatedAt: now,
    };
    void this.commit((ds) => ds.subjects.push(s));
    return s;
  }

  updateSubject(id: string, patch: Partial<Pick<Subject, "name" | "color" | "weeklyGoalSec" | "archived" | "order">>) {
    void this.commit((ds) => {
      const s = ds.subjects.find((x) => x.id === id);
      if (s) Object.assign(s, patch, { updatedAt: nowISO() });
    });
  }

  // ---------- Tasks ----------
  addTask(subjectId: string | null, title: string): Task {
    const now = nowISO();
    const t: Task = { id: newId("task"), subjectId, title, status: "open", dueDate: null, note: "", createdAt: now, updatedAt: now };
    void this.commit((ds) => ds.tasks.push(t));
    return t;
  }

  updateTask(id: string, patch: Partial<Pick<Task, "title" | "status" | "dueDate" | "note" | "subjectId">>) {
    void this.commit((ds) => {
      const t = ds.tasks.find((x) => x.id === id);
      if (t) Object.assign(t, patch, { updatedAt: nowISO() });
    });
  }

  // ---------- Plans ----------
  /** Upsert the plan for (period, subject). plannedSec 0 removes nothing — it records an explicit zero plan. */
  setPlan(periodStart: string, periodEnd: string, subjectId: string | null, plannedSec: number) {
    void this.commit((ds) => {
      const now = nowISO();
      const p = ds.plans.find((x) => x.periodStart === periodStart && x.periodEnd === periodEnd && x.subjectId === subjectId);
      if (p) Object.assign(p, { plannedSec, updatedAt: now });
      else {
        const plan: StudyPlan = { id: newId("plan"), periodStart, periodEnd, subjectId, plannedSec, note: "", createdAt: now, updatedAt: now };
        ds.plans.push(plan);
      }
    });
  }

  // ---------- Settings ----------
  updateSettings(patch: Partial<Omit<Settings, "extra">>) {
    void this.commit((ds) => Object.assign(ds.settings, patch));
  }

  // ---------- Timer ----------
  startSession(subjectId: string | null, taskId: string | null, note = "") {
    const s: ActiveSession = { startedAt: nowISO(), subjectId, taskId, note, breaks: [] };
    void this.commit((ds) => (ds.activeSession = s));
  }

  updateSession(patch: Partial<Pick<ActiveSession, "subjectId" | "taskId" | "note">>) {
    void this.commit((ds) => ds.activeSession && Object.assign(ds.activeSession, patch));
  }

  pauseSession() {
    void this.commit((ds) => {
      const s = ds.activeSession;
      if (s && !s.breaks.some((b) => !b.end)) s.breaks.push({ start: nowISO(), end: null });
    });
  }

  resumeSession() {
    void this.commit((ds) => {
      const open = ds.activeSession?.breaks.find((b) => !b.end);
      if (open) open.end = nowISO();
    });
  }

  /** Stops the timer and creates a record. elapsed = wall clock; duration = elapsed − breaks. */
  finishSession(): StudyRecord | null {
    const s = this.data.activeSession;
    if (!s) return null;
    const endAt = nowISO();
    const { elapsedSec, breakSec } = sessionTimes(s, endAt);
    const rec = this.addRecord({
      date: toLocalDate(new Date(s.startedAt)),
      startAt: s.startedAt,
      endAt,
      elapsedSec,
      breakSec,
      durationSec: elapsedSec - breakSec,
      subjectId: s.subjectId,
      taskId: s.taskId,
      note: s.note,
      source: "timer",
    });
    void this.commit((ds) => (ds.activeSession = null));
    return rec;
  }

  discardSession() {
    void this.commit((ds) => (ds.activeSession = null));
  }

  // ---------- Bulk ----------
  /**
   * Merge an imported canonical dataset. Never deletes: new ids are added,
   * existing ids are replaced only when the incoming `updatedAt` is newer.
   */
  async importDataset(raw: unknown): Promise<{ added: number; updated: number; skipped: number; issues: Issue[] }> {
    const { dataset: inc, issues } = normalizeDataset(raw);
    await this.storage.backup("インポート前のバックアップ", this.data);
    let added = 0, updated = 0, skipped = 0;
    const mergeList = <T extends { id: string; updatedAt: string }>(cur: T[], incoming: T[], count: boolean) => {
      const byId = new Map(cur.map((x, i) => [x.id, i]));
      for (const x of incoming) {
        const i = byId.get(x.id);
        if (i === undefined) {
          cur.push(x);
          if (count) added++;
        } else if (Date.parse(x.updatedAt) > Date.parse(cur[i].updatedAt)) {
          cur[i] = x;
          if (count) updated++;
        } else if (count) skipped++;
      }
    };
    await this.commit((ds) => {
      mergeList(ds.subjects, inc.subjects, false);
      mergeList(ds.tasks, inc.tasks, false);
      mergeList(ds.plans, inc.plans, false);
      mergeList(ds.records, inc.records, true);
      if (inc.extensions) ds.extensions = { ...inc.extensions, ...ds.extensions };
    });
    return { added, updated, skipped, issues };
  }

  /** Replace the dataset with a canonical one after backing up; verifies the result. */
  async replaceDataset(next: StudyDataset, label: string) {
    await this.storage.backup(label, this.data);
    await this.commit((ds) => Object.assign(ds, structuredClone(next)));
    if (this.saveError) throw this.saveError;
    const check = compareFingerprints(fingerprint(next), fingerprint(this.data));
    if (!check.equal) throw new Error(`integrity check failed: ${check.differences.join("; ")}`);
  }

  async restoreBackup(id: string) {
    const raw = await this.storage.readBackup(id);
    if (raw === null) throw new Error("backup not found");
    const { dataset } = normalizeDataset(raw);
    await this.replaceDataset(dataset, "復元前のバックアップ");
  }

  listBackups(): Promise<BackupInfo[]> {
    return this.storage.listBackups();
  }

  flush(): Promise<void> {
    return this.saving;
  }
}

export function sessionTimes(s: ActiveSession, at: string = nowISO()) {
  const elapsedSec = Math.max(0, secondsBetween(s.startedAt, at));
  const breakSec = Math.min(
    elapsedSec,
    s.breaks.reduce((sum, b) => sum + Math.max(0, secondsBetween(b.start, b.end ?? at)), 0),
  );
  return { elapsedSec, breakSec, studySec: elapsedSec - breakSec, paused: s.breaks.some((b) => !b.end) };
}
