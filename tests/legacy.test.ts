/**
 * The legacy shape below is INVENTED for testing the adapter mechanics.
 * It is NOT Muse's real format (which this repository has not seen).
 */
import { describe, expect, it } from "vitest";
import { exportLegacy, importLegacy, type LegacyMapping } from "../src/adapters/legacy";
import { fingerprint } from "../src/data/integrity";

const hypotheticalLegacy = {
  version: 3,
  appState: {
    sessions: [
      { id: 101, day: "2026-11-01", from: "09:00", to: "10:30", mins: 80, rest: 10, subj: "数学", memo: "微分", mood: 4 },
      { id: 102, day: "2026-11-01", mins: 45, subj: "英語", memo: "単語", tags: ["暗記"] },
      { id: "c-3", day: "2026-11-02", from: "23:30", to: "00:40", mins: 70, subj: "数学" },
      "corrupted-entry",
      { id: 104, day: "2026-11-03", mins: 0.5, subj: "", memo: "" },
    ],
    subjects: [{ name: "数学", hue: 210 }, { name: "英語", hue: 30 }],
    prefs: { goalHours: 4, darkMode: true },
  },
  unrelated: { keep: "me" },
};

const mapping: LegacyMapping = {
  format: "hypothetical-test-format",
  paths: { records: "appState.sessions", subjects: "appState.subjects", settings: "appState.prefs" },
  record: {
    id: "id", date: "day", start: "from", end: "to", duration: "mins", durationUnit: "minutes",
    breakDuration: "rest", breakUnit: "minutes", subject: "subj", subjectRefIsName: true, note: "memo",
  },
  subject: { id: "name", name: "name" },
  settings: { dailyGoal: "goalHours", dailyGoalUnit: "hours" },
};

describe("legacy adapter", () => {
  const before = structuredClone(hypotheticalLegacy);
  const { dataset, problems, sourceCounts } = importLegacy(hypotheticalLegacy, mapping);

  it("does not mutate the source", () => {
    expect(hypotheticalLegacy).toEqual(before);
  });

  it("keeps record count, ids, totals and per-subject totals", () => {
    expect(sourceCounts.records).toBe(5);
    expect(dataset.records).toHaveLength(4);
    expect(dataset.extensions?.__unreadableRecords).toEqual([{ index: 3, value: "corrupted-entry" }]);
    expect(problems.some((p) => p.includes("records[3]"))).toBe(true);
    expect(dataset.records.map((r) => r.id)).toEqual(["101", "102", "c-3", "104"]);
    const fp = fingerprint(dataset);
    expect(fp.totalDurationSec).toBe((80 + 45 + 70 + 0.5) * 60);
    expect(fp.bySubjectSec["数学"]).toBe(150 * 60);
    expect(fp.bySubjectSec["英語"]).toBe(45 * 60);
  });

  it("keeps unknown fields and the untouched original", () => {
    const r = dataset.records[0];
    expect(r.extra).toMatchObject({ mood: 4, __idType: "number", __legacy: hypotheticalLegacy.appState.sessions[0] });
    expect(dataset.records[1].extra?.tags).toEqual(["暗記"]);
    expect(r.breakSec).toBe(600);
    expect(r.elapsedSec).toBe(5400);
  });

  it("handles a session crossing midnight", () => {
    const r = dataset.records[2];
    expect(r.date).toBe("2026-11-02");
    expect(r.elapsedSec).toBe(70 * 60);
  });

  it("maps settings with explicit units and keeps the original", () => {
    expect(dataset.settings.dailyGoalSec).toBe(4 * 3600);
    expect(dataset.settings.extra?.__legacy).toEqual({ goalHours: 4, darkMode: true });
  });

  it("write-back of an unedited dataset reproduces the original exactly", () => {
    expect(exportLegacy(hypotheticalLegacy, dataset, mapping)).toEqual(hypotheticalLegacy);
  });

  it("write-back changes only what was edited and appends new records", () => {
    const ds = structuredClone(dataset);
    ds.records[1].note = "単語 + 熟語";
    ds.records.push({ ...ds.records[1], id: "rec_new", note: "new", durationSec: 1800, extra: undefined });
    const out = exportLegacy(hypotheticalLegacy, ds, mapping) as typeof hypotheticalLegacy;
    const sessions = out.appState.sessions as Record<string, unknown>[];
    expect(sessions[1]).toEqual({ ...hypotheticalLegacy.appState.sessions[1] as object, memo: "単語 + 熟語" });
    expect(sessions[3]).toBe("corrupted-entry");
    expect(sessions[5]).toMatchObject({ id: "rec_new", memo: "new", mins: 30, subj: "英語" });
    expect(out.unrelated).toEqual({ keep: "me" });
    expect(out.appState.prefs).toEqual(hypotheticalLegacy.appState.prefs);
  });
});
