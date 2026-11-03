/**
 * Read interface for AI agents.
 *
 * Exposure channels (none of them assumes a Muse-specific API exists):
 * 1. `window.studyTracker` — callable from any agent that can run JS in the page.
 * 2. `<script type="application/json" id="study-tracker-snapshot">` — refreshed on
 *    every change, so an agent that can only READ the page DOM/HTML still sees data.
 * 3. JSON / CSV / Markdown exports (Settings → データ).
 *
 * All getters return deep copies. The only write path is `proposeChange`, which
 * does nothing until the user approves it in the app UI.
 */

import type { StudyDataset, StudyRecord } from "../data/schema";
import type { StudyStore } from "../data/store";
import {
  bySubject, planVsActual, recordsInRange, streak, subjectChanges, summarizeDay, summarizePeriod, weeklyTrend,
} from "../analytics";
import { addDays, startOfWeek, today } from "../data/time";
import { fingerprint } from "../data/integrity";
import { toCSV, toJSON } from "../data/io";
import { toMarkdown } from "./ai-report";

export const AGENT_API_VERSION = "1.0.0";

export type ProposedChange =
  | { kind: "addRecord"; record: Pick<StudyRecord, "date" | "durationSec" | "subjectId" | "note"> & Partial<StudyRecord> ; reason: string }
  | { kind: "updateRecord"; id: string; patch: Partial<StudyRecord>; reason: string }
  | { kind: "setPlan"; periodStart: string; periodEnd: string; subjectId: string | null; plannedSec: number; reason: string };

export interface PendingProposal {
  id: string;
  change: ProposedChange;
  proposedAt: string;
}

const clone = <T>(v: T): T => structuredClone(v);

/** Provenance block attached to every computed answer. */
function basis(ds: StudyDataset, start: string | null, end: string | null, method: string) {
  const recs = start && end ? recordsInRange(ds, start, end) : ds.records.filter((r) => !r.deletedAt);
  return {
    kind: "computed" as const,
    method,
    range: start && end ? { start, end } : null,
    recordCount: recs.length,
    recordIds: recs.map((r) => r.id),
    generatedAt: new Date().toISOString(),
    units: { durations: "seconds" },
  };
}

export function createAgentApi(store: StudyStore, onProposal: (p: PendingProposal) => void) {
  const ds = () => store.data;
  const proposals: PendingProposal[] = [];
  return {
    version: AGENT_API_VERSION,
    /** Schema summary for agents that have not read docs/DATA_SCHEMA.md. */
    describe() {
      return {
        schema: ds().schema,
        schemaVersion: ds().schemaVersion,
        units: "All *Sec fields are integer seconds. date fields are local YYYY-MM-DD.",
        durationVsElapsed: "durationSec = actual study time (breaks excluded); elapsedSec = wall clock incl. breaks (null if unknown).",
        sources: "timer = measured by app timer; manual = typed by user; legacy = migrated; import = imported file; agent = AI proposal approved by user.",
        plansVsActual: "Plans live in getStudyPlans(); records are actuals only.",
        deleted: "Records with deletedAt are excluded from every getter.",
        docs: "docs/AI_DATA_GUIDE.md and docs/AGENT_INSTRUCTIONS.md in the repository.",
      };
    },
    getStudyRecords: () => clone(ds().records.filter((r) => !r.deletedAt)),
    getStudyRecordsByDateRange: (start: string, end: string) => clone(recordsInRange(ds(), start, end)),
    getSubjects: () => clone(ds().subjects),
    getTasks: () => clone(ds().tasks),
    getStudyPlans: () => clone(ds().plans),
    getSettings: () => clone(ds().settings),
    getStudyTimeBySubject: (start = "0000-01-01", end = "9999-12-31") => ({
      data: bySubject(ds(), start, end),
      basis: basis(ds(), start, end, "sum of durationSec per subjectId"),
    }),
    getDailyStudySummary: (date = today()) => ({ data: clone(summarizeDay(ds(), date)), basis: basis(ds(), date, date, "sum of durationSec for the date") }),
    getWeeklyStudySummary: (start?: string, end?: string) => {
      const s = start ?? startOfWeek(today(), ds().settings.weekStartsOn);
      const e = end ?? addDays(s, 6);
      return { data: summarizePeriod(ds(), s, e), basis: basis(ds(), s, e, "daily sums over the range; avg = total / elapsed days") };
    },
    getMonthlyStudySummary: (start?: string, end?: string) => {
      const s = start ?? today().slice(0, 8) + "01";
      const e = end ?? today();
      return { data: summarizePeriod(ds(), s, e), basis: basis(ds(), s, e, "daily sums over the range; avg = total / elapsed days") };
    },
    getStudyTrends: (weeks = 8) => ({
      weekly: weeklyTrend(ds(), weeks),
      subjectChanges: subjectChanges(ds(), 14),
      streak: streak(ds()),
      basis: basis(ds(), addDays(today(), -7 * weeks), today(), "see weekly.method; subjectChanges = last 14 complete days vs prior 14"),
    }),
    getPlanVsActual: (start = addDays(today(), -56), end = addDays(today(), 28)) => ({
      data: planVsActual(ds(), start, end),
      basis: basis(ds(), start, end, "actual = sum of durationSec of records inside each plan period (and subject)"),
    }),
    getIntegrity: () => fingerprint(ds()),
    exportJSON: () => toJSON(ds()),
    exportCSV: () => toCSV(ds()),
    exportMarkdown: (start?: string, end?: string) => toMarkdown(ds(), { start, end }),
    /**
     * Queue a change for USER APPROVAL. Returns the proposal id. Nothing is
     * written unless the user taps 承認 in the app.
     */
    proposeChange(change: ProposedChange): string {
      if (!change || typeof change.reason !== "string" || !change.reason.trim()) throw new Error("proposeChange requires a non-empty reason");
      const p: PendingProposal = { id: `prop_${Date.now().toString(36)}`, change: clone(change), proposedAt: new Date().toISOString() };
      proposals.push(p);
      onProposal(p);
      return p.id;
    },
    listProposals: () => clone(proposals),
  };
}

export type AgentApi = ReturnType<typeof createAgentApi>;

/** Apply an approved proposal. Only called from the approval UI. */
export function applyProposal(store: StudyStore, p: PendingProposal) {
  const c = p.change;
  if (c.kind === "addRecord") {
    store.addRecord({
      date: c.record.date, durationSec: c.record.durationSec, breakSec: c.record.breakSec ?? 0,
      subjectId: c.record.subjectId, taskId: c.record.taskId ?? null, note: c.record.note,
      startAt: c.record.startAt ?? null, endAt: c.record.endAt ?? null, elapsedSec: c.record.elapsedSec ?? null, source: "agent",
    });
  } else if (c.kind === "updateRecord") {
    const { date, durationSec, breakSec, subjectId, taskId, note, startAt, endAt, elapsedSec } = c.patch;
    const patch = Object.fromEntries(
      Object.entries({ date, durationSec, breakSec, subjectId, taskId, note, startAt, endAt, elapsedSec }).filter(([, v]) => v !== undefined),
    );
    store.updateRecord(c.id, patch);
  } else if (c.kind === "setPlan") {
    store.setPlan(c.periodStart, c.periodEnd, c.subjectId, c.plannedSec);
  }
}

/** Keep the DOM snapshot in sync (channel 2). */
export function mountSnapshot(store: StudyStore) {
  let el = document.getElementById("study-tracker-snapshot") as HTMLScriptElement | null;
  if (!el) {
    el = document.createElement("script");
    el.type = "application/json";
    el.id = "study-tracker-snapshot";
    document.body.appendChild(el);
  }
  const write = () => {
    const d = store.data;
    el!.textContent = JSON.stringify({
      note: "Read-only snapshot for AI agents. Units: seconds. See window.studyTracker.describe().",
      generatedAt: new Date().toISOString(),
      integrity: fingerprint(d),
      dataset: d,
    }).replace(/</g, "\\u003c");
  };
  write();
  store.subscribe(write);
}
