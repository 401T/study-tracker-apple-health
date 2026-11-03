import { describe, expect, it } from "vitest";
import { syntheticDataset } from "../src/data/synthetic";
import { normalizeDataset } from "../src/data/validate";
import { compareFingerprints, fingerprint } from "../src/data/integrity";
import { recordsFromCSV, toCSV, toJSON } from "../src/data/io";
import { StudyStore, sessionTimes } from "../src/data/store";
import { DATASET_KEY, MemoryKV, memoryAdapter } from "../src/adapters/storage";

const END = "2026-11-03";

describe("JSON round-trip", () => {
  it("export → import preserves every record, total, id and extra field", () => {
    const ds = syntheticDataset({ end: END });
    ds.records[0].extra = { ...ds.records[0].extra, legacyFlag: "keep-me", nested: { a: [1, 2] } };
    (ds as unknown as Record<string, unknown>).someFutureTopLevelField = { x: 1 };
    const { dataset: back, issues } = normalizeDataset(JSON.parse(toJSON(ds)));
    expect(issues.filter((i) => !i.path.startsWith("schema"))).toEqual([]);
    expect(compareFingerprints(fingerprint(ds), fingerprint(back))).toEqual({ equal: true, differences: [] });
    expect(back.records.map((r) => r.id)).toEqual(ds.records.map((r) => r.id));
    expect(back.records[0].extra).toMatchObject({ legacyFlag: "keep-me", nested: { a: [1, 2] } });
    expect(back.extensions?.someFutureTopLevelField).toEqual({ x: 1 });
    expect(JSON.parse(toJSON(back)).records).toEqual(JSON.parse(toJSON(ds)).records);
  });

  it("keeps unknown and invalid fields instead of dropping them", () => {
    const { dataset, issues } = normalizeDataset({
      records: [{ id: 7, date: "2026-11-01", durationSec: "abc", mood: "good", subjectId: null }],
    });
    const r = dataset.records[0];
    expect(r.id).toBe("7");
    expect(r.extra).toMatchObject({ mood: "good", __idType: "number", __invalid: { durationSec: "abc" } });
    expect(issues.some((i) => i.path === "records[0].durationSec")).toBe(true);
  });

  it("does not alter dates or times", () => {
    const ds = syntheticDataset({ end: END, days: 10 });
    const back = normalizeDataset(JSON.parse(toJSON(ds))).dataset;
    ds.records.forEach((r, i) => {
      expect(back.records[i].date).toBe(r.date);
      expect(back.records[i].startAt).toBe(r.startAt);
      expect(back.records[i].endAt).toBe(r.endAt);
      expect(back.records[i].createdAt).toBe(r.createdAt);
    });
  });
});

describe("CSV round-trip", () => {
  it("records survive CSV export and re-import, including notes with commas/newlines", () => {
    const ds = syntheticDataset({ end: END, days: 30 });
    ds.records[0].note = 'カンマ, "引用" と\n改行';
    ds.records[1].extra = { custom: true };
    const { records, issues } = recordsFromCSV(toCSV(ds));
    expect(issues).toEqual([]);
    expect(records).toEqual(ds.records);
  });
});

describe("StudyStore", () => {
  it("adds, edits, soft-deletes and persists records", async () => {
    const kv = new MemoryKV();
    const store = new StudyStore(memoryAdapter(kv));
    await store.init();
    const r = store.addRecord({ date: "2026-11-03", durationSec: 1800, breakSec: 0, subjectId: null, taskId: null, note: "a" });
    store.updateRecord(r.id, { durationSec: 2400, note: "b" });
    await store.flush();
    const saved = JSON.parse(kv.getItem(DATASET_KEY)!);
    expect(saved.records[0]).toMatchObject({ id: r.id, durationSec: 2400, note: "b", createdAt: r.createdAt });
    store.deleteRecord(r.id);
    await store.flush();
    expect(fingerprint(store.data).activeRecordCount).toBe(0);
    expect(fingerprint(store.data).recordCount).toBe(1);
    store.restoreRecord(r.id);
    expect(fingerprint(store.data).activeRecordCount).toBe(1);
  });

  it("loads an existing dataset without changing it, and backs up before the first write", async () => {
    const ds = syntheticDataset({ end: END });
    const kv = new MemoryKV();
    kv.setItem(DATASET_KEY, JSON.stringify(ds));
    kv.setItem("someone-elses-key", "untouched");
    const store = new StudyStore(memoryAdapter(kv));
    await store.init();
    expect(compareFingerprints(fingerprint(ds), fingerprint(store.data)).equal).toBe(true);
    store.addRecord({ date: END, durationSec: 60, breakSec: 0, subjectId: null, taskId: null, note: "" });
    await store.flush();
    const backups = await store.listBackups();
    expect(backups).toHaveLength(1);
    const bak = await store.storage.readBackup(backups[0].id);
    expect(compareFingerprints(fingerprint(ds), fingerprint(normalizeDataset(bak).dataset)).equal).toBe(true);
    expect(kv.getItem("someone-elses-key")).toBe("untouched");
  });

  it("refuses to write when stored data is unreadable", async () => {
    const kv = new MemoryKV();
    kv.setItem(DATASET_KEY, "{not json");
    const store = new StudyStore(memoryAdapter(kv));
    await store.init();
    expect(store.readOnly).toBe(true);
    expect(() => store.addRecord({ date: END, durationSec: 60, breakSec: 0, subjectId: null, taskId: null, note: "" })).toThrow();
    expect(store.data.records).toHaveLength(0);
    expect(kv.getItem(DATASET_KEY)).toBe("{not json");
  });

  it("import merges without deleting and backs up first", async () => {
    const store = new StudyStore(memoryAdapter());
    await store.init();
    const ds = syntheticDataset({ end: END, days: 20 });
    await store.replaceDataset(ds, "test");
    const mine = store.addRecord({ date: END, durationSec: 600, breakSec: 0, subjectId: null, taskId: null, note: "mine" });
    const incoming = structuredClone(ds);
    incoming.records[0].note = "newer";
    incoming.records[0].updatedAt = "2099-01-01T00:00:00+09:00";
    incoming.records.push({ ...incoming.records[1], id: "rec_new", updatedAt: incoming.records[1].updatedAt });
    const res = await store.importDataset(incoming);
    expect(res).toMatchObject({ added: 1, updated: 1 });
    expect(store.data.records.find((r) => r.id === mine.id)).toBeTruthy();
    expect(store.data.records.length).toBe(ds.records.length + 2);
  });

  it("timer separates elapsed time from study time", () => {
    const s = {
      startedAt: "2026-11-03T09:00:00+09:00", subjectId: null, taskId: null, note: "",
      breaks: [{ start: "2026-11-03T09:30:00+09:00", end: "2026-11-03T09:40:00+09:00" }],
    };
    expect(sessionTimes(s, "2026-11-03T10:00:00+09:00")).toEqual({ elapsedSec: 3600, breakSec: 600, studySec: 3000, paused: false });
  });
});

describe("synthetic fixtures (regression)", () => {
  it("fixture dataset loads with zero issues and matches its recorded fingerprint", async () => {
    const { readFileSync } = await import("node:fs");
    const raw = JSON.parse(readFileSync("fixtures/synthetic-data/dataset.json", "utf8"));
    const expected = JSON.parse(readFileSync("fixtures/synthetic-data/fingerprint.json", "utf8"));
    const { dataset, issues } = normalizeDataset(raw);
    expect(issues).toEqual([]);
    expect(fingerprint(dataset)).toEqual(expected);
    // JSON → CSV → records keeps every record identical
    const csv = recordsFromCSV(readFileSync("fixtures/synthetic-data/records.csv", "utf8"));
    expect(csv.records).toEqual(dataset.records);
  });
});
