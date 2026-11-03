/**
 * StorageAdapter backed by the claude.ai artifact database, in the viewer's
 * PRIVATE subtree (`data/users/<id>/…`): only this person can read it, it syncs
 * across their devices, and Claude can read it on their behalf.
 *
 * Layout (each document ≤ 256 KiB):
 *   data/users/<id>/tracker                    everything except records + `rev`
 *   data/users/<id>/tracker/months/<YYYY-MM>   { month, records: StudyRecord[] }
 *                                              (large months spill to <YYYY-MM>_2, _3 …)
 *   data/users/<id>/tracker/backups/<bid>      { label, createdAt, bytes, parts }
 *   data/users/<id>/tracker/backups/<bid>/parts/<n>  { chunk } (JSON text slices)
 *
 * Records are stored as structured JSON (not opaque text) so they stay readable
 * for an agent reading the database directly.
 */

import type { BackupInfo, StorageAdapter } from "./storage";
import type { Db, DbDoc } from "./claude-runtime";
import type { StudyDataset, StudyRecord } from "../data/schema";
import { normalizeDataset } from "../data/validate";
import { mergeDatasets } from "../data/merge";

const MONTH_DOC_LIMIT = 200_000; // bytes of JSON per month document
const CHUNK = 180_000;
const MAX_BACKUPS = 10;

export class ClaudeDbStorage implements StorageAdapter {
  readonly name = "claude";
  private root: DbDoc;
  private written = new Map<string, string>(); // month doc id → JSON last written/read
  private rev: string | null = null;
  private session = Math.random().toString(36).slice(2, 10);

  constructor(db: Db, uid: string) {
    this.root = db.doc(`data/users/${uid}/tracker`);
  }

  /** A private subcollection next to the data (used for Claude's comments). */
  collection(name: string) {
    return this.root.collection(name);
  }

  async load(): Promise<unknown | null> {
    const snap = await this.root.get();
    if (!snap.exists) return null;
    const head = { ...(snap.data() as Record<string, unknown>) };
    this.rev = typeof head.rev === "string" ? head.rev : null;
    const months = await this.root.collection("months").get();
    const records: StudyRecord[] = [];
    this.written.clear();
    for (const d of [...months.docs].sort((a, b) => a.id.localeCompare(b.id))) {
      const body = d.data();
      if (!body) continue;
      this.written.set(d.id, JSON.stringify(body));
      if (Array.isArray(body.records)) records.push(...(body.records as StudyRecord[]));
    }
    delete head.rev;
    delete head.savedBy;
    delete head.months;
    return { ...head, records };
  }

  async save(data: unknown): Promise<void | { merged: unknown }> {
    let ds = data as StudyDataset;
    let merged = false;
    // Another device saved since we last read: merge (nothing is dropped), then write the union.
    const head = await this.root.get();
    const remoteRev = head.exists ? (head.data()?.rev as string | undefined) ?? null : null;
    if (head.exists && remoteRev !== this.rev) {
      const remote = await this.load();
      if (remote) {
        ds = mergeDatasets(normalizeDataset(remote).dataset, ds).dataset;
        merged = true;
      }
    }

    const docs = splitMonths(ds.records);
    for (const [id, body] of docs) {
      const json = JSON.stringify(body);
      if (this.written.get(id) === json) continue;
      await this.root.collection("months").doc(id).set(body);
      this.written.set(id, json);
    }
    // Remove month docs that no longer hold records (e.g. a record's date moved).
    for (const id of [...this.written.keys()]) {
      if (!docs.has(id)) {
        await this.root.collection("months").doc(id).delete();
        this.written.delete(id);
      }
    }
    const { records: _r, ...rest } = ds;
    void _r;
    this.rev = `${Date.now().toString(36)}-${this.session}`;
    await this.root.set({ ...JSON.parse(JSON.stringify(rest)), months: [...docs.keys()], rev: this.rev, savedBy: this.session });
    return merged ? { merged: ds } : undefined;
  }

  watch(onRemoteChange: () => void) {
    this.root.onSnapshot(
      (snap) => {
        if (!snap.exists || snap.metadata.hasPendingWrites) return;
        const body = snap.data();
        const rev = typeof body?.rev === "string" ? body.rev : null;
        if (rev && rev !== this.rev && body?.savedBy !== this.session) onRemoteChange();
      },
      () => {
        /* terminal listener error: keep working without live sync */
      },
    );
  }

  async backup(label: string, data: unknown): Promise<BackupInfo> {
    const createdAt = new Date().toISOString();
    const text = JSON.stringify(data);
    const parts = Math.max(1, Math.ceil(text.length / CHUNK));
    const ref = this.root.collection("backups").doc();
    for (let i = 0; i < parts; i++) await ref.collection("parts").doc(String(i)).set({ chunk: text.slice(i * CHUNK, (i + 1) * CHUNK) });
    await ref.set({ label, createdAt, bytes: text.length, parts });
    await this.prune();
    return { id: ref.id, label, createdAt, bytes: text.length };
  }

  async listBackups(): Promise<BackupInfo[]> {
    const q = await this.root.collection("backups").orderBy("createdAt", "desc").limit(50).get();
    return q.docs
      .filter((d) => d.exists)
      .map((d) => {
        const b = d.data()!;
        return { id: d.id, label: String(b.label ?? ""), createdAt: String(b.createdAt ?? ""), bytes: Number(b.bytes ?? 0) };
      });
  }

  async readBackup(id: string): Promise<unknown | null> {
    const ref = this.root.collection("backups").doc(id);
    const meta = await ref.get();
    if (!meta.exists) return null;
    const parts = Number(meta.data()!.parts ?? 0);
    let text = "";
    for (let i = 0; i < parts; i++) {
      const p = await ref.collection("parts").doc(String(i)).get();
      if (!p.exists) throw new Error("バックアップの一部が見つかりません");
      text += String(p.data()!.chunk ?? "");
    }
    return JSON.parse(text);
  }

  private async prune() {
    const all = await this.listBackups();
    for (const b of all.slice(MAX_BACKUPS)) {
      const ref = this.root.collection("backups").doc(b.id);
      const meta = await ref.get();
      const parts = Number(meta.data()?.parts ?? 0);
      for (let i = 0; i < parts; i++) await ref.collection("parts").doc(String(i)).delete();
      await ref.delete();
    }
  }
}

/** Group records by month; spill a month into extra docs when it gets large. */
export function splitMonths(records: StudyRecord[]): Map<string, { month: string; part: number; records: StudyRecord[] }> {
  const byMonth = new Map<string, StudyRecord[]>();
  for (const r of records) {
    const m = /^\d{4}-\d{2}/.test(r.date) ? r.date.slice(0, 7) : "undated";
    if (!byMonth.has(m)) byMonth.set(m, []);
    byMonth.get(m)!.push(r);
  }
  const out = new Map<string, { month: string; part: number; records: StudyRecord[] }>();
  for (const [m, list] of [...byMonth].sort(([a], [b]) => a.localeCompare(b))) {
    let part = 1, cur: StudyRecord[] = [], size = 0;
    const flush = () => {
      out.set(part === 1 ? m : `${m}_${part}`, { month: m, part, records: cur });
      part++;
      cur = [];
      size = 0;
    };
    for (const r of list) {
      const n = JSON.stringify(r).length + 1;
      if (size + n > MONTH_DOC_LIMIT && cur.length) flush();
      cur.push(r);
      size += n;
    }
    if (cur.length) flush();
  }
  return out;
}
