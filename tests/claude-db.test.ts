/** ClaudeDbStorage against an in-memory fake of the artifact db (same path grammar). */
import { describe, expect, it } from "vitest";
import { ClaudeDbStorage, splitMonths } from "../src/adapters/claude-db-storage";
import type { Db, DbCollection, DbDoc, DbSnap } from "../src/adapters/claude-runtime";
import { syntheticDataset } from "../src/data/synthetic";
import { normalizeDataset } from "../src/data/validate";
import { compareFingerprints, fingerprint } from "../src/data/integrity";
import { StudyStore } from "../src/data/store";

class FakeDb implements Db {
  docs = new Map<string, Record<string, unknown>>();
  listeners = new Map<string, ((s: DbSnap) => void)[]>();
  private snap(path: string): DbSnap {
    const d = this.docs.get(path);
    return { id: path.split("/").pop()!, exists: !!d, data: () => (d ? structuredClone(d) : undefined), metadata: { fromCache: false, hasPendingWrites: false } };
  }
  doc(path: string): DbDoc {
    if (path.split("/").length % 2) throw new TypeError("odd doc path");
    const self = this;
    return {
      id: path.split("/").pop()!, path,
      async get() { return self.snap(path); },
      async set(data) {
        if (JSON.stringify(data).length > 256 * 1024) throw { code: "invalid_argument", message: "too large" };
        self.docs.set(path, structuredClone(data));
        (self.listeners.get(path) ?? []).forEach((fn) => fn(self.snap(path)));
      },
      async delete() { self.docs.delete(path); },
      onSnapshot(next) { self.listeners.set(path, [...(self.listeners.get(path) ?? []), next]); return () => {}; },
      collection(sub) { return self.collection(`${path}/${sub}`); },
    };
  }
  collection(path: string): DbCollection {
    const self = this;
    let order: [string, "asc" | "desc"] | null = null;
    let lim = 1000;
    const q: DbCollection = {
      path,
      doc(id = Math.random().toString(36).slice(2)) { return self.doc(`${path}/${id}`); },
      where() { return q; },
      orderBy(f, dir = "asc") { order = [f, dir]; return q; },
      limit(n) { lim = n; return q; },
      async get() {
        let docs = [...self.docs.keys()].filter((k) => k.startsWith(path + "/") && k.split("/").length === path.split("/").length + 1).map((k) => self.snap(k));
        if (order) docs.sort((a, b) => String(a.data()![order![0]]).localeCompare(String(b.data()![order![0]])) * (order![1] === "asc" ? 1 : -1));
        docs = docs.slice(0, lim);
        return { docs, size: docs.length };
      },
    };
    return q;
  }
}

describe("ClaudeDbStorage", () => {
  it("round-trips a dataset through month documents without loss", async () => {
    const db = new FakeDb();
    const ds = syntheticDataset({ end: "2026-11-03" });
    const a = new ClaudeDbStorage(db, "u1");
    await a.save(ds);
    expect([...db.docs.keys()].filter((k) => k.includes("/months/")).length).toBe(5); // Jul–Nov
    const back = normalizeDataset(await new ClaudeDbStorage(db, "u1").load()).dataset;
    expect(compareFingerprints(fingerprint(ds), fingerprint(back)).equal).toBe(true);
    expect(back.extensions).toEqual(ds.extensions);
  });

  it("spills a large month into several documents under the size limit", () => {
    const ds = syntheticDataset({ end: "2026-11-03", days: 20 });
    const big = Array.from({ length: 900 }, (_, i) => ({ ...ds.records[0], id: `r${i}`, date: "2026-10-05", note: "x".repeat(300) }));
    const parts = splitMonths(big);
    expect(parts.size).toBeGreaterThan(1);
    for (const p of parts.values()) expect(JSON.stringify(p).length).toBeLessThan(256 * 1024);
    expect([...parts.values()].reduce((n, p) => n + p.records.length, 0)).toBe(900);
  });

  it("merges instead of overwriting when another device saved first", async () => {
    const db = new FakeDb();
    const base = syntheticDataset({ end: "2026-11-03", days: 10 });
    await new ClaudeDbStorage(db, "u1").save(base);

    const phone = new StudyStore(new ClaudeDbStorage(db, "u1"));
    const mac = new StudyStore(new ClaudeDbStorage(db, "u1"));
    await phone.init();
    await mac.init();
    const p = phone.addRecord({ date: "2026-11-03", durationSec: 600, breakSec: 0, subjectId: null, taskId: null, note: "phone" });
    await phone.flush();
    const m = mac.addRecord({ date: "2026-11-03", durationSec: 900, breakSec: 0, subjectId: null, taskId: null, note: "mac" });
    await mac.flush();

    const final = normalizeDataset(await new ClaudeDbStorage(db, "u1").load()).dataset;
    const ids = new Set(final.records.map((r) => r.id));
    expect(ids.has(p.id) && ids.has(m.id)).toBe(true);
    expect(final.records.length).toBe(base.records.length + 2);
  });

  it("stores and restores chunked backups", async () => {
    const db = new FakeDb();
    const s = new ClaudeDbStorage(db, "u1");
    const ds = syntheticDataset({ end: "2026-11-03" });
    const info = await s.backup("test", ds);
    expect((await s.listBackups())[0].id).toBe(info.id);
    const back = normalizeDataset(await s.readBackup(info.id)).dataset;
    expect(compareFingerprints(fingerprint(ds), fingerprint(back)).equal).toBe(true);
  });
});
