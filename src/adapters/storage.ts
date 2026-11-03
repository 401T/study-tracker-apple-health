/**
 * Storage adapters. The app only talks to `StorageAdapter`; swapping the
 * persistence backend (e.g. to a Muse-provided store) means writing one class.
 *
 * Safety contract every adapter MUST honor:
 * 1. `save` replaces only the app's own dataset key — never other keys.
 * 2. Nothing in this module deletes data it did not create. Pruning touches
 *    only this app's backup keys, and keeps the newest MAX_BACKUPS.
 * 3. `load` returns the raw parsed value; validation happens in the store so
 *    unknown fields survive.
 */

export interface BackupInfo {
  id: string;
  label: string;
  createdAt: string;
  bytes: number;
}

export interface StorageAdapter {
  readonly name: string;
  load(): Promise<unknown | null>;
  save(data: unknown): Promise<void>;
  backup(label: string, data: unknown): Promise<BackupInfo>;
  listBackups(): Promise<BackupInfo[]>;
  readBackup(id: string): Promise<unknown | null>;
}

export const STORAGE_PREFIX = "sah:v1:";
export const DATASET_KEY = `${STORAGE_PREFIX}dataset`;
const BACKUP_PREFIX = `${STORAGE_PREFIX}backup:`;
export const MAX_BACKUPS = 20;

interface KV {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
  key(i: number): string | null;
  readonly length: number;
}

/** Shared implementation over any localStorage-like key/value store. */
export class KeyValueStorageAdapter implements StorageAdapter {
  constructor(readonly name: string, private kv: KV) {}

  async load(): Promise<unknown | null> {
    const s = this.kv.getItem(DATASET_KEY);
    if (s === null) return null;
    return JSON.parse(s); // a parse error propagates: the store refuses to overwrite unreadable data
  }

  async save(data: unknown): Promise<void> {
    this.kv.setItem(DATASET_KEY, JSON.stringify(data));
  }

  async backup(label: string, data: unknown): Promise<BackupInfo> {
    const createdAt = new Date().toISOString();
    const id = `${BACKUP_PREFIX}${createdAt}#${Math.random().toString(36).slice(2, 7)}`;
    const body = JSON.stringify({ label, createdAt, data });
    this.kv.setItem(id, body);
    await this.prune();
    return { id, label, createdAt, bytes: body.length };
  }

  async listBackups(): Promise<BackupInfo[]> {
    const out: BackupInfo[] = [];
    for (let i = 0; i < this.kv.length; i++) {
      const k = this.kv.key(i);
      if (!k || !k.startsWith(BACKUP_PREFIX)) continue;
      const body = this.kv.getItem(k) ?? "";
      try {
        const { label, createdAt } = JSON.parse(body);
        out.push({ id: k, label, createdAt, bytes: body.length });
      } catch {
        out.push({ id: k, label: "(読み取り不可)", createdAt: k.slice(BACKUP_PREFIX.length), bytes: body.length });
      }
    }
    return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async readBackup(id: string): Promise<unknown | null> {
    if (!id.startsWith(BACKUP_PREFIX)) return null;
    const s = this.kv.getItem(id);
    return s ? JSON.parse(s).data : null;
  }

  private async prune() {
    const all = await this.listBackups();
    for (const b of all.slice(MAX_BACKUPS)) if (b.id.startsWith(BACKUP_PREFIX)) this.kv.removeItem(b.id);
  }
}

export function localStorageAdapter(): StorageAdapter {
  return new KeyValueStorageAdapter("localStorage", window.localStorage);
}

/** In-memory KV for tests and for environments without persistent storage. */
export class MemoryKV implements KV {
  map = new Map<string, string>();
  getItem(k: string) {
    return this.map.has(k) ? this.map.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, String(v));
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null;
  }
  get length() {
    return this.map.size;
  }
}

export function memoryAdapter(kv = new MemoryKV()): StorageAdapter {
  return new KeyValueStorageAdapter("memory", kv);
}
